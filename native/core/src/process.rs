use anyhow::{ensure, Context, Result};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::mpsc,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug)]
pub struct ProcessSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub timeout: Duration,
    pub output_limit: usize,
    pub env: BTreeMap<String, String>,
    /// Sandbox work between fork and exec (network namespace, Landlock), and
    /// the allow-list proxy served while the process runs.
    pub child: Option<crate::sandbox::ChildSetup>,
}
impl ProcessSpec {
    pub fn shell(command: &str, cwd: PathBuf, timeout: Duration) -> Self {
        let bridge = crate::flatpak::host_bridge();
        Self {
            program: bridge.as_ref().map_or_else(
                || "/bin/sh".into(),
                |path| path.to_string_lossy().into_owned(),
            ),
            args: if bridge.is_some() {
                vec!["/bin/sh".into(), "-c".into(), command.into()]
            } else {
                vec!["-c".into(), command.into()]
            },
            cwd,
            timeout,
            output_limit: 256_000,
            env: BTreeMap::new(),
            child: None,
        }
    }
    pub fn command(program: &str, args: &[&str], cwd: PathBuf) -> Self {
        Self {
            program: program.into(),
            args: args.iter().map(|s| (*s).into()).collect(),
            cwd,
            timeout: Duration::from_secs(30),
            output_limit: 256_000,
            env: BTreeMap::new(),
            child: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ProcessChunk {
    pub stream: &'static str,
    pub text: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct ProcessResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
    pub cancelled: bool,
    pub truncated: bool,
    pub duration_ms: u128,
    pub pid: u32,
}

/// Every live descendant of `pid`, children first. A shell's background
/// job may leave the shell's process group; signalling these as well keeps
/// an owned task from outliving its cancellation.
#[cfg(unix)]
pub(crate) fn descendants(pid: u32) -> Vec<u32> {
    let mut all = Vec::new();
    let mut pending = vec![pid];
    while let Some(parent) = pending.pop() {
        if all.len() >= 4096 {
            break;
        }
        for child in children(parent) {
            if child != pid && !all.contains(&child) {
                all.push(child);
                pending.push(child);
            }
        }
    }
    all
}

#[cfg(target_os = "linux")]
fn children(pid: u32) -> Vec<u32> {
    std::fs::read_to_string(format!("/proc/{pid}/task/{pid}/children"))
        .unwrap_or_default()
        .split_whitespace()
        .filter_map(|value| value.parse().ok())
        .collect()
}

#[cfg(target_os = "macos")]
fn children(pid: u32) -> Vec<u32> {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return Vec::new();
    };
    let mut buffer = vec![0 as libc::pid_t; 1024];
    // SAFETY: the buffer holds `buffer.len()` pids; its size is in bytes.
    let bytes = unsafe {
        libc::proc_listchildpids(
            pid,
            buffer.as_mut_ptr().cast(),
            (buffer.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
        )
    };
    // proc_listchildpids returns a count of pids, not of bytes.
    buffer.truncate(bytes.max(0) as usize);
    buffer
        .into_iter()
        .filter_map(|child| u32::try_from(child).ok())
        .filter(|child| *child > 0)
        .collect()
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn children(_pid: u32) -> Vec<u32> {
    Vec::new()
}

/// Make the child about to `exec` die with ShadowCode (`parent`), so a
/// crash never leaves a model server or language server behind.
///
/// Linux: `PR_SET_PDEATHSIG`. macOS has no equivalent: the child forks a
/// watcher that keeps none of its descriptors (pipes still reach EOF) and
/// waits on kqueue for either process to exit; if ShadowCode goes first it
/// kills the child. The watcher shares the child's process group, so
/// stopping the group stops it too.
///
/// # Safety
/// Call only between fork and exec: it only makes system calls.
#[cfg(target_os = "linux")]
pub(crate) unsafe fn die_with_parent(_parent: u32) -> std::io::Result<()> {
    if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

/// See the Linux version.
///
/// # Safety
/// Call only between fork and exec: it only makes system calls.
#[cfg(target_os = "macos")]
pub(crate) unsafe fn die_with_parent(parent: u32) -> std::io::Result<()> {
    let parent = parent as libc::pid_t;
    let child = unsafe { libc::getpid() };
    match unsafe { libc::fork() } {
        -1 => return Err(std::io::Error::last_os_error()),
        0 => {}
        _ => return Ok(()),
    }
    // The watcher. Nothing here allocates or takes a lock.
    unsafe {
        let limit = libc::getdtablesize().clamp(0, 65536);
        for fd in 0..limit {
            libc::close(fd);
        }
        let queue = libc::kqueue();
        if queue < 0 {
            libc::_exit(0);
        }
        let watch = |pid: libc::pid_t| libc::kevent {
            ident: pid as usize,
            filter: libc::EVFILT_PROC,
            flags: libc::EV_ADD | libc::EV_ONESHOT,
            fflags: libc::NOTE_EXIT,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        let none = std::ptr::null_mut();
        // The child already gone (its exec failed): nothing to watch.
        if libc::kevent(queue, &watch(child), 1, none, 0, std::ptr::null()) != 0 {
            libc::_exit(0);
        }
        // ShadowCode already gone: the child must not outlive it.
        if libc::kevent(queue, &watch(parent), 1, none, 0, std::ptr::null()) != 0 {
            libc::kill(child, libc::SIGKILL);
            libc::_exit(0);
        }
        let mut event: libc::kevent = std::mem::zeroed();
        loop {
            match libc::kevent(queue, std::ptr::null(), 0, &mut event, 1, std::ptr::null()) {
                1 => {
                    if event.ident == parent as usize {
                        libc::kill(child, libc::SIGKILL);
                    }
                    libc::_exit(0);
                }
                -1 if *libc::__error() == libc::EINTR => continue,
                _ => libc::_exit(0),
            }
        }
    }
}

/// Whether a process id is still taken, zombies included (not yet reaped).
#[cfg(all(test, unix))]
pub(crate) fn exists(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only checks that the process exists.
    let alive = unsafe { libc::kill(pid, 0) } == 0;
    alive || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Windows' process group: every process a command starts joins its job
/// (unless it breaks away on purpose); ending the job ends them all, and
/// closing the last handle, ShadowCode's included, ends it too. A process
/// started in the instant between spawn and joining is not covered.
#[cfg(windows)]
pub(crate) struct Job(windows_sys::Win32::Foundation::HANDLE);
// SAFETY: a job handle may be used and closed from any thread.
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
unsafe impl Sync for Job {}
#[cfg(windows)]
impl Job {
    /// A job holding the process behind `process`.
    pub(crate) fn for_process(process: std::os::windows::io::RawHandle) -> std::io::Result<Self> {
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        // SAFETY: an unnamed job with default security; checked for null.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let job = Self(handle);
        // SAFETY: the limits are plain data passed with their own size; the
        // process handle belongs to a live child.
        unsafe {
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
                || AssignProcessToJobObject(
                    job.0,
                    process as windows_sys::Win32::Foundation::HANDLE,
                ) == 0
            {
                return Err(std::io::Error::last_os_error());
            }
        }
        Ok(job)
    }
    /// End every process in the job now.
    pub(crate) fn terminate(&self) {
        // SAFETY: the handle is open until drop.
        unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) };
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: opened in for_process and closed once.
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

struct ProcessGroup {
    pid: u32,
    #[cfg(windows)]
    job: Option<Job>,
}
impl ProcessGroup {
    #[cfg(unix)]
    fn of(child: &tokio::process::Child, pid: u32) -> Self {
        let _ = child;
        Self { pid }
    }
    #[cfg(windows)]
    fn of(child: &tokio::process::Child, pid: u32) -> Self {
        let job = child
            .raw_handle()
            .and_then(|handle| Job::for_process(handle).ok());
        Self { pid, job }
    }
    fn terminate(&self) {
        // Windows has no polite stop for a console process tree.
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.terminate();
        }
        #[cfg(unix)]
        if self.pid != 0 {
            let descendants = crate::process::descendants(self.pid);
            unsafe {
                libc::kill(-(self.pid as i32), libc::SIGTERM);
                // Some shells alter their process group while spawning a
                // background job. Signal the leader directly as well so an
                // owned task cannot outlive its cancellation scope.
                libc::kill(self.pid as i32, libc::SIGTERM);
                for child in descendants {
                    libc::kill(child as i32, libc::SIGTERM);
                }
            }
        }
    }
    fn kill(&mut self) {
        #[cfg(unix)]
        if self.pid != 0 {
            let descendants = crate::process::descendants(self.pid);
            unsafe {
                libc::kill(-(self.pid as i32), libc::SIGKILL);
                libc::kill(self.pid as i32, libc::SIGKILL);
                for child in descendants {
                    libc::kill(child as i32, libc::SIGKILL);
                }
            }
        }
        #[cfg(windows)]
        if let Some(job) = self.job.take() {
            job.terminate();
        }
        self.pid = 0;
    }
}
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        self.kill();
    }
}

struct DrainTask(tokio::task::JoinHandle<Result<()>>);
impl Drop for DrainTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Drain both pipes even after the output cap is reached; otherwise a verbose
/// child can deadlock its parent or exhaust memory. Cancellation kills the
/// entire process group, including grandchildren that inherited output pipes.
pub async fn run(
    spec: ProcessSpec,
    cancel: CancellationToken,
    chunks: Option<mpsc::Sender<ProcessChunk>>,
) -> Result<ProcessResult> {
    run_internal(spec, cancel, chunks, None).await
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct LiveOutput {
    pub pid: u32,
    pub output: String,
    pub truncated: bool,
    pub revision: u64,
}
#[derive(Clone, Default)]
pub struct ProcessMonitor(Arc<Mutex<LiveOutput>>);
impl ProcessMonitor {
    pub fn snapshot(&self) -> Result<LiveOutput> {
        Ok(self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("Process output lock poisoned"))?
            .clone())
    }
    fn append(&self, text: &str) -> Result<()> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("Process output lock poisoned"))?;
        state.output.push_str(text);
        if state.output.len() > 64_000 {
            let mut cut = state.output.len() - 64_000;
            while !state.output.is_char_boundary(cut) {
                cut += 1;
            }
            state.output.drain(..cut);
            state.truncated = true;
        }
        state.revision = state.revision.saturating_add(1);
        Ok(())
    }
}

/// A user-started server or watcher runs until it exits or is stopped, rather
/// than inheriting the one-hour foreground-command timeout. The monitor keeps
/// the latest 64 KB while both pipes continue draining. Stop allows two seconds
/// for SIGTERM, then kills the remaining process group.
pub async fn run_background(
    spec: ProcessSpec,
    cancel: CancellationToken,
    monitor: ProcessMonitor,
) -> Result<ProcessResult> {
    run_internal(spec, cancel, None, Some(monitor)).await
}

async fn run_internal(
    spec: ProcessSpec,
    cancel: CancellationToken,
    chunks: Option<mpsc::Sender<ProcessChunk>>,
    monitor: Option<ProcessMonitor>,
) -> Result<ProcessResult> {
    ensure!(spec.cwd.is_dir(), "Command workspace does not exist");
    ensure!(
        spec.output_limit <= 4_000_000 && spec.output_limit > 0,
        "Invalid command output limit"
    );
    ensure!(
        spec.timeout <= Duration::from_secs(3600) && !spec.timeout.is_zero(),
        "Invalid command timeout"
    );
    ensure!(
        !cancel.is_cancelled(),
        "Task was cancelled before the command started"
    );
    let started = std::time::Instant::now();
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env_clear();
    for name in [
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "LC_ALL",
        "TERM",
        "TMPDIR",
        "VIRTUAL_ENV",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
        "DBUS_SESSION_BUS_ADDRESS",
        "SHADOWCODE_HOST_PATH",
        "SHADOWCODE_HOST_DBUS",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("PAGER", "cat")
        .env("NO_COLOR", "1")
        .envs(&spec.env);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let setup = spec.child.clone();
        let parent = std::process::id();
        // SAFETY: only system calls between fork and exec.
        unsafe {
            command.pre_exec(move || {
                // Propagate cancellation to shell-created descendants when
                // their owning process exits, preventing orphaned tasks.
                die_with_parent(parent)?;
                if let Some(setup) = &setup {
                    setup.enter()?;
                }
                Ok(())
            });
        }
    }
    let mut child = command
        .spawn()
        .with_context(|| format!("Could not start {}", spec.program))?;
    let pid = child.id().context("Command has no process ID")?;
    let mut group = ProcessGroup::of(&child, pid);
    // Dropped (stopping the proxy) when this function returns.
    let _proxy = match &spec.child {
        Some(setup) => setup.after_spawn()?,
        None => None,
    };
    if let Some(monitor) = &monitor {
        let mut state = monitor
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("Process output lock poisoned"))?;
        state.pid = pid;
        state.revision += 1;
    }
    let used = Arc::new(AtomicUsize::new(0));
    let output = Arc::new(Mutex::new(Vec::new()));
    let errors = Arc::new(Mutex::new(Vec::new()));
    let mut stdout = DrainTask(tokio::spawn(drain(
        child.stdout.take().context("Missing stdout")?,
        "stdout",
        spec.output_limit,
        used.clone(),
        chunks.clone(),
        output.clone(),
        monitor.clone(),
    )));
    let mut stderr = DrainTask(tokio::spawn(drain(
        child.stderr.take().context("Missing stderr")?,
        "stderr",
        spec.output_limit,
        used.clone(),
        chunks,
        errors.clone(),
        monitor.clone(),
    )));
    let deadline = async {
        if monitor.is_some() {
            std::future::pending::<()>().await;
        } else {
            tokio::time::sleep(spec.timeout).await;
        }
    };
    let (status, timed_out, cancelled) = tokio::select! {
        status=child.wait()=>(Some(status?),false,false),
        _=deadline=>(None,true,false),
        _=cancel.cancelled()=>(None,false,true),
    };
    let status = if cancelled {
        group.terminate();
        tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .ok()
            .transpose()?
            .or(status)
    } else {
        status
    };
    group.kill();
    let status = match status {
        Some(status) => status,
        None => tokio::time::timeout(Duration::from_secs(3), child.wait())
            .await
            .context("Killed process did not exit")??,
    };
    // A deliberately detached process may retain the pipes after its shell
    // exits. Never let that keep the task or application alive indefinitely.
    let drained = tokio::time::timeout(Duration::from_secs(1), async {
        let (out, err) = tokio::join!(&mut stdout.0, &mut stderr.0);
        out??;
        err??;
        Ok::<_, anyhow::Error>(())
    })
    .await;
    let incomplete = drained.is_err();
    if let Ok(result) = drained {
        result?;
    }
    let stdout = output
        .lock()
        .map_err(|_| anyhow::anyhow!("Output lock poisoned"))?
        .clone();
    let stderr = errors
        .lock()
        .map_err(|_| anyhow::anyhow!("Output lock poisoned"))?
        .clone();
    Ok(ProcessResult {
        ok: status.success() && !timed_out && !cancelled,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        exit_code: status.code().unwrap_or(-1),
        timed_out,
        cancelled,
        truncated: incomplete || used.load(Ordering::Relaxed) > spec.output_limit,
        duration_ms: started.elapsed().as_millis(),
        pid,
    })
}

async fn drain(
    mut reader: impl AsyncRead + Unpin,
    stream: &'static str,
    limit: usize,
    used: Arc<AtomicUsize>,
    chunks: Option<mpsc::Sender<ProcessChunk>>,
    result: Arc<Mutex<Vec<u8>>>,
    monitor: Option<ProcessMonitor>,
) -> Result<()> {
    let mut buffer = [0_u8; 8192];
    let mut pending = Vec::new();
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        if let Some(monitor) = &monitor {
            pending.extend_from_slice(&buffer[..count]);
            let mut consumed = 0;
            while consumed < pending.len() {
                match std::str::from_utf8(&pending[consumed..]) {
                    Ok(text) => {
                        monitor.append(text)?;
                        consumed = pending.len();
                    }
                    Err(error) => {
                        let valid = error.valid_up_to();
                        monitor
                            .append(std::str::from_utf8(&pending[consumed..consumed + valid])?)?;
                        consumed += valid;
                        if let Some(invalid) = error.error_len() {
                            monitor.append("\u{fffd}")?;
                            consumed += invalid;
                        } else {
                            break;
                        }
                    }
                }
            }
            pending.drain(..consumed);
        }
        let previous = used.fetch_add(count, Ordering::Relaxed);
        let keep = count.min(limit.saturating_sub(previous));
        if keep > 0 {
            result
                .lock()
                .map_err(|_| anyhow::anyhow!("Output lock poisoned"))?
                .extend_from_slice(&buffer[..keep]);
            if let Some(chunks) = &chunks {
                let _ = chunks.try_send(ProcessChunk {
                    stream,
                    text: String::from_utf8_lossy(&buffer[..keep]).into_owned(),
                });
            }
        }
    }
    if let Some(monitor) = monitor {
        if !pending.is_empty() {
            monitor.append(&String::from_utf8_lossy(&pending))?;
        }
    }
    Ok(())
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod die_with_parent_tests {
    use std::{
        io::BufRead,
        os::unix::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };

    const HELPER: &str = "SHADOWCODE_DIE_WITH_PARENT_HELPER";

    /// A crashed ShadowCode (SIGKILL, no cleanup) takes its child along.
    #[test]
    // The helper never waits for its child on purpose: it is killed first.
    #[allow(clippy::zombie_processes)]
    fn a_child_dies_when_shadowcode_is_killed() {
        if std::env::var_os(HELPER).is_some() {
            // The helper stands in for ShadowCode: start a child, report it,
            // then wait to be killed.
            let parent = std::process::id();
            let mut command = Command::new("/bin/sleep");
            command.arg("30");
            // SAFETY: only system calls between fork and exec.
            unsafe {
                command.pre_exec(move || super::die_with_parent(parent));
            }
            let child = command.spawn().unwrap();
            println!("CHILD {}", child.id());
            std::thread::sleep(Duration::from_secs(30));
            return;
        }
        let mut helper = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "process::die_with_parent_tests::a_child_dies_when_shadowcode_is_killed",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(HELPER, "1")
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut child = None;
        for line in std::io::BufReader::new(helper.stdout.take().unwrap()).lines() {
            // libtest prints the test's name first on the same line.
            if let Some(pid) = line.unwrap().split("CHILD ").nth(1) {
                child = pid.trim().parse::<u32>().ok();
                break;
            }
        }
        let child = child.expect("the helper started its child");
        assert!(super::exists(child));
        helper.kill().unwrap();
        helper.wait().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while super::exists(child) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!super::exists(child), "child {child} outlived its parent");
    }
}
