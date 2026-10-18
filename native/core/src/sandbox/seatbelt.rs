//! macOS shell isolation through Seatbelt (`sandbox-exec`), the kernel
//! sandbox behind the App Sandbox. It mirrors the bubblewrap profile:
//!
//! * Reading is allowed only in system and developer-tool folders, the
//!   folders holding the programs on `PATH` (outside the home folder), the
//!   project, the configured toolchain folders and the command's scratch.
//!   The rest of the home folder, other users and other volumes stay hidden:
//!   even their existence (`stat`) is refused. Only the folders leading to
//!   an allowed one can be looked up, so paths still resolve.
//! * `HOME` is an empty folder in the command's scratch whose toolchain
//!   entries (`sandbox.home_binds`) link to the real, read-only folders, and
//!   `TMPDIR` is the scratch too. Credential folders are never linked.
//! * Writing is allowed in the project and the scratch only (plus /dev/null
//!   and the terminal, and xcrun's own cache files).
//! * Network off allows no IP networking at all, not even localhost (macOS
//!   cannot give a command its own loopback); on allows it; the allow-list
//!   allows only the allow-list proxy's loopback port.
//! * Credential folders inside the project are unreadable and unwritable.
//!
//! Signals reach only processes in the same sandbox; system services are
//! reachable only for user lookup, logging and (with network) DNS and
//! certificate checks.
use super::{HomeLayout, Net};
use crate::paths::Canonical;
use anyhow::{ensure, Context, Result};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::LazyLock,
    time::{Duration, Instant},
};

pub const PROGRAM: &str = "/usr/bin/sandbox-exec";

/// Folders every command may read: the system, developer tools and
/// package managers' prefixes.
const READ_ROOTS: &[&str] = &[
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/private/etc",
    "/private/var/db/timezone",
    "/private/var/select",
    "/opt",
    "/nix",
    "/dev",
];

