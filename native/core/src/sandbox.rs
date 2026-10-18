//! Shell isolation for the native `exec` tool.
//!
//! With bubblewrap: system folders are read-only, the home directory is an
//! empty temporary one with only the configured toolchain folders
//! (`sandbox.home_binds`) mounted read-only, the project is writable, and the
//! network is off, on, or limited to `network.allow` through a proxy.
//! Credential folders (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`, ...) are
//! never mounted.
//!
//! Without bubblewrap: `sandbox.require` refuses the command; otherwise it
//! runs under Landlock file (and TCP) restrictions when the kernel has them,
//! and the user is warned once per conversation.
//!
//! Availability is probed before a user command runs; commands are never
//! replayed outside the sandbox after a runtime failure.
use crate::config::{Config, ShellNetwork};
use crate::paths::Canonical;
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
mod lsm;
#[cfg(target_os = "linux")]
mod netns;
pub mod proxy;
#[cfg(target_os = "macos")]
mod seatbelt;

/// Home entries that toolchains commonly need, mounted read-only.
pub const DEFAULT_HOME_BINDS: &[&str] = &[
    ".cargo",
    ".rustup",
    ".nvm",
    ".npm",
    ".cache/pip",
    ".local/bin",
    ".gitconfig",
    ".pyenv",
    ".bun",
    ".deno",
];
/// Home entries that are never mounted, and are hidden when the project
/// itself contains them.
pub const DENIED_HOME: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".config",
    ".local/share",
    ".netrc",
    ".docker",
    ".kube",
    ".password-store",
    ".pki",
    ".azure",
    ".npmrc",
    ".pypirc",
    ".git-credentials",
    ".mozilla",
    ".var",
];
/// Credential files inside allowed toolchain folders; replaced by an empty file.
const MASKED_IN_BINDS: &[&str] = &[".cargo/credentials", ".cargo/credentials.toml"];
const SYSTEM_ROOTS: &[&str] = &[
    "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/etc", "/opt", "/nix",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct SandboxConfig {
    /// Refuse shell commands when bubblewrap is unavailable.
    pub require: bool,
    /// Paths relative to the home directory mounted read-only in the sandbox.
    pub home_binds: Vec<String>,
    /// Apply Landlock when a command has to run without bubblewrap.
    pub landlock: bool,
}
impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            require: false,
            home_binds: DEFAULT_HOME_BINDS.iter().map(|s| (*s).to_owned()).collect(),
            landlock: true,
        }
    }
}
impl SandboxConfig {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.home_binds.len() <= 64,
            "At most 64 sandbox.home_binds entries"
        );
        for entry in &self.home_binds {
            validate_home_entry(entry)
                .with_context(|| format!("Invalid sandbox.home_binds entry '{entry}'"))?;
        }
        Ok(())
    }
}

fn validate_home_entry(entry: &str) -> Result<()> {
    let path = Path::new(entry);
    ensure!(
        !entry.is_empty() && entry.len() <= 200 && !entry.contains('\0'),
        "Use a path relative to your home folder, for example .cargo"
    );
    ensure!(
        path.components().all(|c| matches!(c, Component::Normal(_))),
        "Use a path relative to your home folder without '..', '~' or a leading '/'"
    );
    ensure!(!entry.starts_with('~'), "Leave out '~/'");
    for denied in DENIED_HOME {
        let denied = Path::new(denied);
        ensure!(
            !(path.starts_with(denied) || denied.starts_with(path)),
            "{} holds credentials and is never mounted",
            denied.display()
        );
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SandboxMode {
    Off { reason: String },
    Bubblewrap,
}
#[derive(Clone, Debug, Default)]
pub struct ScratchSession {
    pub path: PathBuf,
}
static SCRATCH: LazyLock<Mutex<HashMap<PathBuf, tempfile::TempDir>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static WARNED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn which(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(name);
            let metadata = candidate.metadata().ok()?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o111 == 0 {
                    return None;
                }
            }
            metadata.is_file().then_some(candidate)
        })
    })
}
pub fn detect() -> SandboxMode {
    match which("bwrap") {
        Some(_) => SandboxMode::Bubblewrap,
        None => SandboxMode::Off {
            reason: "bubblewrap is not installed".into(),
        },
    }
}

/// True the first time a conversation should see the "no bubblewrap" warning.
pub fn first_warning(session: &str) -> bool {
    WARNED
        .lock()
        .map(|mut seen| seen.insert(session.to_owned()))
        .unwrap_or(true)
}

/// Only directories created and retained by this process can be discarded.
pub fn create_scratch(base: &Path) -> Result<ScratchSession> {
    crate::paths::private_directory(base)?;
    let owned = tempfile::Builder::new()
        .prefix("shadowcode-scratch-")
        .tempdir_in(base)?;
    let path = owned.path().canonical()?;
    SCRATCH
        .lock()
        .map_err(|_| anyhow::anyhow!("Scratch lock poisoned"))?
        .insert(path.clone(), owned);
    Ok(ScratchSession { path })
}
pub fn discard_scratch(path: &Path) -> Result<Value> {
    let mut scratch = SCRATCH
        .lock()
        .map_err(|_| anyhow::anyhow!("Scratch lock poisoned"))?;
    let owned = scratch
        .remove(path)
        .context("Refusing to remove an unregistered scratch directory")?;
    owned.close()?;
    Ok(
        json!({"ok":true,"discarded":path,"note":"Removed this command's managed temporary directory."}),
    )
}
#[cfg_attr(not(unix), allow(dead_code))]
fn scratch_base() -> PathBuf {
    #[cfg(unix)]
    // SAFETY: geteuid cannot fail.
    let user = unsafe { libc::geteuid() }.to_string();
    // Windows: the temporary folder is already the user's own.
    #[cfg(not(unix))]
    let user = "user";
    std::env::temp_dir().join(format!("shadowcode-scratch-{user}"))
}

fn probe(program: &Path, workspace: &Path) -> Result<()> {
    let mut child = Command::new(program)
        .args(profile_args(workspace, "true", false, None))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.try_wait()? {
            ensure!(
                status.success(),
                "bubblewrap is installed but its namespace/mount probe failed ({status})"
            );
            return Ok(());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            anyhow::bail!("bubblewrap availability probe timed out");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn working_bwrap(workspace: &Path) -> Result<PathBuf> {
    let program = which("bwrap").context("bubblewrap is not installed")?;
    probe(&program, workspace)?;
    Ok(program)
}

/// Scratch availability is not evidence of workspace copy-on-write.
pub fn probe_workspace_cow() -> Value {
    let result = (|| -> Result<()> {
        let temp = tempfile::tempdir()?;
        working_bwrap(temp.path()).map(|_| ())
    })();
    let available = result.is_ok();
    let detail = match result {
        Ok(()) => "Bubblewrap works: shell commands see an empty home folder with read-only toolchains, and project writes are live. Copy-on-write and approve-before-keep are not implemented; rewind restores project files afterwards.".into(),
        Err(error) => format!("{error}. Workspace copy-on-write is unavailable."),
    };
    json!({"ok":false,"workspace_cow":false,"shell_available":available,
        "mode":if available {"scratch-only"} else {"unavailable"},
        "detail":detail,"kernel_proof":false})
}
/// Network inside the bubblewrap profile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Net {
    Off,
    On,
    /// A private namespace whose only way out is the allow-list proxy.
    Proxy,
}

/// What the sandbox shows of the home folder.
#[derive(Clone, Debug, Default)]
pub struct HomeLayout {
    pub home: Option<PathBuf>,
    /// (real source, path inside the sandbox)
    pub binds: Vec<(PathBuf, PathBuf)>,
    /// Files replaced by an empty read-only file.
    pub masked_files: Vec<PathBuf>,
    /// Folders inside the project replaced by an empty folder.
    pub masked_dirs: Vec<PathBuf>,
    pub skipped: Vec<String>,
}

fn real(path: &Path) -> PathBuf {
    path.canonical().unwrap_or_else(|_| path.to_path_buf())
}

impl HomeLayout {
    pub fn current(entries: &[String], workspace: &Path) -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|h| h.is_absolute() && h.parent().is_some());
        Self::build(home, entries, workspace)
    }
    pub fn build(home: Option<PathBuf>, entries: &[String], workspace: &Path) -> Self {
        let mut layout = Self {
            home: home.clone(),
            ..Self::default()
        };
        let Some(home) = home else {
            return layout;
        };
        let home_real = real(&home);
        let workspace = real(workspace);
        let denied: Vec<PathBuf> = DENIED_HOME.iter().map(|d| real(&home.join(d))).collect();
        for entry in entries {
            if validate_home_entry(entry).is_err() {
                layout.skipped.push(format!("{entry} (not allowed)"));
                continue;
            }
            let dest = home.join(entry);
            let Ok(source) = dest.canonical() else {
                continue;
            };
            // A symlink must not smuggle in a credential folder or the whole home.
            let unsafe_source = source == Path::new("/")
                || home_real.starts_with(&source)
                || denied
                    .iter()
                    .any(|d| source.starts_with(d) || d.starts_with(&source));
            if unsafe_source {
                layout
                    .skipped
                    .push(format!("{entry} (points at a protected folder)"));
                continue;
            }
            for masked in MASKED_IN_BINDS {
                if Path::new(masked).starts_with(entry) {
                    let path = home.join(masked);
                    if path.is_file() {
                        layout.masked_files.push(path);
                    }
                }
            }
            layout.binds.push((source, dest));
        }
        // A project that contains the home folder (or a credential folder)
        // must not expose it through its own writable mount.
        for (_relative, resolved) in DENIED_HOME.iter().zip(&denied) {
            if !resolved.starts_with(&workspace) {
                continue;
            }
            // Mask the resolved target's real location, so a credential folder
            // reached through a symlink (for example `.ssh -> dotfiles/ssh`, as
            // dotfile managers create) is hidden at the real path the project
            // mount also exposes, not only at the symlink's name.
            match std::fs::symlink_metadata(resolved) {
                Ok(meta) if meta.is_dir() => layout.masked_dirs.push(resolved.clone()),
                Ok(meta) if meta.is_file() => layout.masked_files.push(resolved.clone()),
                _ => {}
            }
        }
        layout
    }
}

