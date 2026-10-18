//! The user's own interactive terminals (drawer › Terminal) on Windows.
//!
//! The same contract as the Unix version (`terminal.rs`): the user's shell,
//! started in a project folder with the user's environment, outside the
//! agent sandbox and without approvals; output in a bounded in-memory
//! scrollback read by byte cursor after a transient `terminal.output`
//! wake-up; nothing stored or offered to a model.
//!
//! Each terminal is a pseudo console (ConPTY). The shell is PowerShell 7
//! (`pwsh`) when installed, else Windows PowerShell. It runs in a job object,
//! so closing the terminal, the window or ShadowCode ends what it started.
use anyhow::{bail, ensure, Context, Result};
use base64::Engine as _;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{Read, Write},
    os::windows::{
        ffi::OsStrExt,
        io::{FromRawHandle, RawHandle},
    },
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::broadcast;
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        Console::{ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON},
        Pipes::CreatePipe,
        Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
            InitializeProcThreadAttributeList, UpdateProcThreadAttribute, WaitForSingleObject,
            CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
            PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, STARTUPINFOEXW,
        },
    },
};

/// Scrollback kept per terminal. Older output is dropped from the front.
pub const SCROLLBACK_BYTES: usize = 512 * 1024;
/// Open terminals per desktop view, across projects.
pub const MAX_TERMINALS: usize = 12;
/// One read returns at most this much output; `more` asks for another read.
pub const READ_LIMIT: usize = 256 * 1024;
/// One write (a keystroke batch or a paste) is at most this large.
pub const WRITE_LIMIT: usize = 64 * 1024;
/// Output wake-ups per terminal are coalesced to at most one per interval.
const WAKE_INTERVAL: Duration = Duration::from_millis(16);

/// How to start a terminal. `shell` overrides the default shell (tests).
#[derive(Clone, Debug, Default)]
pub struct OpenOptions {
    pub cols: u16,
    pub rows: u16,
    pub shell: Option<PathBuf>,
    /// Start the shell as a login shell (reads the user's profile).
    pub login: bool,
}

/// The terminals of one desktop view.
pub struct Terminals {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    sender: broadcast::Sender<Value>,
}

struct Output {
    bytes: Vec<u8>,
    /// Absolute offset of `bytes[0]` in everything the terminal printed.
    start: u64,
    exit_code: Option<i32>,
    /// The shell exited (or the terminal was closed).
    exited: bool,
}

/// A kernel handle closed when dropped.
struct Owned(HANDLE);
// SAFETY: kernel handles may be used and closed from any thread.
unsafe impl Send for Owned {}
unsafe impl Sync for Owned {}
impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: opened for this terminal and closed once.
        unsafe { CloseHandle(self.0) };
    }
}

/// The pseudo console; closing it hangs up the shell.
struct Console(Mutex<Option<HPCON>>);
impl Console {
    fn close(&self) {
        if let Some(console) = self.0.lock().ok().and_then(|mut c| c.take()) {
            // SAFETY: created by CreatePseudoConsole and closed once.
            unsafe { ClosePseudoConsole(console) };
        }
    }
}

struct Session {
    id: String,
    workspace: PathBuf,
    number: u32,
    shell: String,
    created: f64,
    console: Console,
    input: Mutex<std::fs::File>,
    process: Owned,
    job: Option<crate::process::Job>,
    output: Mutex<Output>,
    size: Mutex<(u16, u16)>,
    closed: AtomicBool,
    pending: AtomicBool,
    sender: broadcast::Sender<Value>,
}

