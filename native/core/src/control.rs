//! Private local transport for command-line clients of the profile's one engine.
//! Filesystem permissions and peer credentials (a named pipe's access rules
//! and owner on Windows, see `transport`) restrict access to this OS user; it
//! deliberately opens no TCP listener and does not accept browser requests.
use crate::paths::Canonical;
use crate::{
    paths::AppPaths,
    service::{Request, Service},
    workspace::Workspace,
};
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::{
    fs,
    os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt},
};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
#[cfg(unix)]
use tokio::net::UnixListener;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Notify, Semaphore},
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;
const PROTOCOL: u32 = 1;
const REQUEST_LIMIT: usize = 8_100_000;
const RESPONSE_LIMIT: usize = 68_000_000;
const MAX_CLIENTS: usize = 16;
mod owned;
mod transport;
mod view;
pub use owned::OwnedJobs;
use transport::Stream;
pub use view::ViewClient;

#[cfg(unix)]
fn uid() -> u32 {
    // SAFETY: geteuid has no arguments, dereferences no pointers, and cannot fail.
    unsafe { libc::geteuid() }
}
#[cfg(unix)]
fn private_directory(path: &Path, create: bool) -> Result<()> {
    if create {
        match fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }
    let metadata = fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_dir()
            && !metadata.file_type().is_symlink()
            && metadata.uid() == uid()
            && metadata.mode() & 0o077 == 0,
        "Local control directory must be owned by this user and private: {}",
        path.display()
    );
    Ok(())
}
#[derive(Clone, Debug)]
pub struct Endpoint {
    path: PathBuf,
    profile: String,
}
impl Endpoint {
    pub fn for_paths(paths: &AppPaths) -> Result<Self> {
        let mut identity = Vec::new();
        for root in [&paths.config, &paths.data, &paths.state] {
            identity.extend_from_slice(root.canonical()?.as_os_str().as_encoded_bytes());
            identity.push(0);
        }
        let profile = format!("{:x}", Sha256::digest(&identity));
        #[cfg(windows)]
        let path = PathBuf::from(format!(r"\\.\pipe\shadowcode-{}", &profile[..32]));
        #[cfg(unix)]
        let path = Self::socket(&profile)?;
        Ok(Self { path, profile })
    }
    #[cfg(unix)]
    fn socket(profile: &str) -> Result<PathBuf> {
        // Derive this from UID, not each shell's environment: cron and desktop
        // sessions with different runtime/TMPDIR variables must find one engine.
        let runtime = PathBuf::from(format!("/run/user/{}", uid()));
        let directory = if private_directory(&runtime, false).is_ok() {
            runtime.join("shadowcode")
        } else {
            PathBuf::from(format!("/tmp/shadowcode-{}", uid()))
        };
        private_directory(&directory, true)?;
        let path = directory.join(format!("{}.sock", &profile[..32]));
        ensure!(
            path.as_os_str().as_encoded_bytes().len() < 104,
            "Local control socket path is too long"
        );
        Ok(path)
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn client(&self, workspace: PathBuf, session_id: Option<String>) -> Client {
        Client {
            endpoint: self.clone(),
            workspace,
            session_id,
            view: None,
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Envelope {
    protocol: u32,
    profile: String,
    workspace: PathBuf,
    session_id: Option<String>,
    #[serde(default)]
    view: Option<String>,
    request: Request,
}
#[derive(Clone)]
pub struct Client {
    endpoint: Endpoint,
    workspace: PathBuf,
    session_id: Option<String>,
    view: Option<String>,
}
impl Client {
    /// The same engine connection with requests scoped to another project
    /// (the engine forks its project selection per request).
    pub fn for_workspace(&self, workspace: PathBuf) -> Client {
        Client {
            endpoint: self.endpoint.clone(),
            workspace,
            session_id: None,
            view: None,
        }
    }
    /// Each request owns its connection. Dropping a pending request closes it;
    /// subsequent requests cannot consume an earlier abandoned response.
    pub async fn dispatch(&self, request: Request) -> Result<Value> {
        let mut stream = self.connect().await?;
        send(&mut stream, &self.envelope(request), REQUEST_LIMIT).await?;
        self.response(&mut stream).await
    }
    async fn connect(&self) -> Result<Stream> {
        transport::connect(&self.endpoint.path).await
    }
    fn envelope(&self, request: Request) -> Envelope {
        Envelope {
            protocol: PROTOCOL,
            profile: self.endpoint.profile.clone(),
            workspace: self.workspace.clone(),
            session_id: self.session_id.clone(),
            view: self.view.clone(),
            request,
        }
    }
    async fn response(&self, stream: &mut Stream) -> Result<Value> {
        let bytes = receive(stream, RESPONSE_LIMIT).await?;
        self.result(self.validate_response(&bytes)?)
    }
    fn validate_response(&self, bytes: &[u8]) -> Result<Value> {
        let response: Value = serde_json::from_slice(bytes)?;
        ensure!(
            response["protocol"] == PROTOCOL && response["profile"] == self.endpoint.profile,
            "Local engine protocol/profile mismatch; use the matching ShadowCode build"
        );
        ensure!(
            response.get("result").is_some() || response["error"].is_string(),
            "Local engine returned no result"
        );
        Ok(response)
    }
    fn result(&self, mut response: Value) -> Result<Value> {
        if let Some(error) = response["error"].as_str() {
            bail!("{error}");
        }
        Ok(response["result"].take())
    }
    pub async fn available(&self) -> Result<bool> {
        match self
            .dispatch(Request {
                method: "GET".into(),
                path: "/api/version".into(),
                body: Value::Null,
            })
            .await
        {
            Ok(version) => {
                ensure!(version["version"] == crate::VERSION, "The active ShadowCode engine is a different version; close it before using this build");
                Ok(true)
            }
            Err(error)
                if error.downcast_ref::<std::io::Error>().is_some_and(|error| {
                    matches!(
                        error.kind(),
                        std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
                    )
                }) =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }
    /// Poll until a matching engine is listening, or fail on version mismatch.
    pub async fn wait_available(&self, timeout: Duration) -> Result<()> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            match self.available().await {
                Ok(true) => return Ok(()),
                Ok(false) if tokio::time::Instant::now() < deadline => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Ok(false) => bail!("No running engine is available to attach"),
                Err(error)
                    if error.to_string().contains("different version")
                        || error.to_string().contains("protocol/profile mismatch") =>
                {
                    return Err(error);
                }
                Err(_error) if tokio::time::Instant::now() < deadline => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Err(error) => return Err(error),
            }
        }
    }
}
#[cfg(unix)]
/// A socket younger than this may belong to an engine between bind and listen.
const STALE_SOCKET_AGE: Duration = Duration::from_secs(10);

#[cfg(unix)]
fn engine_socket_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.strip_suffix(".sock"))
        .is_some_and(|stem| {
            stem.len() == 32
                && stem
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}

#[cfg(unix)]
/// True only when nothing listens on the socket (ECONNREFUSED). A live
/// engine accepts or reports a full backlog; both count as alive.
fn socket_refuses(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let bytes = path.as_os_str().as_bytes();
    // SAFETY: sockaddr_un is plain old data; all-zero is a valid value.
    let mut addr: libc::sockaddr_un = unsafe { std::mem::zeroed() };
    if bytes.is_empty() || bytes.len() >= addr.sun_path.len() {
        return false;
    }
    addr.sun_family = libc::AF_UNIX as libc::sa_family_t;
    for (dst, src) in addr.sun_path.iter_mut().zip(bytes) {
        *dst = *src as libc::c_char;
    }
    // SAFETY: plain socket(2) call; the descriptor is closed below.
    #[cfg(target_os = "linux")]
    let fd = unsafe {
        libc::socket(
            libc::AF_UNIX,
            libc::SOCK_STREAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
            0,
        )
    };
    // macOS has no SOCK_NONBLOCK/SOCK_CLOEXEC: set both with fcntl(2) before
    // the descriptor is used.
    #[cfg(not(target_os = "linux"))]
    let fd = unsafe {
        let fd = libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0);
        if fd >= 0
            && (libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) != 0
                || libc::fcntl(fd, libc::F_SETFL, libc::O_NONBLOCK) != 0)
        {
            libc::close(fd);
            -1
        } else {
            fd
        }
    };
    if fd < 0 {
        return false;
    }
    // SAFETY: addr is a fully initialized sockaddr_un and the length matches.
    let rc = unsafe {
        libc::connect(
            fd,
            (&addr as *const libc::sockaddr_un).cast::<libc::sockaddr>(),
            std::mem::size_of::<libc::sockaddr_un>() as libc::socklen_t,
        )
    };
    let error = std::io::Error::last_os_error().raw_os_error();
    // SAFETY: fd was returned by socket(2) above and is closed exactly once.
    unsafe { libc::close(fd) };
    rc != 0 && error == Some(libc::ECONNREFUSED)
}

#[cfg(unix)]
/// Remove engine control sockets (`<32 hex>.sock`) in `directory` that belong
/// to this user, are older than `min_age`, and refuse connections. Live
/// engines answer and are never touched; `keep` (this engine's own path) is
/// handled by the caller. Returns the removed paths.
pub fn sweep_stale_sockets(directory: &Path, keep: &Path, min_age: Duration) -> Vec<PathBuf> {
    let mut removed = Vec::new();
    let Ok(entries) = fs::read_dir(directory) else {
        return removed;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten().take(4096) {
        let path = entry.path();
        if path == keep || !engine_socket_name(&path) {
            continue;
        }
        let Ok(before) = fs::symlink_metadata(&path) else {
            continue;
        };
        // A time just ahead of `now` (clock steps, timestamp granularity)
        // counts as age zero rather than as never old enough.
        let old_enough = before
            .modified()
            .ok()
            .map(|m| now.duration_since(m).unwrap_or(Duration::ZERO))
            .is_some_and(|age| age >= min_age);
        if !before.file_type().is_socket() || before.uid() != uid() || !old_enough {
            continue;
        }
        if !socket_refuses(&path) {
            continue;
        }
        // Remove only the exact file that was probed.
        if fs::symlink_metadata(&path)
            .is_ok_and(|now| now.dev() == before.dev() && now.ino() == before.ino())
            && fs::remove_file(&path).is_ok()
        {
            removed.push(path);
        }
    }
    removed
}

#[cfg(unix)]
struct SocketLease {
    path: PathBuf,
    dev: u64,
    ino: u64,
}
#[cfg(unix)]
impl Drop for SocketLease {
    fn drop(&mut self) {
        if fs::symlink_metadata(&self.path)
            .is_ok_and(|m| m.dev() == self.dev && m.ino() == self.ino)
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}
struct State {
    cancel: CancellationToken,
    finished: AtomicBool,
    done: Notify,
}
struct Completion(Arc<State>);
impl Drop for Completion {
    fn drop(&mut self) {
        self.0.finished.store(true, Ordering::Release);
        self.0.done.notify_waiters();
    }
}
pub struct Server {
    state: Arc<State>,
    endpoint: Endpoint,
}
impl Server {
    /// The Service already holds the profile lock. A live endpoint is never
    /// unlinked, even if another caller tries to serve the same engine twice.
    pub fn start(service: Service) -> Result<Self> {
        Self::start_with_mode(service, "desktop")
    }
    pub fn start_with_mode(service: Service, mode: &str) -> Result<Self> {
        ensure!(
            matches!(mode, "desktop" | "server" | "command" | "tui" | "acp"),
            "Invalid engine mode"
        );
        let mode = mode.to_owned();
        service.set_engine_mode(&mode);
        let endpoint = Endpoint::for_paths(service.engine.paths())?;
        #[cfg(unix)]
        let (mut listener, lease) = bind(&endpoint)?;
        // A pipe disappears with its last handle; there is nothing to sweep.
        #[cfg(windows)]
        let (mut listener, lease) = (transport::Listener::bind(&endpoint.path)?, ());
        let state = Arc::new(State {
            cancel: CancellationToken::new(),
            finished: AtomicBool::new(false),
            done: Notify::new(),
        });
        // Persistent owners (the desktop and `shadowcode serve`) run remote
        // access and phone notifications; both stop when this endpoint does.
        if matches!(mode.as_str(), "desktop" | "server") {
            service
                .remote()
                .activate(&service, state.cancel.child_token());
        }
        let running = state.clone();
        let profile = endpoint.profile.clone();
        tokio::spawn(async move {
            let _completion = Completion(running.clone());
            let _lease = lease;
            let mut clients = JoinSet::new();
            let owners = Arc::new(Semaphore::new(8));
            let views = view::Registry::default();
            loop {
                tokio::select! {
                    _=running.cancel.cancelled()=>break,
                    Some(_)=clients.join_next(),if !clients.is_empty()=>{},
                    accepted=accept(&mut listener),if clients.len()<MAX_CLIENTS=>match accepted {
                        Ok(stream)=>{
                            let service=service.clone();let profile=profile.clone();let mode=mode.clone();let owners=owners.clone();let views=views.clone();
                            clients.spawn(async move {let _=handle(stream, service, profile, mode, owners, views).await;});
                        }
                        Err(_)=>break,
                    }
                }
            }
            clients.abort_all();
            while clients.join_next().await.is_some() {}
            drop(listener);
            #[cfg(unix)]
            drop(_lease);
            drop(service);
        });
        Ok(Self { state, endpoint })
    }
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }
    pub fn close(&self) {
        self.state.cancel.cancel();
    }
    pub async fn wait_closed(&self) {
        loop {
            let notified = self.state.done.notified();
            if self.state.finished.load(Ordering::Acquire) {
                break;
            }
            notified.await;
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.close();
    }
}
#[cfg(unix)]
fn bind(endpoint: &Endpoint) -> Result<(UnixListener, SocketLease)> {
    if let Some(directory) = endpoint.path.parent() {
        // Crashed or killed engines leave their socket files behind.
        sweep_stale_sockets(directory, &endpoint.path, STALE_SOCKET_AGE);
    }
    if let Ok(metadata) = fs::symlink_metadata(&endpoint.path) {
        ensure!(
            metadata.file_type().is_socket() && metadata.uid() == uid(),
            "Refusing to replace a non-socket local control path"
        );
        ensure!(
            std::os::unix::net::UnixStream::connect(&endpoint.path).is_err(),
            "Local engine control endpoint is already running"
        );
        fs::remove_file(&endpoint.path)?;
    }
    let listener = UnixListener::bind(&endpoint.path)?;
    fs::set_permissions(&endpoint.path, fs::Permissions::from_mode(0o600))?;
    let metadata = fs::symlink_metadata(&endpoint.path)?;
    let lease = SocketLease {
        path: endpoint.path.clone(),
        dev: metadata.dev(),
        ino: metadata.ino(),
    };
    Ok((listener, lease))
}
#[cfg(unix)]
async fn accept(listener: &mut UnixListener) -> std::io::Result<Stream> {
    listener.accept().await.map(|(stream, _)| stream)
}
#[cfg(windows)]
async fn accept(listener: &mut transport::Listener) -> Result<Stream> {
    listener.accept().await
}
async fn handle(
    mut stream: Stream,
    service: Service,
    profile: String,
    mode: String,
    owners: Arc<Semaphore>,
    views: view::Registry,
) -> Result<()> {
    ensure!(transport::peer_is_this_user(&stream)?, "Wrong peer user");
    let response = async {
        let bytes =
            tokio::time::timeout(Duration::from_secs(10), receive(&mut stream, REQUEST_LIMIT))
                .await
                .context("Local request timed out")??;
        let envelope: Envelope = serde_json::from_slice(&bytes).context("Invalid local request")?;
        ensure!(
            envelope.protocol == PROTOCOL && envelope.profile == profile,
            "Local engine protocol/profile mismatch"
        );
        if envelope.request.path == "/api/views" && envelope.request.method == "POST" {
            ensure!(mode != "command", "A foreground CLI task owns this profile; wait for it to finish or use shadowcode serve");
            ensure!(envelope.view.is_none(), "Cannot nest an attached view");
            let scoped = service.fork_selection(envelope.workspace, envelope.session_id)?;
            return view::serve(&mut stream, scoped, &profile, views).await;
        }
        if envelope.request.path == "/api/runtime" && envelope.request.method == "GET" {
            return Ok(json!({"mode":mode,"persistent":mode!="command","pid":std::process::id(),"version":crate::VERSION}));
        }
        if envelope.request.path == "/api/owned-jobs" && envelope.request.method == "POST" {
            ensure!(mode != "command" || transport::peer_pid(&stream)? == Some(std::process::id() as i32), "A foreground CLI task owns this profile; use the desktop or shadowcode serve for concurrent work");
            let permit = owners.try_acquire_owned().context("At most eight task ownership connections may be active")?;
            let scoped = service.fork_selection(envelope.workspace, envelope.session_id)?;
            return owned::serve(&mut stream, scoped, &profile, permit).await;
        }
        if mode == "command" && envelope.request.method != "GET" {
            ensure!(envelope.request.path.starts_with("/api/approvals/") || (envelope.request.path.starts_with("/api/jobs/") && (envelope.request.path.ends_with("/cancel") || envelope.request.path.ends_with("/spending"))), "A foreground CLI task owns this profile. Other clients can inspect it, approve tools, answer a spending limit, or cancel it; use the desktop or shadowcode serve for concurrent work.");
        }
        let scoped = if let Some(id) = envelope.view {
            views.get(&id)?
        } else {
            let workspace = Workspace::open(&envelope.workspace)?.path;
            service.fork_selection(workspace, envelope.session_id)?
        };
        // Pipelining is deliberately unsupported. EOF or extra bytes abandon
        // this request; ordinary job execution remains durable in the engine.
        let mut extra = [0u8; 1];
        tokio::select! {
            result=scoped.dispatch(envelope.request)=>result,
            _=stream.read(&mut extra)=>bail!("Client disconnected or pipelined another request"),
        }
    }
    .await;
    let value = match response {
        Ok(result) => json!({"protocol":PROTOCOL,"profile":profile,"result":result}),
        Err(error) => json!({"protocol":PROTOCOL,"profile":profile,"error":format!("{error:#}")}),
    };
    let bytes = encode(&value, RESPONSE_LIMIT).unwrap_or_else(|error| {
        // No bytes have been sent yet, so a bounded, structured error can still
        // explain a large result instead of appearing as an unexplained EOF.
        json!({"protocol":PROTOCOL,"profile":profile,"error":format!("Could not encode local response: {error}")}).to_string().into_bytes()
    });
    send_bytes(&mut stream, &bytes).await
}
async fn receive(
    stream: &mut (impl tokio::io::AsyncRead + Unpin),
    limit: usize,
) -> Result<Vec<u8>> {
    let size = stream.read_u32().await? as usize;
    ensure!(
        size > 0 && size <= limit,
        "Local message exceeds its size limit"
    );
    let mut bytes = vec![0; size];
    stream.read_exact(&mut bytes).await?;
    Ok(bytes)
}
async fn send(
    stream: &mut (impl tokio::io::AsyncWrite + Unpin),
    value: &impl Serialize,
    limit: usize,
) -> Result<()> {
    send_bytes(stream, &encode(value, limit)?).await
}
fn encode(value: &impl Serialize, limit: usize) -> Result<Vec<u8>> {
    struct Bounded {
        bytes: Vec<u8>,
        limit: usize,
    }
    impl Write for Bounded {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if self.bytes.len().saturating_add(buf.len()) > self.limit {
                return Err(std::io::Error::other(
                    "Local response exceeds its size limit",
                ));
            }
            self.bytes.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut buffer = Bounded {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut buffer, value)?;
    Ok(buffer.bytes)
}
async fn send_bytes(stream: &mut (impl tokio::io::AsyncWrite + Unpin), bytes: &[u8]) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(15), async {
        stream.write_u32(bytes.len() as u32).await?;
        stream.write_all(bytes).await
    })
    .await
    .context("Local peer stopped reading")??;
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener as StdListener;

    #[test]
    fn stale_sockets_are_swept_without_touching_live_ones() {
        let dir = tempfile::tempdir().unwrap();
        let dead = dir.path().join(format!("{}.sock", "a".repeat(32)));
        let live = dir.path().join(format!("{}.sock", "b".repeat(32)));
        let own = dir.path().join(format!("{}.sock", "c".repeat(32)));
        let foreign_name = dir.path().join("other.sock");
        let not_socket = dir.path().join(format!("{}.sock", "d".repeat(32)));
        // Dropping a std listener leaves its file behind, like a killed engine.
        drop(StdListener::bind(&dead).unwrap());
        drop(StdListener::bind(&own).unwrap());
        drop(StdListener::bind(&foreign_name).unwrap());
        let _live = StdListener::bind(&live).unwrap();
        fs::write(&not_socket, b"x").unwrap();
        // Another test forking at the moment of bind can hold a copy of a
        // listener until its child execs; wait until both are really closed.
        let started = std::time::Instant::now();
        while !(socket_refuses(&dead) && socket_refuses(&own)) {
            assert!(started.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(20));
        }

        // Young sockets are left alone (an engine may be between bind and listen).
        assert!(sweep_stale_sockets(dir.path(), &own, Duration::from_secs(3600)).is_empty());
        assert!(dead.exists());

        let removed = sweep_stale_sockets(dir.path(), &own, Duration::ZERO);
        assert_eq!(removed, vec![dead.clone()]);
        assert!(!dead.exists());
        assert!(live.exists(), "a listening engine must never be removed");
        assert!(
            own.exists(),
            "the caller's own endpoint is handled separately"
        );
        assert!(foreign_name.exists() && not_socket.exists());
        assert!(socket_refuses(&own));
        assert!(!socket_refuses(&live));
    }

    #[test]
    fn a_socket_dated_ahead_of_the_clock_counts_as_age_zero() {
        use std::os::unix::ffi::OsStrExt;
        let dir = tempfile::tempdir().unwrap();
        let dead = dir.path().join(format!("{}.sock", "a".repeat(32)));
        let own = dir.path().join(format!("{}.sock", "c".repeat(32)));
        drop(StdListener::bind(&dead).unwrap());
        let started = std::time::Instant::now();
        while !socket_refuses(&dead) {
            assert!(started.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(20));
        }
        // Date the dead socket a minute ahead of now.
        let ahead = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            + Duration::from_secs(60);
        let stamp = libc::timespec {
            tv_sec: ahead.as_secs() as libc::time_t,
            tv_nsec: 0,
        };
        let path = std::ffi::CString::new(dead.as_os_str().as_bytes()).unwrap();
        // SAFETY: a valid C path and two initialised timespecs.
        let set = unsafe {
            libc::utimensat(
                libc::AT_FDCWD,
                path.as_ptr(),
                [stamp, stamp].as_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        assert_eq!(set, 0, "{}", std::io::Error::last_os_error());

        // Any real minimum age still leaves it alone; zero sweeps it.
        assert!(sweep_stale_sockets(dir.path(), &own, Duration::from_secs(1)).is_empty());
        assert!(dead.exists());
        assert_eq!(
            sweep_stale_sockets(dir.path(), &own, Duration::ZERO),
            vec![dead.clone()]
        );
        assert!(!dead.exists());
    }
}