/// Compatibility wrapper: the current home layout with the default binds.
pub fn profile_args(
    workspace: &Path,
    command: &str,
    allow_network: bool,
    scratch: Option<&Path>,
) -> Vec<String> {
    let binds: Vec<String> = DEFAULT_HOME_BINDS.iter().map(|s| (*s).to_owned()).collect();
    isolated_args(
        workspace,
        command,
        if allow_network { Net::On } else { Net::Off },
        scratch,
        &HomeLayout::current(&binds, workspace),
    )
}

pub fn isolated_args(
    workspace: &Path,
    command: &str,
    net: Net,
    scratch: Option<&Path>,
    layout: &HomeLayout,
) -> Vec<String> {
    let ws = real(workspace);
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut args: Vec<String> = [
        "--die-with-parent",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
        "--new-session",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    if net == Net::Off {
        args.push("--unshare-net".into());
    }
    for root in SYSTEM_ROOTS {
        if Path::new(root).exists() {
            args.extend(["--ro-bind".into(), (*root).into(), (*root).into()]);
        }
    }
    args.extend(
        [
            "--tmpfs", "/tmp", "--tmpfs", "/var/tmp", "--dev", "/dev", "--proc", "/proc",
        ]
        .map(str::to_owned),
    );
    // An empty home: other users' folders and every file in this user's
    // home are hidden, then the allowed toolchain folders come back read-only.
    if Path::new("/home").is_dir() {
        args.extend(["--tmpfs".into(), "/home".into()]);
    }
    if let Some(home) = &layout.home {
        if !SYSTEM_ROOTS.iter().any(|r| Path::new(r) == home) && home != Path::new("/") {
            args.extend(["--tmpfs".into(), s(home)]);
        }
        for (source, dest) in &layout.binds {
            args.extend(["--ro-bind".into(), s(source), s(dest)]);
        }
    }
    for file in layout.masked_files.iter().filter(|f| !f.starts_with(&ws)) {
        args.extend(["--ro-bind".into(), "/dev/null".into(), s(file)]);
    }
    // Bind the project after home, otherwise the home tmpfs hides it.
    args.extend(["--bind".into(), s(&ws), s(&ws)]);
    for dir in &layout.masked_dirs {
        args.extend(["--tmpfs".into(), s(dir)]);
    }
    for file in layout.masked_files.iter().filter(|f| f.starts_with(&ws)) {
        args.extend(["--ro-bind".into(), "/dev/null".into(), s(file)]);
    }
    if let Some(home) = &layout.home {
        args.extend(["--setenv".into(), "HOME".into(), s(home)]);
    }
    match net {
        Net::On => {
            // /etc/resolv.conf often links into /run, which is not mounted.
            if let Ok(resolv) = Path::new("/etc/resolv.conf").canonical() {
                if let Some(dir) = resolv.parent().filter(|d| d.starts_with("/run")) {
                    args.extend(["--ro-bind".into(), s(dir), s(dir)]);
                }
            }
        }
        Net::Proxy => {
            let url = format!("http://127.0.0.1:{}", proxy::PROXY_PORT);
            for name in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "http_proxy",
                "https_proxy",
                "ALL_PROXY",
                "all_proxy",
            ] {
                args.extend(["--setenv".into(), name.into(), url.clone()]);
            }
            for name in ["NO_PROXY", "no_proxy"] {
                args.extend(["--unsetenv".into(), name.into()]);
            }
        }
        Net::Off => {}
    }
    if let Some(scratch) = scratch {
        args.extend([
            "--bind".into(),
            s(scratch),
            "/shadowcode-scratch".into(),
            "--setenv".into(),
            "SHADOWCODE_SCRATCH".into(),
            "/shadowcode-scratch".into(),
        ]);
    }
    args.extend([
        "--chdir".into(),
        s(&ws),
        "--".into(),
        "/bin/sh".into(),
        "-c".into(),
        command.into(),
    ]);
    args
}

/// Work done in the forked child before exec (namespace or Landlock), and
/// the proxy served for it afterwards.
#[derive(Clone, Default)]
pub struct ChildSetup {
    #[cfg(target_os = "linux")]
    netns: Option<Arc<netns::Netns>>,
    #[cfg(target_os = "linux")]
    landlock: Option<Arc<std::os::fd::OwnedFd>>,
    gate: Option<Arc<proxy::Gate>>,
    /// Flatpak host commands: the proxy's Unix socket, reached through the
    /// relay inside the host bubblewrap network namespace.
    #[cfg(unix)]
    relay: Option<Arc<RelaySocket>>,
    /// macOS: the proxy's loopback listener, the only address the
    /// command's Seatbelt profile may connect to.
    #[cfg(target_os = "macos")]
    listener: Option<Arc<Mutex<Option<std::net::TcpListener>>>>,
}
/// The proxy's listening Unix socket and the private folder holding it,
/// removed when the command's setup is dropped.
#[cfg(unix)]
pub struct RelaySocket {
    listener: Mutex<Option<std::os::unix::net::UnixListener>>,
    dir: tempfile::TempDir,
}
#[cfg(unix)]
impl RelaySocket {
    /// Bind a fresh socket in a private folder below `base`.
    pub fn bind(base: &Path) -> Result<Self> {
        let dir = tempfile::Builder::new()
            .prefix("scp-")
            .tempdir_in(base)
            .context("Could not create the allow-list proxy folder")?;
        let path = dir.path().join(RELAY_SOCKET);
        // sockaddr_un holds 107 bytes and a terminating NUL.
        ensure!(
            path.as_os_str().len() < 108,
            "The allow-list proxy socket path is too long ({})",
            path.display()
        );
        let listener = std::os::unix::net::UnixListener::bind(&path)
            .context("Could not create the allow-list proxy socket")?;
        Ok(Self {
            listener: Mutex::new(Some(listener)),
            dir,
        })
    }
    pub fn dir(&self) -> &Path {
        self.dir.path()
    }
}
#[cfg(unix)]
impl std::fmt::Debug for RelaySocket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RelaySocket")
            .field("dir", &self.dir.path())
            .finish()
    }
}
/// Socket file name inside the relay folder.
const RELAY_SOCKET: &str = "p";
/// Where the relay binary and the proxy folder appear inside bubblewrap.
const RELAY_IN_SANDBOX: &str = "/shadowcode-proxy-relay";
const RELAY_DIR_IN_SANDBOX: &str = "/shadowcode-proxy";