impl Session {
    fn wake(&self, kind: &str) {
        let _ = self
            .sender
            .send(json!({"type": kind, "terminal_id": self.id, "session_id": null}));
    }
    fn output(&self) -> Result<std::sync::MutexGuard<'_, Output>> {
        self.output
            .lock()
            .map_err(|_| anyhow::anyhow!("Terminal output lock poisoned"))
    }
    fn append(&self, chunk: &[u8]) {
        let Ok(mut output) = self.output() else {
            return;
        };
        output.bytes.extend_from_slice(chunk);
        if output.bytes.len() > SCROLLBACK_BYTES {
            // Keep three quarters, cut after a line break when one is near.
            let mut cut = output.bytes.len() - SCROLLBACK_BYTES * 3 / 4;
            if let Some(newline) = output.bytes[cut..]
                .iter()
                .take(4096)
                .position(|b| *b == b'\n')
            {
                cut += newline + 1;
            }
            output.bytes.drain(..cut);
            output.start += cut as u64;
        }
    }
    fn describe(&self) -> Value {
        let (cols, rows) = self.size.lock().map(|s| *s).unwrap_or((80, 24));
        let (exited, exit_code, end) = self
            .output()
            .map(|o| (o.exited, o.exit_code, o.start + o.bytes.len() as u64))
            .unwrap_or((true, None, 0));
        json!({
            "id": self.id,
            "title": format!("Terminal {}", self.number),
            "number": self.number,
            "workspace": self.workspace,
            "shell": self.shell,
            "cols": cols,
            "rows": rows,
            "created": self.created,
            "exited": exited,
            "exit_code": exit_code,
            "cursor": end,
        })
    }
    fn exited(&self) -> bool {
        self.output().map(|o| o.exited).unwrap_or(true)
    }
    fn kill(&self) {
        if let Some(job) = &self.job {
            job.terminate();
        }
    }
    /// Hang up the shell; end it and what it started after `grace`.
    fn hang_up(self: &Arc<Self>, grace: Duration) {
        self.closed.store(true, Ordering::Release);
        self.console.close();
        let session = self.clone();
        std::thread::spawn(move || {
            let deadline = Instant::now() + grace;
            while Instant::now() < deadline && !session.exited() {
                std::thread::sleep(Duration::from_millis(25));
            }
            session.kill();
        });
    }
}