const BASE: &str = r#"(version 1)
(deny default)
(allow process-exec process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow pseudo-tty)
(allow ipc-posix-sem ipc-posix-shm-read* ipc-posix-shm-write-data ipc-posix-shm-write-create)
(allow file-read* (literal "/") (regex #"^/Applications/Xcode[^/]*\.app(/|$)"))
(allow file-read-metadata (literal "/etc") (literal "/var") (literal "/tmp"))
(allow file-write-data file-read* (literal "/dev/null") (literal "/dev/zero")
  (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/dtracehelper")
  (regex #"^/dev/tty") (regex #"^/dev/fd/"))
(allow file-ioctl (literal "/dev/dtracehelper") (regex #"^/dev/tty"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.logd")
  (global-name "com.apple.FSEvents"))
"#;

/// Network rules for a command.
fn network(net: Net, proxy_port: Option<u16>) -> String {
    match net {
        Net::Off => String::new(),
        Net::On => r#"(allow network*)
(allow mach-lookup
  (global-name "com.apple.dnssd.service")
  (global-name "com.apple.trustd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.SystemConfiguration.configd"))
"#
        .into(),
        // Only the allow-list proxy; it resolves names itself.
        Net::Proxy => match proxy_port {
            Some(port) => format!("(allow network-outbound (remote ip \"localhost:{port}\"))\n"),
            None => String::new(),
        },
    }
}

/// A quoted SBPL string. Paths come from this computer, but quote them
/// properly anyway: a `"` or `\` must not end the string early.
fn quoted(path: &Path) -> String {
    let text = path.to_string_lossy();
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

/// Everything one command's profile needs.
pub struct Profile<'a> {
    pub workspace: &'a Path,
    pub scratch: &'a Path,
    pub layout: &'a HomeLayout,
    pub net: Net,
    pub proxy_port: Option<u16>,
    /// Extra read-only folders (programs on `PATH`, the developer folder).
    pub read: Vec<PathBuf>,
    /// The per-user temporary folder, where xcrun keeps its cache.
    pub user_temp: Option<PathBuf>,
}

impl Profile<'_> {
    pub fn text(&self) -> String {
        let mut profile = String::from(BASE);
        let read: Vec<PathBuf> = READ_ROOTS
            .iter()
            .map(PathBuf::from)
            .chain(self.read.iter().cloned())
            .chain(self.layout.binds.iter().map(|(source, _)| source.clone()))
            .collect();
        profile.push_str("(allow file-read*");
        for path in &read {
            profile.push_str(&format!(" (subpath {})", quoted(path)));
        }
        profile.push_str(")\n");
        // The folders leading to each allowed one may be looked up (stat),
        // nothing else in them.
        let mut ancestors: Vec<PathBuf> = Vec::new();
        let reachable = read
            .iter()
            .map(PathBuf::as_path)
            .chain([self.workspace, self.scratch])
            .chain(self.user_temp.as_deref());
        for path in reachable {
            for ancestor in path.ancestors().skip(1) {
                if !ancestors.iter().any(|known| known == ancestor) {
                    ancestors.push(ancestor.to_path_buf());
                }
            }
        }
        if !ancestors.is_empty() {
            profile.push_str("(allow file-read-metadata");
            for path in &ancestors {
                profile.push_str(&format!(" (literal {})", quoted(path)));
            }
            profile.push_str(")\n");
        }
        profile.push_str(&format!(
            "(allow file-read* file-write* (subpath {}) (subpath {}))\n",
            quoted(self.workspace),
            quoted(self.scratch)
        ));
        if let Some(temp) = &self.user_temp {
            profile.push_str(&format!(
                "(allow file-read* file-write* (prefix {}))\n",
                quoted(&temp.join("xcrun_db"))
            ));
        }
        profile.push_str(&network(self.net, self.proxy_port));
        // Last, so they win over the allowances above.
        let hidden: Vec<String> = self
            .layout
            .masked_dirs
            .iter()
            .map(|dir| format!(" (subpath {})", quoted(dir)))
            .chain(
                self.layout
                    .masked_files
                    .iter()
                    .map(|file| format!(" (literal {})", quoted(file))),
            )
            .collect();
        if !hidden.is_empty() {
            profile.push_str(&format!(
                "(deny file-read* file-write*{})\n",
                hidden.concat()
            ));
        }
        profile
    }
}

/// The empty home folder: toolchain entries link to the real folders.
pub fn make_home(scratch: &Path, layout: &HomeLayout) -> Result<PathBuf> {
    let home = scratch.join("home");
    std::fs::create_dir(&home)?;
    std::fs::create_dir(scratch.join("tmp"))?;
    let Some(real_home) = &layout.home else {
        return Ok(home);
    };
    for (source, dest) in &layout.binds {
        let Ok(relative) = dest.strip_prefix(real_home) else {
            continue;
        };
        let link = home.join(relative);
        if let Some(parent) = link.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::os::unix::fs::symlink(source, &link)
            .with_context(|| format!("Could not link {} into the sandbox", relative.display()))?;
    }
    Ok(home)
}

/// Folders holding the programs on `PATH`, outside the home folder: a
/// `bin` folder's prefix (for example Homebrew's), or the folder itself.
pub fn path_roots(home: Option<&Path>) -> Vec<PathBuf> {
    let home = home.map(super::real);
    let path = std::env::var_os("PATH").unwrap_or_default();
    let mut roots: Vec<PathBuf> = Vec::new();
    for dir in std::env::split_paths(&path) {
        let Ok(dir) = dir.canonical() else {
            continue;
        };
        if home
            .as_ref()
            .is_some_and(|home| dir.starts_with(home) || home.starts_with(&dir))
            || READ_ROOTS.iter().any(|root| dir.starts_with(root))
        {
            continue;
        }
        let prefix = match (dir.file_name(), dir.parent()) {
            (Some(name), Some(parent))
                if (name == "bin" || name == "sbin") && parent.components().count() >= 4 =>
            {
                parent.to_path_buf()
            }
            _ => dir,
        };
        // Never a volume or a top-level folder as a whole.
        if prefix.components().count() >= 3 && !roots.contains(&prefix) {
            roots.push(prefix);
        }
    }
    roots
}

/// The active developer folder (`xcode-select -p`), asked once. Passing it
/// as `DEVELOPER_DIR` keeps Apple's `git`/`clang` shims from running
/// `xcodebuild` (slow, and noisy inside the sandbox) on every call.
pub fn developer_dir() -> Option<PathBuf> {
    static DIR: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
        if let Some(dir) = std::env::var_os("DEVELOPER_DIR") {
            return Some(PathBuf::from(dir));
        }
        let output = Command::new("/usr/bin/xcode-select")
            .arg("-p")
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        let dir = PathBuf::from(String::from_utf8(output.stdout).ok()?.trim());
        (output.status.success() && dir.is_dir()).then_some(dir)
    });
    DIR.clone()
}

/// The per-user temporary folder (`DARWIN_USER_TEMP_DIR`), real path.
pub fn user_temp() -> Option<PathBuf> {
    let mut buffer = vec![0u8; libc::PATH_MAX as usize];
    // SAFETY: confstr writes at most `len` bytes, NUL-terminated.
    let len = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
        )
    };
    if len == 0 || len > buffer.len() {
        return None;
    }
    buffer.truncate(len - 1);
    PathBuf::from(String::from_utf8(buffer).ok()?)
        .canonical()
        .ok()
}

/// `sandbox-exec` exists and can start a trivial sandboxed program.
pub fn probe() -> Result<()> {
    ensure!(
        Path::new(PROGRAM).is_file(),
        "sandbox-exec is missing from this Mac"
    );
    let mut child = Command::new(PROGRAM)
        .args(["-p", "(version 1)(allow default)", "/usr/bin/true"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("Could not start sandbox-exec")?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.try_wait()? {
            ensure!(status.success(), "sandbox-exec could not start ({status})");
            return Ok(());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            anyhow::bail!("sandbox-exec availability probe timed out");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