/// Turn an [`isolated_args`] profile built with [`Net::Proxy`] into one that
/// a host bubblewrap enforces by itself: a private network namespace whose
/// only way out is `relay`, forwarding loopback port [`proxy::PROXY_PORT`] to
/// the proxy socket in `socket_dir`. Refuses rather than guess if the profile
/// does not have the expected shape.
pub fn host_relay_args(
    mut args: Vec<String>,
    relay: &Path,
    socket_dir: &Path,
) -> Result<Vec<String>> {
    let separator = args
        .iter()
        .rposition(|arg| arg == "--")
        .context("Sandbox profile has no command separator")?;
    ensure!(
        args[separator + 1..].first().map(String::as_str) == Some("/bin/sh"),
        "Sandbox profile has an unexpected command"
    );
    ensure!(
        !args[..separator].iter().any(|arg| arg == "--share-net"),
        "Sandbox profile shares the network"
    );
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let insert = [
        "--unshare-net".to_owned(),
        "--ro-bind".to_owned(),
        s(relay),
        RELAY_IN_SANDBOX.to_owned(),
        "--ro-bind".to_owned(),
        s(socket_dir),
        RELAY_DIR_IN_SANDBOX.to_owned(),
    ];
    let relay_command = [
        RELAY_IN_SANDBOX.to_owned(),
        format!("{RELAY_DIR_IN_SANDBOX}/{RELAY_SOCKET}"),
        proxy::PROXY_PORT.to_string(),
    ];
    args.splice(separator + 1..separator + 1, relay_command);
    args.splice(separator..separator, insert);
    Ok(args)
}
impl std::fmt::Debug for ChildSetup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut d = f.debug_struct("ChildSetup");
        #[cfg(target_os = "linux")]
        d.field("netns", &self.netns.is_some())
            .field("landlock", &self.landlock.is_some());
        d.field("proxy", &self.gate.is_some());
        #[cfg(unix)]
        d.field("relay", &self.relay);
        d.finish()
    }
}
/// Stops the allow-list proxy when the command's process is finished.
pub struct ProxyGuard(tokio::task::JoinHandle<()>);
impl Drop for ProxyGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}
impl ChildSetup {
    /// # Safety
    /// Call only between fork and exec: it only makes system calls.
    pub unsafe fn enter(&self) -> std::io::Result<()> {
        #[cfg(target_os = "linux")]
        {
            if let Some(netns) = &self.netns {
                netns.enter()?;
            }
            if let Some(fd) = &self.landlock {
                lsm::restrict(fd)?;
            }
        }
        Ok(())
    }
    /// In the parent, right after the child started.
    pub fn after_spawn(&self) -> Result<Option<ProxyGuard>> {
        #[cfg(target_os = "linux")]
        if let (Some(netns), Some(gate)) = (&self.netns, &self.gate) {
            let listener = netns.receive()?;
            return Ok(Some(ProxyGuard(proxy::spawn(listener, gate.clone())?)));
        }
        #[cfg(target_os = "macos")]
        if let (Some(listener), Some(gate)) = (&self.listener, &self.gate) {
            let listener = listener
                .lock()
                .map_err(|_| anyhow::anyhow!("Proxy listener lock poisoned"))?
                .take()
                .context("The allow-list proxy listener was already used")?;
            return Ok(Some(ProxyGuard(proxy::spawn(listener, gate.clone())?)));
        }
        #[cfg(unix)]
        if let (Some(relay), Some(gate)) = (&self.relay, &self.gate) {
            let listener = relay
                .listener
                .lock()
                .map_err(|_| anyhow::anyhow!("Proxy socket lock poisoned"))?
                .take()
                .context("The allow-list proxy socket was already used")?;
            return Ok(Some(ProxyGuard(proxy::spawn_unix(listener, gate.clone())?)));
        }
        Ok(None)
    }
}

/// The shell settings that apply to one command.
#[derive(Clone, Debug)]
pub struct ShellPolicy {
    pub network: ShellNetwork,
    pub allow: Vec<proxy::AllowEntry>,
    pub allow_text: Vec<String>,
    pub home_binds: Vec<String>,
    pub require: bool,
    pub landlock: bool,
}
impl ShellPolicy {
    pub fn from_config(config: &Config) -> Result<Self> {
        Ok(Self {
            network: config.shell_network(),
            allow: proxy::parse_list(&config.network.allow)?,
            allow_text: config.network.allow.clone(),
            home_binds: config.sandbox.home_binds.clone(),
            require: config.sandbox.require,
            landlock: config.sandbox.landlock,
        })
    }
}

/// A shell command ready to run.
#[derive(Debug)]
pub struct PreparedShell {
    pub program: String,
    pub args: Vec<String>,
    pub child: Option<ChildSetup>,
    pub scratch: Option<PathBuf>,
    pub gate: Option<Arc<proxy::Gate>>,
    /// Recorded with the tool result.
    pub note: Value,
    /// Shown once per conversation when isolation is weaker than expected.
    pub warning: Option<String>,
}

fn network_label(network: ShellNetwork) -> &'static str {
    match network {
        ShellNetwork::Off => "off",
        ShellNetwork::On => "on",
        ShellNetwork::Allowlist => "allowlist",
    }
}