impl Terminals {
    pub fn new(sender: broadcast::Sender<Value>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            sender,
        }
    }
    fn sessions(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Arc<Session>>>> {
        self.sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("Terminal registry lock poisoned"))
    }
    fn get(&self, id: &str) -> Result<Arc<Session>> {
        self.sessions()?
            .get(id)
            .cloned()
            .context("This terminal was closed")
    }
    /// Start a shell in `workspace` and return its description.
    pub fn open(&self, workspace: &Path, options: OpenOptions) -> Result<Value> {
        ensure!(workspace.is_dir(), "The project folder does not exist");
        let mut sessions = self.sessions()?;
        ensure!(
            sessions.len() < MAX_TERMINALS,
            "At most {MAX_TERMINALS} terminals can be open. Close one first."
        );
        let used: Vec<u32> = sessions
            .values()
            .filter(|s| s.workspace == workspace)
            .map(|s| s.number)
            .collect();
        let number = (1..).find(|n| !used.contains(n)).unwrap_or(1);
        let (cols, rows) = clamp_size(options.cols, options.rows);
        let shell = options.shell.unwrap_or_else(login_shell);
        let pty = spawn(&shell, options.login, workspace, cols, rows)?;
        let job = crate::process::Job::for_process(pty.process.0 as RawHandle).ok();
        let session = Arc::new(Session {
            id: crate::id(),
            workspace: workspace.to_owned(),
            number,
            shell: shell.to_string_lossy().into_owned(),
            created: crate::now(),
            console: Console(Mutex::new(Some(pty.console))),
            input: Mutex::new(pty.input),
            process: pty.process,
            job,
            output: Mutex::new(Output {
                bytes: Vec::new(),
                start: 0,
                exit_code: None,
                exited: false,
            }),
            size: Mutex::new((cols, rows)),
            closed: AtomicBool::new(false),
            pending: AtomicBool::new(false),
            sender: self.sender.clone(),
        });
        let pump = session.clone();
        let mut reader = pty.output;
        std::thread::Builder::new()
            .name("terminal-output".into())
            .spawn(move || {
                let mut buffer = vec![0u8; 16 * 1024];
                // Ends when the console closes its side of the pipe.
                while let Ok(count) = reader.read(&mut buffer) {
                    if count == 0 {
                        break;
                    }
                    pump.append(&buffer[..count]);
                    pump.pending.store(true, Ordering::Release);
                }
                if pump.pending.swap(false, Ordering::AcqRel) {
                    pump.wake("terminal.output");
                }
            })?;
        // A blocking read cannot time out: wake-ups are coalesced here.
        let waker = session.clone();
        std::thread::Builder::new()
            .name("terminal-wake".into())
            .spawn(move || loop {
                std::thread::sleep(WAKE_INTERVAL);
                if waker.pending.swap(false, Ordering::AcqRel) {
                    waker.wake("terminal.output");
                }
                if waker.exited() {
                    break;
                }
            })?;
        let waiter = session.clone();
        std::thread::Builder::new()
            .name("terminal-wait".into())
            .spawn(move || {
                let mut code = 0u32;
                // SAFETY: the process handle stays open with the session.
                let code = unsafe {
                    WaitForSingleObject(waiter.process.0, INFINITE);
                    GetExitCodeProcess(waiter.process.0, &mut code) != 0
                }
                .then_some(code as i32);
                // The shell is gone: the console has nothing left to show.
                waiter.console.close();
                if let Ok(mut output) = waiter.output() {
                    output.exit_code = code;
                    output.exited = true;
                }
                waiter.wake("terminal.exited");
            })?;
        let description = session.describe();
        sessions.insert(session.id.clone(), session);
        Ok(description)
    }
    /// Terminals, oldest first; only those in `workspace` when given.
    pub fn list(&self, workspace: Option<&Path>) -> Result<Vec<Value>> {
        let mut rows: Vec<_> = self
            .sessions()?
            .values()
            .filter(|s| workspace.is_none_or(|w| s.workspace == w))
            .cloned()
            .collect();
        rows.sort_by(|a, b| a.created.total_cmp(&b.created));
        Ok(rows.iter().map(|s| s.describe()).collect())
    }
    /// The terminal's project folder (routes check it against the view).
    pub fn workspace(&self, id: &str) -> Result<PathBuf> {
        Ok(self.get(id)?.workspace.clone())
    }
    /// Type into the terminal. Blocks while the console's input buffer is
    /// full, so callers run it off the async workers.
    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        ensure!(data.len() <= WRITE_LIMIT, "Paste at most 64 KB at a time");
        let session = self.get(id)?;
        ensure!(
            !session.output()?.exited,
            "This terminal's shell has exited. Open a new terminal."
        );
        let mut input = session
            .input
            .lock()
            .map_err(|_| anyhow::anyhow!("Terminal input lock poisoned"))?;
        input
            .write_all(data)
            .context("Could not type into the terminal")?;
        Ok(())
    }
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<Value> {
        let session = self.get(id)?;
        let (cols, rows) = clamp_size(cols, rows);
        if let Some(console) = session.console.0.lock().ok().and_then(|c| *c) {
            let size = COORD {
                X: cols as i16,
                Y: rows as i16,
            };
            // SAFETY: the console is open while it is held here.
            let result = unsafe { ResizePseudoConsole(console, size) };
            ensure!(result >= 0, "Could not resize the terminal ({result:#x})");
        }
        *session
            .size
            .lock()
            .map_err(|_| anyhow::anyhow!("Terminal size lock poisoned"))? = (cols, rows);
        Ok(json!({"cols": cols, "rows": rows}))
    }
    /// Output after byte offset `after`, base64-encoded (see the Unix version).
    pub fn read(&self, id: &str, after: u64) -> Result<Value> {
        let session = self.get(id)?;
        let output = session.output()?;
        let end = output.start + output.bytes.len() as u64;
        let from = after.clamp(output.start, end);
        let offset = (from - output.start) as usize;
        let take = (output.bytes.len() - offset).min(READ_LIMIT);
        let data = &output.bytes[offset..offset + take];
        Ok(json!({
            "id": session.id,
            "data": base64::engine::general_purpose::STANDARD.encode(data),
            "from": from,
            "cursor": from + take as u64,
            "more": from + (take as u64) < end,
            "truncated": after < output.start,
            "exited": output.exited,
            "exit_code": output.exit_code,
        }))
    }
    /// Hang up one terminal and forget it.
    pub fn close(&self, id: &str) -> Result<()> {
        let session = self
            .sessions()?
            .remove(id)
            .context("This terminal was already closed")?;
        session.hang_up(Duration::from_millis(1500));
        Ok(())
    }
    /// Hang up every terminal (the window is quitting). Waits up to `wait`
    /// for the shells to exit, then ends what is left.
    pub fn close_all(&self, wait: Duration) {
        let sessions: Vec<_> = match self.sessions.lock() {
            Ok(mut sessions) => sessions.drain().map(|(_, s)| s).collect(),
            Err(_) => return,
        };
        for session in &sessions {
            session.hang_up(wait.max(Duration::from_millis(500)));
        }
        let deadline = Instant::now() + wait;
        while Instant::now() < deadline && sessions.iter().any(|s| !s.exited()) {
            std::thread::sleep(Duration::from_millis(20));
        }
        if !wait.is_zero() {
            for session in &sessions {
                session.kill();
            }
        }
    }
}