pub fn prepare_shell(
    workspace: &Path,
    cwd: &Path,
    command: &str,
    policy: &ShellPolicy,
) -> Result<PreparedShell> {
    let layout = HomeLayout::current(&policy.home_binds, workspace);
    #[cfg(target_os = "macos")]
    let result = {
        // The process runs in `cwd` already; the profile is per project.
        let _ = cwd;
        prepare_seatbelt(workspace, command, policy, &layout)
    };
    #[cfg(windows)]
    let result = {
        let _ = (cwd, &layout);
        prepare_windows(command, policy)
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = match working_bwrap(workspace) {
        Ok(program) => {
            let net = match policy.network {
                ShellNetwork::Off => Net::Off,
                ShellNetwork::On => Net::On,
                ShellNetwork::Allowlist => Net::Proxy,
            };
            let mut child = None;
            let mut gate = None;
            let mut relay = None;
            if net == Net::Proxy && crate::flatpak::host_bridge().is_some() {
                // bubblewrap runs on the host, so this process cannot place it
                // in a namespace. The host bubblewrap makes its own private
                // network namespace instead, and the relay shipped in the
                // package is its only route, to this process's proxy.
                let unavailable =
                    "The command did not run: the network allow-list for Flatpak host commands";
                let program = crate::flatpak::host_relay().with_context(|| {
                    format!(
                        "{unavailable} needs {} in this package",
                        crate::flatpak::RELAY_NAME
                    )
                })?;
                let base = crate::flatpak::shared_socket_base().with_context(|| {
                    format!("{unavailable} needs a folder shared with the host")
                })?;
                let socket =
                    Arc::new(RelaySocket::bind(&base).with_context(|| unavailable.to_owned())?);
                let shared = proxy::Gate::new(policy.allow.clone());
                child = Some(ChildSetup {
                    #[cfg(target_os = "linux")]
                    netns: None,
                    #[cfg(target_os = "linux")]
                    landlock: None,
                    gate: Some(shared.clone()),
                    relay: Some(socket.clone()),
                    #[cfg(target_os = "macos")]
                    listener: None,
                });
                gate = Some(shared);
                relay = Some((program, socket));
            } else if net == Net::Proxy {
                #[cfg(target_os = "linux")]
                {
                    let shared = proxy::Gate::new(policy.allow.clone());
                    child = Some(ChildSetup {
                        netns: Some(Arc::new(netns::Netns::new()?)),
                        landlock: None,
                        gate: Some(shared.clone()),
                        relay: None,
                    });
                    gate = Some(shared);
                }
                #[cfg(not(target_os = "linux"))]
                bail!("The network allow-list needs Linux namespaces. The command did not run.");
            }
            let scratch = create_scratch(&scratch_base())?;
            let mut args = isolated_args(workspace, command, net, Some(&scratch.path), &layout);
            if let Some(index) = args.iter().position(|arg| arg == "--chdir") {
                args[index + 1] = cwd.to_string_lossy().into_owned();
            }
            if let Some((program, socket)) = &relay {
                args = host_relay_args(args, program, socket.dir())?;
            }
            let note = json!({
                "mode": "bubblewrap",
                "network": network_label(policy.network),
                "network_requested": network_label(policy.network),
                "network_enforcement": match net {
                    Net::Off => "private_namespace",
                    Net::On => "none",
                    Net::Proxy if relay.is_some() => "host_allowlist_proxy_relay",
                    Net::Proxy => "host_allowlist_proxy",
                },
                "allow": if net == Net::Proxy { json!(policy.allow_text) } else { Value::Null },
                "home": "empty temporary folder",
                "home_read_only": layout.binds.iter().map(|(_, d)| d.to_string_lossy()).collect::<Vec<_>>(),
                "home_skipped": layout.skipped,
                "scratch": scratch.path.to_string_lossy(),
                "workspace_cow": false,
                "note": "bubblewrap: read-only system folders, empty home with read-only toolchains, writable project, ephemeral scratch at SHADOWCODE_SCRATCH. Not a complete OS sandbox."
            });
            Ok(PreparedShell {
                program: program.to_string_lossy().into_owned(),
                args,
                child,
                scratch: Some(scratch.path),
                gate,
                note,
                warning: None,
            })
        }
        Err(error) => {
            // Landlock applied to flatpak-spawn cannot confine the host
            // process it asks a service to start. Require host bubblewrap
            // rather than pretending that local fallback contains it.
            if crate::flatpak::host_bridge().is_some() {
                bail!("The command did not run: Flatpak agent shell commands require working bubblewrap on the host ({error:#}). Install bubblewrap on this computer.");
            }
            if policy.require {
                bail!(
                    "The command did not run: 'Require sandbox' is on and bubblewrap is unavailable ({error:#}). Install bubblewrap (for example: sudo apt install bubblewrap), or turn off 'Require sandbox' in Settings > Permissions & network."
                );
            }
            if policy.network == ShellNetwork::Allowlist {
                bail!(
                    "The command did not run: the network allow-list needs bubblewrap, which is unavailable ({error:#}). Install bubblewrap, or change 'Shell commands and the network' in Settings > Permissions & network."
                );
            }
            let deny_tcp = policy.network == ShellNetwork::Off;
            #[cfg(target_os = "linux")]
            let landlock = if policy.landlock {
                let (read_only, writable) = landlock_paths(&layout, policy.network);
                lsm::ruleset(&lsm::Paths {
                    read_only,
                    writable,
                    workspace: &real(workspace),
                    deny_tcp,
                })
                .unwrap_or(None)
            } else {
                None
            };
            #[cfg(not(target_os = "linux"))]
            let landlock: Option<()> = None;
            let limited = landlock.is_some();
            // BestEffort supports older kernels too, but Landlock's TCP
            // rights start at ABI 4. Requested network=off is not proof that
            // any network restriction is enforced by the fallback.
            #[cfg(target_os = "linux")]
            let tcp_blocked = limited && deny_tcp && lsm::kernel_abi() >= 4;
            #[cfg(not(target_os = "linux"))]
            let tcp_blocked = false;
            let warning = if limited {
                format!(
                    "Shell commands are running without bubblewrap ({error:#}). Landlock limits them to this project, temporary folders and read-only system and toolchain folders{}; other isolation (process, network namespace) is missing. Install bubblewrap for the full sandbox, or turn on 'Require sandbox' to refuse commands instead.",
                    if tcp_blocked {
                        ", and blocks TCP connections (UDP remains unrestricted)"
                    } else if deny_tcp {
                        ", but this kernel cannot enforce the requested network restriction"
                    } else {
                        ""
                    }
                )
            } else {
                format!(
                    "Shell commands are running without a sandbox ({error:#}): they can read and change anything your user can. Install bubblewrap, or turn on 'Require sandbox' in Settings > Permissions & network to refuse commands instead."
                )
            };
            let note = json!({
                "mode": if limited { "landlock" } else { "none" },
                "reason": format!("{error:#}"),
                // Keep network as the historical requested-policy field.
                "network": network_label(policy.network),
                "network_requested": network_label(policy.network),
                "network_enforcement": if tcp_blocked { "tcp_only" } else { "none" },
                "note": if tcp_blocked {
                    "No bubblewrap: Landlock restricts supported file operations and blocks TCP. UDP and process isolation are not enforced."
                } else if limited {
                    "No bubblewrap: Landlock restricts supported file operations. Network and process isolation are not enforced."
                } else {
                    "No bubblewrap and no Landlock: the command runs as your user without isolation; only the approval policy applies."
                }
            });
            Ok(PreparedShell {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), command.into()],
                #[cfg(target_os = "linux")]
                child: landlock.map(|fd| ChildSetup {
                    netns: None,
                    landlock: Some(Arc::new(fd)),
                    gate: None,
                    relay: None,
                }),
                #[cfg(not(target_os = "linux"))]
                child: None,
                scratch: None,
                gate: None,
                note,
                warning: Some(warning),
            })
        }
    };
    result
}

/// Windows: no shell sandbox yet (docs/WINDOWS_PORT.md). Commands run as
/// the user with a warning, and are refused when the sandbox is required or
/// the network allow-list is on, exactly like a Linux host without
/// bubblewrap or Landlock.
#[cfg(windows)]
fn prepare_windows(command: &str, policy: &ShellPolicy) -> Result<PreparedShell> {
    if policy.require {
        bail!("The command did not run: 'Require sandbox' is on and ShadowCode has no shell sandbox on Windows yet. Turn off 'Require sandbox' in Settings > Permissions & network to run commands without it.");
    }
    if policy.network == ShellNetwork::Allowlist {
        bail!("The command did not run: the network allow-list needs a shell sandbox, which ShadowCode does not have on Windows yet. Change 'Shell commands and the network' in Settings > Permissions & network.");
    }
    let (program, args) = windows_shell(command);
    Ok(PreparedShell {
        program,
        args,
        child: None,
        scratch: None,
        gate: None,
        note: json!({
            "mode": "none",
            "reason": "no shell sandbox on Windows yet",
            "network": network_label(policy.network),
            "network_requested": network_label(policy.network),
            "network_enforcement": "none",
            "note": "Windows: the command runs as your user without isolation; only the approval policy applies."
        }),
        warning: Some("Shell commands are running without a sandbox (ShadowCode has none on Windows yet): they can read and change anything your user can. Turn on 'Require sandbox' in Settings > Permissions & network to refuse commands instead.".into()),
    })
}

/// The shell for agent commands on Windows. Commands are usually written for
/// `sh`, so Git for Windows' bash comes first (from its install folders: the
/// `bash.exe` in System32 is WSL's, which would run them in Linux);
/// PowerShell otherwise.
#[cfg(windows)]
pub fn windows_shell(command: &str) -> (String, Vec<String>) {
    let installed =
        |var: &str, rest: &str| std::env::var_os(var).map(|base| PathBuf::from(base).join(rest));
    let git_bash = [
        installed("ProgramFiles", "Git/bin/bash.exe"),
        installed("ProgramW6432", "Git/bin/bash.exe"),
        installed("LOCALAPPDATA", "Programs/Git/bin/bash.exe"),
    ]
    .into_iter()
    .flatten()
    .find(|path| path.is_file());
    match git_bash {
        Some(bash) => (
            bash.to_string_lossy().into_owned(),
            vec!["-c".into(), command.into()],
        ),
        None => (
            "powershell.exe".into(),
            vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                command.into(),
            ],
        ),
    }
}

/// macOS: the command under Seatbelt, or (when `sandbox-exec` cannot run)
/// unsandboxed with a warning unless the sandbox is required or the
/// allow-list is on. See [`seatbelt`].
#[cfg(target_os = "macos")]
fn prepare_seatbelt(
    workspace: &Path,
    command: &str,
    policy: &ShellPolicy,
    layout: &HomeLayout,
) -> Result<PreparedShell> {
    if let Err(error) = seatbelt::probe() {
        if policy.require {
            bail!("The command did not run: 'Require sandbox' is on and the macOS sandbox is unavailable ({error:#}). Turn off 'Require sandbox' in Settings > Permissions & network to run commands without it.");
        }
        if policy.network == ShellNetwork::Allowlist {
            bail!("The command did not run: the network allow-list needs the macOS sandbox, which is unavailable ({error:#}). Change 'Shell commands and the network' in Settings > Permissions & network.");
        }
        return Ok(PreparedShell {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), command.into()],
            child: None,
            scratch: None,
            gate: None,
            note: json!({
                "mode": "none",
                "reason": format!("{error:#}"),
                "network": network_label(policy.network),
                "network_requested": network_label(policy.network),
                "network_enforcement": "none",
                "note": "No macOS sandbox: the command runs as your user without isolation; only the approval policy applies."
            }),
            warning: Some(format!("Shell commands are running without a sandbox ({error:#}): they can read and change anything your user can. Turn on 'Require sandbox' in Settings > Permissions & network to refuse commands instead.")),
        });
    }
    let net = match policy.network {
        ShellNetwork::Off => Net::Off,
        ShellNetwork::On => Net::On,
        ShellNetwork::Allowlist => Net::Proxy,
    };
    let mut child = None;
    let mut gate = None;
    let mut proxy_port = None;
    if net == Net::Proxy {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .context("Could not start the network allow-list proxy")?;
        proxy_port = Some(listener.local_addr()?.port());
        let shared = proxy::Gate::new(policy.allow.clone());
        child = Some(ChildSetup {
            gate: Some(shared.clone()),
            relay: None,
            listener: Some(Arc::new(Mutex::new(Some(listener)))),
        });
        gate = Some(shared);
    }
    let scratch = create_scratch(&scratch_base())?;
    let home = seatbelt::make_home(&scratch.path, layout)?;
    let developer = seatbelt::developer_dir();
    let mut read = seatbelt::path_roots(layout.home.as_deref());
    if let Some(dir) = &developer {
        read.push(real(dir));
    }
    let workspace = real(workspace);
    let profile = seatbelt::Profile {
        workspace: &workspace,
        scratch: &scratch.path,
        layout,
        net,
        proxy_port,
        read,
        user_temp: seatbelt::user_temp(),
    };
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut args = vec![
        "-p".to_owned(),
        profile.text(),
        "/usr/bin/env".into(),
        "-u".into(),
        "XDG_CONFIG_HOME".into(),
        "-u".into(),
        "XDG_DATA_HOME".into(),
        "-u".into(),
        "XDG_STATE_HOME".into(),
        format!("HOME={}", s(&home)),
        format!("TMPDIR={}/", s(&scratch.path.join("tmp"))),
        format!("SHADOWCODE_SCRATCH={}", s(&scratch.path)),
    ];
    if let Some(dir) = &developer {
        args.push(format!("DEVELOPER_DIR={}", s(dir)));
    }
    if let Some(port) = proxy_port {
        let url = format!("http://127.0.0.1:{port}");
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "http_proxy",
            "https_proxy",
            "ALL_PROXY",
            "all_proxy",
        ] {
            args.push(format!("{name}={url}"));
        }
    }
    args.extend(["/bin/sh".into(), "-c".into(), command.into()]);
    let note = json!({
        "mode": "seatbelt",
        "network": network_label(policy.network),
        "network_requested": network_label(policy.network),
        "network_enforcement": match net {
            Net::Off => "no_network",
            Net::On => "none",
            Net::Proxy => "host_allowlist_proxy",
        },
        "allow": if net == Net::Proxy { json!(policy.allow_text) } else { Value::Null },
        "home": "empty temporary folder",
        "home_read_only": layout.binds.iter().map(|(_, d)| d.to_string_lossy()).collect::<Vec<_>>(),
        "home_skipped": layout.skipped,
        "scratch": scratch.path.to_string_lossy(),
        "workspace_cow": false,
        "note": "macOS sandbox: read-only system and developer folders, empty home with read-only toolchains, writable project, ephemeral scratch at SHADOWCODE_SCRATCH (also TMPDIR). Not a complete OS sandbox."
    });
    Ok(PreparedShell {
        program: seatbelt::PROGRAM.into(),
        args,
        child,
        scratch: Some(scratch.path),
        gate,
        note,
        warning: None,
    })
}

#[cfg(target_os = "linux")]
fn landlock_paths(layout: &HomeLayout, network: ShellNetwork) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut read_only: Vec<PathBuf> = SYSTEM_ROOTS
        .iter()
        .chain(&["/proc", "/sys"])
        .map(PathBuf::from)
        .collect();
    read_only.extend(layout.binds.iter().map(|(source, _)| source.clone()));
    if network != ShellNetwork::Off {
        if let Ok(resolv) = Path::new("/etc/resolv.conf").canonical() {
            if let Some(dir) = resolv.parent() {
                read_only.push(dir.to_path_buf());
            }
        }
    }
    let writable = ["/tmp", "/var/tmp", "/dev"].map(PathBuf::from).to_vec();
    (read_only, writable)
}

/// What shell isolation this computer and configuration provide.
#[cfg(target_os = "macos")]
pub fn status(config: &Config) -> Value {
    let works = seatbelt::probe();
    let network = config.shell_network();
    let effective = match (&works, config.sandbox.require, network) {
        (Ok(()), _, _) => "seatbelt",
        (Err(_), true, _) | (Err(_), _, ShellNetwork::Allowlist) => "blocked",
        _ => "none",
    };
    let layout = HomeLayout::current(&config.sandbox.home_binds, Path::new("/nonexistent"));
    json!({
        "platform": "macos",
        "effective": effective,
        "seatbelt": {
            "works": works.is_ok(),
            "detail": match &works { Ok(()) => "The macOS sandbox works".to_owned(), Err(e) => format!("{e:#}") },
        },
        "bubblewrap": {"installed": false, "works": false, "detail": "bubblewrap is Linux-only"},
        "landlock_abi": 0,
        "network_namespace": {"available": false, "detail": "macOS commands share the computer's network; the allow-list proxy's port is the only address they may reach"},
        "require": config.sandbox.require,
        "shell_network": network_label(network),
        "allow": config.network.allow,
        "home_read_only": layout.binds.iter().map(|(_, d)| d.to_string_lossy()).collect::<Vec<_>>(),
        "home_skipped": layout.skipped,
        "never_mounted": DENIED_HOME,
    })
}

/// What shell isolation this computer and configuration provide.
#[cfg(not(target_os = "macos"))]
pub fn status(config: &Config) -> Value {
    let installed = which("bwrap").is_some();
    let bwrap = (|| -> Result<()> {
        let temp = tempfile::tempdir()?;
        working_bwrap(temp.path()).map(|_| ())
    })();
    #[cfg(target_os = "linux")]
    let (landlock_abi, netns) = (lsm::kernel_abi(), netns::probe());
    #[cfg(not(target_os = "linux"))]
    let (landlock_abi, netns) = (0i64, Err::<(), _>(anyhow::anyhow!("Linux only")));
    let network = config.shell_network();
    let effective = match (&bwrap, config.sandbox.require, network) {
        (Ok(()), _, ShellNetwork::Allowlist) if netns.is_err() => "blocked",
        (Ok(()), _, _) => "bubblewrap",
        (Err(_), true, _) | (Err(_), _, ShellNetwork::Allowlist) => "blocked",
        (Err(_), false, _) if config.sandbox.landlock && landlock_abi > 0 => "landlock",
        _ => "none",
    };
    let layout = HomeLayout::current(&config.sandbox.home_binds, Path::new("/nonexistent"));
    json!({
        "platform": "linux",
        "effective": effective,
        "bubblewrap": {
            "installed": installed,
            "works": bwrap.is_ok(),
            "detail": match &bwrap { Ok(()) => "bubblewrap works".to_owned(), Err(e) => format!("{e:#}") },
        },
        "landlock_abi": landlock_abi,
        "network_namespace": {
            "available": netns.is_ok(),
            "detail": match &netns { Ok(()) => "Private network namespaces work".to_owned(), Err(e) => format!("{e:#}") },
        },
        "require": config.sandbox.require,
        "shell_network": network_label(network),
        "allow": config.network.allow,
        "home_read_only": layout.binds.iter().map(|(_, d)| d.to_string_lossy()).collect::<Vec<_>>(),
        "home_skipped": layout.skipped,
        "never_mounted": DENIED_HOME,
    })
}

#[cfg(target_os = "macos")]
pub fn doctor_checks() -> Vec<Value> {
    let works = seatbelt::probe();
    vec![
        json!({"id":"seatbelt","status":if works.is_ok() {"pass"} else {"warn"},
        "title":"Shell sandbox (macOS)","detail":match &works {
            Ok(()) => "The macOS sandbox works: shell commands see an empty home folder with read-only toolchains, read only system, developer and project folders, and write only to the project.".to_owned(),
            Err(e) => format!("{e:#}. Shell commands run unsandboxed with a warning."),
        },
        "fix":"Turn on 'Require sandbox' to refuse commands when the sandbox cannot run. A command is never replayed after a sandbox failure."}),
        json!({"id":"workspace-cow","status":"info","title":"Live workspace writes",
        "detail":"Shell writes affect the current workspace. Scratch storage is temporary, not copy-on-write. A checkpoint taken before each command lets rewind restore project files.",
        "fix":"Use an isolated Git worktree for changes you want to review before integrating."}),
    ]
}