impl Drop for Terminals {
    fn drop(&mut self) {
        // Nobody can see these terminals any more.
        self.close_all(Duration::ZERO);
    }
}

fn clamp_size(cols: u16, rows: u16) -> (u16, u16) {
    (
        if cols == 0 { 80 } else { cols.clamp(2, 1000) },
        if rows == 0 { 24 } else { rows.clamp(1, 500) },
    )
}

/// PowerShell 7 when installed, else Windows PowerShell.
pub fn login_shell() -> PathBuf {
    if let Some(pwsh) = crate::sandbox::which("pwsh") {
        return pwsh;
    }
    let system = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    system.join(r"System32\WindowsPowerShell\v1.0\powershell.exe")
}

/// The user's environment for their own shell, plus terminal identification.
pub fn user_environment() -> Vec<(OsString, OsString)> {
    let mut vars: Vec<(OsString, OsString)> = std::env::vars_os()
        .filter(|(name, _)| {
            !matches!(
                name.to_string_lossy().to_ascii_uppercase().as_str(),
                "TERM" | "COLORTERM" | "TERM_PROGRAM"
            )
        })
        .collect();
    vars.push(("TERM".into(), "xterm-256color".into()));
    vars.push(("COLORTERM".into(), "truecolor".into()));
    vars.push(("TERM_PROGRAM".into(), "ShadowCode".into()));
    vars
}

struct Pty {
    console: HPCON,
    input: std::fs::File,
    output: std::fs::File,
    process: Owned,
}

fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
    text.encode_wide().chain(Some(0)).collect()
}

/// One anonymous pipe: (read end, write end).
fn pipe() -> Result<(Owned, Owned)> {
    let (mut read, mut write): (HANDLE, HANDLE) = (std::ptr::null_mut(), std::ptr::null_mut());
    // SAFETY: CreatePipe writes two handles on success.
    ensure!(
        unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) } != 0,
        "Could not create a terminal pipe: {}",
        std::io::Error::last_os_error()
    );
    Ok((Owned(read), Owned(write)))
}