#[cfg(not(target_os = "macos"))]
pub fn doctor_checks() -> Vec<Value> {
    let report = probe_workspace_cow();
    #[cfg(target_os = "linux")]
    let abi = lsm::kernel_abi();
    #[cfg(not(target_os = "linux"))]
    let abi = 0;
    vec![
        json!({"id":"bubblewrap","status":if report["shell_available"]==true {"pass"} else {"info"},
        "title":"Shell sandbox (bubblewrap)","detail":report["detail"],
        "fix":"Install bubblewrap for the full shell sandbox. Without it, commands run under Landlock when the kernel supports it, or unsandboxed with a warning; turn on 'Require sandbox' to refuse them instead. A command is never replayed after a sandbox failure."}),
        json!({"id":"landlock","status":if abi > 0 {"pass"} else {"info"},
        "title":"Landlock fallback","detail":if abi > 0 {format!("Landlock ABI {abi} is available for commands that run without bubblewrap.")} else {"This kernel has no Landlock; without bubblewrap, commands run unsandboxed.".into()},
        "fix":"Landlock needs Linux 5.13 or later with the Landlock LSM enabled."}),
        json!({"id":"workspace-cow","status":"info","title":"Live workspace writes",
        "detail":"Shell writes affect the current workspace. Scratch storage is temporary, not copy-on-write. A checkpoint taken before each command lets rewind restore project files.",
        "fix":"Use an isolated Git worktree for changes you want to review before integrating."}),
    ]
}
pub fn doctor_check() -> Value {
    json!({"checks":doctor_checks()})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn position(args: &[String], window: &[&str]) -> Option<usize> {
        args.windows(window.len()).position(|w| w == window)
    }
    fn text(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn cleanup_refuses_user_data_and_symlinks() {
        let base = tempfile::tempdir().unwrap();
        let user = base.path().join("project");
        fs::create_dir(&user).unwrap();
        fs::write(user.join("important"), "keep").unwrap();
        assert!(discard_scratch(&user).is_err());
        let scratch = create_scratch(base.path()).unwrap();
        fs::write(scratch.path.join("temp"), "x").unwrap();
        discard_scratch(&scratch.path).unwrap();
        assert!(!scratch.path.exists());
        assert!(user.join("important").exists());
    }

    /// A fake home with credentials and toolchains, and a project elsewhere.
    fn fake_home() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().canonical().unwrap().join("home").join("me");
        for dir in [
            ".ssh",
            ".aws",
            ".config/shadow-agent",
            ".cargo/bin",
            ".rustup",
            ".local/share/shadowcode",
        ] {
            fs::create_dir_all(home.join(dir)).unwrap();
        }
        fs::write(home.join(".ssh/id_ed25519"), "not a real key").unwrap();
        fs::write(home.join(".config/shadow-agent/secrets.env"), "X=not-real").unwrap();
        fs::write(home.join(".cargo/credentials.toml"), "token = \"not-real\"").unwrap();
        fs::write(home.join(".gitconfig"), "[user]\n").unwrap();
        let ws = root.path().canonical().unwrap().join("project");
        fs::create_dir_all(&ws).unwrap();
        (root, home, ws)
    }

    #[test]
    fn home_is_an_empty_tmpfs_with_read_only_toolchains_and_writable_workspace() {
        let (_root, home, ws) = fake_home();
        let binds: Vec<String> = DEFAULT_HOME_BINDS.iter().map(|s| (*s).into()).collect();
        let layout = HomeLayout::build(Some(home.clone()), &binds, &ws);
        let args = isolated_args(&ws, "echo hi", Net::Off, None, &layout);
        let (home_s, ws_s) = (text(&home), text(&ws));
        let cargo_s = text(&home.join(".cargo"));
        let tmpfs_home = position(&args, &["--tmpfs", &home_s]).expect("home is a tmpfs");
        let cargo =
            position(&args, &["--ro-bind", &cargo_s, &cargo_s]).expect("toolchain read-only");
        let gitconfig = text(&home.join(".gitconfig"));
        assert!(position(&args, &["--ro-bind", &gitconfig, &gitconfig]).is_some());
        let workspace = position(&args, &["--bind", &ws_s, &ws_s]).expect("workspace writable");
        assert!(tmpfs_home < cargo && cargo < workspace, "{args:?}");
        let credentials = text(&home.join(".cargo/credentials.toml"));
        assert!(
            position(&args, &["--ro-bind", "/dev/null", &credentials]).is_some(),
            "cargo credentials masked"
        );
        for secret in [".ssh", ".aws", ".config", ".local/share"] {
            let hidden = text(&home.join(secret));
            assert!(
                !args.iter().any(|a| a.starts_with(&hidden)),
                "{secret} must not be mounted: {args:?}"
            );
        }
        assert!(position(&args, &["--setenv", "HOME", &home_s]).is_some());
        assert!(args.iter().any(|a| a == "--unshare-net"));
        if Path::new("/home").is_dir() {
            assert!(position(&args, &["--tmpfs", "/home"]).is_some());
            assert!(position(&args, &["--ro-bind", "/home", "/home"]).is_none());
        }
    }

    #[test]
    fn network_modes_shape_the_profile() {
        let (_root, home, ws) = fake_home();
        let layout = HomeLayout::build(Some(home), &[], &ws);
        let on = isolated_args(&ws, "true", Net::On, None, &layout);
        assert!(!on.iter().any(|a| a == "--unshare-net"));
        let proxy = isolated_args(&ws, "true", Net::Proxy, None, &layout);
        // The private namespace is made before bubblewrap starts.
        assert!(!proxy.iter().any(|a| a == "--unshare-net"));
        let url = format!("http://127.0.0.1:{}", proxy::PROXY_PORT);
        assert!(position(&proxy, &["--setenv", "HTTPS_PROXY", &url]).is_some());
        assert!(position(&proxy, &["--setenv", "http_proxy", &url]).is_some());
        assert!(position(&proxy, &["--unsetenv", "NO_PROXY"]).is_some());
    }

    #[test]
    fn flatpak_relay_profile_unshares_the_network_and_wraps_the_command() {
        let (_root, home, ws) = fake_home();
        let layout = HomeLayout::build(Some(home), &[], &ws);
        let base = isolated_args(&ws, "curl https://crates.io", Net::Proxy, None, &layout);
        let relay = Path::new("/var/lib/flatpak/app/x/files/libexec/shadowcode-proxy-relay");
        let dir = Path::new("/run/user/1000/app/x/scp-abc");
        let args = host_relay_args(base, relay, dir).unwrap();
        let separator = args.iter().rposition(|a| a == "--").unwrap();
        assert!(args[..separator].iter().any(|a| a == "--unshare-net"));
        assert!(
            position(&args, &["--ro-bind", &text(relay), RELAY_IN_SANDBOX]).unwrap() < separator
        );
        assert!(
            position(&args, &["--ro-bind", &text(dir), RELAY_DIR_IN_SANDBOX]).unwrap() < separator
        );
        let port = proxy::PROXY_PORT.to_string();
        assert_eq!(
            &args[separator + 1..],
            &[
                RELAY_IN_SANDBOX,
                "/shadowcode-proxy/p",
                port.as_str(),
                "/bin/sh",
                "-c",
                "curl https://crates.io"
            ]
        );
        // Proxy environment is still set for the command.
        let url = format!("http://127.0.0.1:{}", proxy::PROXY_PORT);
        assert!(position(&args, &["--setenv", "HTTPS_PROXY", &url]).is_some());
    }

    #[test]
    fn flatpak_relay_profile_refuses_unexpected_shapes() {
        let relay = Path::new("/r");
        let dir = Path::new("/d");
        assert!(host_relay_args(vec!["--die-with-parent".into()], relay, dir).is_err());
        assert!(host_relay_args(vec!["--".into(), "/usr/bin/env".into()], relay, dir).is_err());
        let shared = vec!["--share-net".into(), "--".into(), "/bin/sh".into()];
        assert!(host_relay_args(shared, relay, dir).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn relay_socket_refuses_paths_the_kernel_cannot_hold() {
        let root = tempfile::tempdir().unwrap();
        let deep = root.path().join("d".repeat(120));
        fs::create_dir(&deep).unwrap();
        assert!(RelaySocket::bind(&deep).is_err());
        let ok = RelaySocket::bind(root.path()).unwrap();
        assert!(ok.dir().join(RELAY_SOCKET).exists());
        let dir = ok.dir().to_owned();
        drop(ok);
        assert!(
            !dir.exists(),
            "the socket folder is removed with the command"
        );
    }

    /// Build the relay shipped in the Flatpak, or skip when no C compiler.
    #[cfg(unix)]
    fn build_relay(out: &Path) -> Option<PathBuf> {
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packaging/flatpak/proxy-relay.c");
        let binary = out.join("relay");
        let status = Command::new("cc")
            .args(["-Os", "-Wall", "-Wextra", "-Werror", "-o"])
            .arg(&binary)
            .arg(&source)
            .status()
            .ok()?;
        status.success().then_some(binary)
    }

    #[cfg(unix)]
    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    // The relay is built from packaging/flatpak/proxy-relay.c (Linux).
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn flatpak_relay_forwards_only_through_the_allow_list_proxy() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let temp = tempfile::tempdir().unwrap();
        let Some(binary) = build_relay(temp.path()) else {
            eprintln!("skipping: no C compiler");
            return;
        };
        let socket = Arc::new(RelaySocket::bind(temp.path()).unwrap());
        let gate = proxy::Gate::new(proxy::parse_list(&["allowed.invalid".into()]).unwrap());
        // The Linux-only fields (network namespace, Landlock) take defaults;
        // elsewhere these two are all of them.
        #[allow(clippy::needless_update)]
        let setup = ChildSetup {
            gate: Some(gate.clone()),
            relay: Some(socket.clone()),
            ..ChildSetup::default()
        };
        let _guard = setup.after_spawn().unwrap().unwrap();
        let port = free_port();
        let mut relay = tokio::process::Command::new(&binary)
            .arg(socket.dir().join(RELAY_SOCKET))
            .arg(port.to_string())
            .args(["/bin/sh", "-c", "sleep 5; exit 7"])
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut stream = None;
        for _ in 0..100 {
            if let Ok(s) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await {
                stream = Some(s);
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let mut stream = stream.expect("relay listens on loopback");
        stream
            .write_all(b"CONNECT example.com:443 HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut reply = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut reply)).await;
        let reply = String::from_utf8_lossy(&reply);
        assert!(reply.starts_with("HTTP/1.1 403"), "{reply}");
        assert!(gate.report()["blocked"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b == "example.com:443"));
        let status = relay.wait().await.unwrap();
        assert_eq!(
            status.code(),
            Some(7),
            "the relay returns the command's status"
        );
    }

    #[cfg(unix)]
    #[test]
    fn flatpak_relay_fails_closed_without_the_proxy() {
        let temp = tempfile::tempdir().unwrap();
        let Some(binary) = build_relay(temp.path()) else {
            eprintln!("skipping: no C compiler");
            return;
        };
        let marker = temp.path().join("ran");
        let script = format!("touch '{}'", marker.display());
        let output = Command::new(&binary)
            .arg(temp.path().join("missing.sock"))
            .arg(free_port().to_string())
            .args(["/bin/sh", "-c", &script])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(125));
        assert!(!marker.exists(), "the command must not run");
        assert!(String::from_utf8_lossy(&output.stderr).contains("did not run"));
        // A port that is already taken is refused the same way.
        let busy = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let socket = RelaySocket::bind(temp.path()).unwrap();
        let output = Command::new(&binary)
            .arg(socket.dir().join(RELAY_SOCKET))
            .arg(busy.local_addr().unwrap().port().to_string())
            .args(["/bin/sh", "-c", &script])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(125));
        assert!(!marker.exists(), "the command must not run");
    }

    #[test]
    fn protected_home_entries_are_never_mounted() {
        for bad in [
            ".ssh",
            ".ssh/keys",
            ".config",
            ".config/git",
            ".local",
            ".local/share/shadowcode",
            ".aws",
            ".gnupg",
            "../x",
            "/etc",
            "~/.cargo",
            ".",
            "",
            "a/../.ssh",
        ] {
            assert!(validate_home_entry(bad).is_err(), "{bad}");
        }
        for good in [".cargo", ".local/bin", ".cache/pip", ".gitconfig", "go"] {
            validate_home_entry(good).unwrap();
        }
        let mut config = SandboxConfig::default();
        config.validate().unwrap();
        config.home_binds.push(".ssh".into());
        assert!(config.validate().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_smuggle_credentials_and_projects_hide_them() {
        let (_root, home, ws) = fake_home();
        std::os::unix::fs::symlink(home.join(".ssh"), home.join(".tools")).unwrap();
        std::os::unix::fs::symlink(&home, home.join(".homelink")).unwrap();
        let layout = HomeLayout::build(
            Some(home.clone()),
            &[".tools".into(), ".homelink".into()],
            &ws,
        );
        assert!(layout.binds.is_empty(), "{:?}", layout.binds);
        assert_eq!(layout.skipped.len(), 2);
        // A project that is the home folder hides the credential folders.
        let layout = HomeLayout::build(Some(home.clone()), &[], &home);
        let args = isolated_args(&home, "true", Net::Off, None, &layout);
        let home_s = text(&home);
        let bind = position(&args, &["--bind", &home_s, &home_s]).unwrap();
        let mask = position(&args, &["--tmpfs", &text(&home.join(".ssh"))]).expect(".ssh hidden");
        assert!(mask > bind);
        assert!(position(&args, &["--tmpfs", &text(&home.join(".config"))]).is_some());

        // A credential folder reached through a symlink is hidden at its real
        // location, which the project mount also exposes.
        let (_root2, home2, _ws2) = fake_home();
        std::fs::create_dir_all(home2.join("dotfiles/ssh")).unwrap();
        std::fs::write(home2.join("dotfiles/ssh/id_ed25519"), "not a real key").unwrap();
        std::fs::remove_dir_all(home2.join(".ssh")).unwrap();
        std::os::unix::fs::symlink(home2.join("dotfiles/ssh"), home2.join(".ssh")).unwrap();
        let layout = HomeLayout::build(Some(home2.clone()), &[], &home2);
        let args = isolated_args(&home2, "true", Net::Off, None, &layout);
        assert!(
            position(&args, &["--tmpfs", &text(&home2.join("dotfiles/ssh"))]).is_some(),
            "the symlinked key folder's real location must be masked: {args:?}"
        );
    }

    #[test]
    fn scratch_probe_never_claims_copy_on_write() {
        let report = probe_workspace_cow();
        assert_eq!(report["ok"], false);
        assert_eq!(report["kernel_proof"], false);
    }

    // macOS always uses its own sandbox (see the seatbelt tests below).
    #[cfg(target_os = "linux")]
    #[test]
    fn missing_bubblewrap_reports_honest_fallback_and_fails_closed_when_required() {
        // PATH is process-global and tests share one process: run the mutation
        // in an isolated child so a concurrent test never observes an empty
        // PATH while resolving a subprocess (e.g. git).
        if std::env::var_os("SHADOWCODE_SANDBOX_FALLBACK_CHILD").is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "sandbox::tests::missing_bubblewrap_reports_honest_fallback_and_fails_closed_when_required",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env("SHADOWCODE_SANDBOX_FALLBACK_CHILD", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        let previous = std::env::var_os("PATH");
        // Empty PATH: bwrap cannot be resolved even if installed on the host.
        std::env::set_var("PATH", "");
        let mode = detect();
        let report = probe_workspace_cow();
        let checks = doctor_checks();
        let ws = tempfile::tempdir().unwrap();
        let mut policy = ShellPolicy {
            network: ShellNetwork::Off,
            allow: Vec::new(),
            allow_text: Vec::new(),
            home_binds: Vec::new(),
            require: true,
            landlock: true,
        };
        let required = prepare_shell(ws.path(), ws.path(), "true", &policy);
        policy.require = false;
        policy.network = ShellNetwork::Allowlist;
        let allowlist = prepare_shell(ws.path(), ws.path(), "true", &policy);
        policy.network = ShellNetwork::Off;
        let fallback = prepare_shell(ws.path(), ws.path(), "true", &policy);
        match previous {
            Some(value) => std::env::set_var("PATH", value),
            None => std::env::remove_var("PATH"),
        }
        assert!(matches!(
            mode,
            SandboxMode::Off { reason } if reason.contains("bubblewrap")
        ));
        assert_eq!(report["shell_available"], false);
        assert_eq!(report["mode"], "unavailable");
        assert_eq!(report["kernel_proof"], false);
        let bubble = checks
            .iter()
            .find(|c| c["id"] == "bubblewrap")
            .expect("doctor includes bubblewrap");
        assert_eq!(bubble["status"], "info");
        assert!(bubble["detail"]
            .as_str()
            .unwrap_or("")
            .to_ascii_lowercase()
            .contains("bubblewrap"));
        let required = format!("{:#}", required.unwrap_err());
        assert!(
            required.contains("did not run") && required.contains("Require sandbox"),
            "{required}"
        );
        let allowlist = format!("{:#}", allowlist.unwrap_err());
        assert!(
            allowlist.contains("did not run") && allowlist.contains("allow-list"),
            "{allowlist}"
        );
        let fallback = fallback.unwrap();
        assert_eq!(fallback.program, "/bin/sh");
        assert!(fallback
            .warning
            .as_deref()
            .unwrap_or("")
            .contains("without"));
        assert!(matches!(
            fallback.note["mode"].as_str(),
            Some("landlock" | "none")
        ));
    }

    #[test]
    fn the_no_sandbox_warning_is_shown_once_per_conversation() {
        let session = format!("warn-{}", crate::id());
        assert!(first_warning(&session));
        assert!(!first_warning(&session));
        assert!(first_warning(&format!("{session}-other")));
    }

    #[cfg(target_os = "macos")]
    fn seatbelt_policy(network: ShellNetwork, allow: &[&str]) -> ShellPolicy {
        let allow_text: Vec<String> = allow.iter().map(|s| (*s).to_owned()).collect();
        ShellPolicy {
            network,
            allow: proxy::parse_list(&allow_text).unwrap(),
            allow_text,
            home_binds: DEFAULT_HOME_BINDS.iter().map(|s| (*s).to_owned()).collect(),
            require: true,
            landlock: false,
        }
    }

    /// Run a prepared command to completion: (exit code, stdout + stderr).
    #[cfg(target_os = "macos")]
    fn run_prepared(prepared: &PreparedShell, cwd: &Path) -> (i32, String) {
        let output = Command::new(&prepared.program)
            .args(&prepared.args)
            .current_dir(cwd)
            .env_clear()
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .stdin(Stdio::null())
            .output()
            .unwrap();
        let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
        text.push_str(&String::from_utf8_lossy(&output.stderr));
        (output.status.code().unwrap_or(-1), text)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_confines_files_to_the_project_and_hides_home_and_credentials() {
        let (root, home, ws) = fake_home();
        let root = root.path().canonical().unwrap();
        fs::write(root.join("outside.txt"), "outside").unwrap();
        // A project that contains a credential folder of its own home.
        let layout = HomeLayout::build(
            Some(home.clone()),
            &DEFAULT_HOME_BINDS
                .iter()
                .map(|s| (*s).to_owned())
                .collect::<Vec<_>>(),
            &ws,
        );
        let policy = seatbelt_policy(ShellNetwork::Off, &[]);
        let run = |command: &str| {
            let prepared = prepare_seatbelt(&ws, command, &policy, &layout).unwrap();
            assert_eq!(prepared.note["mode"], "seatbelt");
            let result = run_prepared(&prepared, &ws);
            if let Some(scratch) = &prepared.scratch {
                discard_scratch(scratch).unwrap();
            }
            result
        };
        let (code, text) = run("echo hi > made.txt && cat made.txt");
        assert_eq!((code, text.trim()), (0, "hi"));
        assert!(ws.join("made.txt").is_file());
        let (code, _) = run(&format!("cat {}", home.join(".ssh/id_ed25519").display()));
        assert_ne!(code, 0, "the real home folder is hidden");
        let (code, _) = run(&format!("cat {}", root.join("outside.txt").display()));
        assert_ne!(code, 0, "folders outside the project are hidden");
        let (code, _) = run(&format!("echo x > {}", root.join("written.txt").display()));
        assert_ne!(code, 0);
        assert!(
            !root.join("written.txt").exists(),
            "no writes outside the project"
        );
        // HOME is empty but for links to read-only toolchains.
        let (code, text) =
            run("test -L \"$HOME/.cargo\" && ls \"$HOME/.cargo\" && ls -a \"$HOME\"");
        assert_eq!(code, 0, "{text}");
        assert!(text.contains("bin") && !text.contains(".ssh"), "{text}");
        let (code, _) = run("touch \"$HOME/.cargo/new\"");
        assert_ne!(code, 0);
        assert!(
            !home.join(".cargo/new").exists(),
            "toolchains stay read-only"
        );
        let (code, _) = run("cat \"$HOME/.cargo/credentials.toml\"");
        assert_ne!(code, 0, "credential files inside toolchains stay hidden");
        let (code, text) =
            run("echo t > \"$TMPDIR/x\" && cat \"$TMPDIR/x\" && echo $SHADOWCODE_SCRATCH");
        assert_eq!(code, 0, "{text}");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_hides_credential_folders_inside_the_project() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().canonical().unwrap().join("me");
        fs::create_dir_all(home.join(".ssh")).unwrap();
        fs::write(home.join(".ssh/id_ed25519"), "not a real key").unwrap();
        // The project is the home folder itself.
        let layout = HomeLayout::build(Some(home.clone()), &[], &home);
        let policy = seatbelt_policy(ShellNetwork::Off, &[]);
        for command in [
            "cat .ssh/id_ed25519",
            "ls .ssh",
            "mv .ssh moved",
            "echo x > .ssh/new",
        ] {
            let prepared = prepare_seatbelt(&home, command, &policy, &layout).unwrap();
            let (code, text) = run_prepared(&prepared, &home);
            assert_ne!(code, 0, "{command}: {text}");
        }
        assert!(home.join(".ssh/id_ed25519").is_file());
        assert!(!home.join(".ssh/new").exists() && !home.join("moved").exists());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn seatbelt_network_modes_are_enforced() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let ws = tempfile::tempdir().unwrap();
        let ws = ws.path().canonical().unwrap();
        let layout = HomeLayout::build(None, &[], &ws);
        let probe = format!("/usr/bin/nc -z -w 2 127.0.0.1 {port}");
        let run = |network: ShellNetwork, command: &str| {
            let policy = seatbelt_policy(network, &["allowed.invalid"]);
            let prepared = prepare_seatbelt(&ws, command, &policy, &layout).unwrap();
            (prepared, ws.clone())
        };
        // Off: not even this computer's own services.
        let (prepared, cwd) = run(ShellNetwork::Off, &probe);
        assert_ne!(run_prepared(&prepared, &cwd).0, 0);
        // On: anything.
        let (prepared, cwd) = run(ShellNetwork::On, &probe);
        assert_eq!(run_prepared(&prepared, &cwd).0, 0);
        // Allow-list: only the proxy, which refuses hosts not on the list.
        let (prepared, cwd) = run(ShellNetwork::Allowlist, &probe);
        assert_ne!(
            run_prepared(&prepared, &cwd).0,
            0,
            "other local ports are closed"
        );
        let (prepared, cwd) = run(
            ShellNetwork::Allowlist,
            "/usr/bin/curl -sS -m 5 -o /dev/null -w '%{http_code}' -p https://example.com/; echo",
        );
        let _guard = prepared
            .child
            .as_ref()
            .unwrap()
            .after_spawn()
            .unwrap()
            .unwrap();
        let output = tokio::task::spawn_blocking(move || run_prepared(&prepared, &cwd))
            .await
            .unwrap();
        assert!(output.1.contains("403"), "{output:?}");
        drop(listener);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn apple_developer_tools_run_cleanly_in_the_seatbelt() {
        let ws = tempfile::tempdir().unwrap();
        let ws = ws.path().canonical().unwrap();
        let layout = HomeLayout::current(
            &DEFAULT_HOME_BINDS
                .iter()
                .map(|s| (*s).to_owned())
                .collect::<Vec<_>>(),
            &ws,
        );
        let policy = seatbelt_policy(ShellNetwork::Off, &[]);
        let command = "git init -q . && git status --short && cc --version && make --version && python3 -c 'print(6*7)'";
        let prepared = prepare_seatbelt(&ws, command, &policy, &layout).unwrap();
        let (code, text) = run_prepared(&prepared, &ws);
        assert_eq!(code, 0, "{text}");
        assert!(text.contains("42"), "{text}");
        // Apple's shims must not fall back to xcodebuild inside the sandbox.
        assert!(
            !text.contains("xcodebuild") && !text.contains("xcrun"),
            "{text}"
        );
    }
}