fn spawn(shell: &Path, login: bool, cwd: &Path, cols: u16, rows: u16) -> Result<Pty> {
    let (input_read, input_write) = pipe()?;
    let (output_read, output_write) = pipe()?;
    let mut console: HPCON = 0;
    let size = COORD {
        X: cols as i16,
        Y: rows as i16,
    };
    // SAFETY: both pipe ends are open; the console keeps its own references.
    let result =
        unsafe { CreatePseudoConsole(size, input_read.0, output_write.0, 0, &mut console) };
    ensure!(
        result >= 0,
        "Could not create a terminal (pseudo console {result:#x})"
    );
    // The console holds these ends now; keeping ours would stop the output
    // pipe from closing when the console does.
    drop(input_read);
    drop(output_write);
    let close_console = |error: anyhow::Error| {
        // SAFETY: created above and not yet handed to a session.
        unsafe { ClosePseudoConsole(console) };
        error
    };
    // The attribute list naming the console.
    let mut list_size = 0usize;
    // SAFETY: a size query; nothing is written with a null list.
    unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut list_size) };
    let mut list = vec![0u64; list_size.div_ceil(8)];
    let attributes = list.as_mut_ptr().cast::<std::ffi::c_void>();
    // SAFETY: the buffer has the size the query returned, and the console
    // value outlives the process creation below.
    let ready = unsafe {
        InitializeProcThreadAttributeList(attributes, 1, 0, &mut list_size) != 0
            && UpdateProcThreadAttribute(
                attributes,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                console as *const std::ffi::c_void,
                std::mem::size_of::<HPCON>(),
                std::ptr::null_mut(),
                std::ptr::null(),
            ) != 0
    };
    if !ready {
        return Err(close_console(anyhow::anyhow!(
            "Could not attach the terminal: {}",
            std::io::Error::last_os_error()
        )));
    }
    let mut command = OsString::from("\"");
    command.push(shell.as_os_str());
    command.push("\"");
    let name = shell
        .file_stem()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name == "bash" && login {
        command.push(" --login -i");
    } else if name == "pwsh" || name == "powershell" {
        command.push(" -NoLogo");
    }
    let mut command_line = wide(&command);
    let mut environment: Vec<u16> = Vec::new();
    let mut vars = user_environment();
    vars.sort_by_key(|(name, _)| name.to_string_lossy().to_ascii_uppercase());
    for (name, value) in vars {
        environment.extend(name.encode_wide());
        environment.push(b'=' as u16);
        environment.extend(value.encode_wide());
        environment.push(0);
    }
    environment.push(0);
    let directory = wide(cwd.as_os_str());
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.lpAttributeList = attributes;
    let mut process = PROCESS_INFORMATION::default();
    // SAFETY: every buffer is NUL-terminated and lives across the call; the
    // standard handles are left unset so the console provides them.
    let created = unsafe {
        CreateProcessW(
            std::ptr::null(),
            command_line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
            environment.as_ptr().cast(),
            directory.as_ptr(),
            &startup.StartupInfo,
            &mut process,
        )
    };
    let error = std::io::Error::last_os_error();
    // SAFETY: initialized above; no longer needed once the process exists.
    unsafe { DeleteProcThreadAttributeList(attributes) };
    if created == 0 {
        return Err(close_console(anyhow::anyhow!(
            "Could not start {}: {error}",
            shell.display()
        )));
    }
    // SAFETY: the thread handle is not needed; the process handle is owned.
    unsafe { CloseHandle(process.hThread) };
    // SAFETY: each handle is owned here and handed to exactly one File.
    let (input, output) = unsafe {
        let input = std::fs::File::from_raw_handle(input_write.0 as RawHandle);
        std::mem::forget(input_write);
        let output = std::fs::File::from_raw_handle(output_read.0 as RawHandle);
        std::mem::forget(output_read);
        (input, output)
    };
    Ok(Pty {
        console,
        input,
        output,
        process: Owned(process.hProcess),
    })
}

/// Terminal-safe check used by routes: a terminal id is 32 hex digits.
pub fn valid_id(id: &str) -> Result<&str> {
    if id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(id)
    } else {
        bail!("Unknown terminal")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_clamped() {
        assert_eq!(clamp_size(0, 0), (80, 24));
        assert_eq!(clamp_size(1, 9000), (2, 500));
    }

    #[test]
    fn terminal_ids_are_hex() {
        assert!(valid_id(&"a".repeat(32)).is_ok());
        assert!(valid_id("../etc").is_err());
    }

    #[test]
    fn a_shell_prints_and_exits() {
        let (sender, _) = broadcast::channel(64);
        let terminals = Terminals::new(sender);
        let dir = tempfile::tempdir().unwrap();
        let shell = PathBuf::from(std::env::var_os("ComSpec").unwrap());
        let opened = terminals
            .open(
                dir.path(),
                OpenOptions {
                    cols: 80,
                    rows: 24,
                    shell: Some(shell),
                    login: false,
                },
            )
            .unwrap();
        let id = opened["id"].as_str().unwrap().to_owned();
        terminals
            .write(&id, b"echo shadowcode-terminal-ok\r\nexit 3\r\n")
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        let text = loop {
            let read = terminals.read(&id, 0).unwrap();
            let text = String::from_utf8_lossy(
                &base64::engine::general_purpose::STANDARD
                    .decode(read["data"].as_str().unwrap())
                    .unwrap(),
            )
            .into_owned();
            if read["exited"] == true || Instant::now() > deadline {
                assert_eq!(read["exit_code"], 3, "{text}");
                break text;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        assert!(text.contains("shadowcode-terminal-ok"), "{text}");
        terminals.close(&id).unwrap();
    }
}
