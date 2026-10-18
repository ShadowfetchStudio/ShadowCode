use anyhow::{ensure, Context, Result};
use fs2::FileExt;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

/// A path inside a project as the agent and the interface show it: `/`
/// between its parts on every system. (On Unix a `\` is part of a name.)
pub fn slash(path: &Path) -> String {
    let text = path.to_string_lossy();
    if cfg!(windows) {
        text.replace('\\', "/")
    } else {
        text.into_owned()
    }
}

/// `canonicalize` that returns `C:\project` rather than `\\?\C:\project` on
/// Windows whenever both name the same file (dunce). Verbatim paths confuse
/// Git, other programs and anyone reading them. Identical to the standard
/// one on Unix.
pub trait Canonical {
    fn canonical(&self) -> std::io::Result<PathBuf>;
}
impl<P: AsRef<Path> + ?Sized> Canonical for P {
    fn canonical(&self) -> std::io::Result<PathBuf> {
        dunce::canonicalize(self)
    }
}

/// Preserve the existing XDG identity so upgrades retain settings and history.
#[derive(Clone, Debug)]
pub struct AppPaths {
    pub config: PathBuf,
    pub data: PathBuf,
    pub state: PathBuf,
    /// Rebuildable data such as the code index (`$XDG_CACHE_HOME`); never
    /// backed up.
    pub cache: PathBuf,
}

/// A lock is released when its last legitimate owner drops, even if an
/// unrelated concurrent fork inherited the descriptor before close-on-exec.
pub struct ProfileLock {
    file: fs::File,
    owner_pid: u32,
}
impl Drop for ProfileLock {
    fn drop(&mut self) {
        // A forked copy must not unlock a still-live parent's engine.
        if self.owner_pid == std::process::id() {
            let _ = FileExt::unlock(&self.file);
        }
    }
}

/// The user's home folder. Windows names it `USERPROFILE`; a program started
/// from Explorer has no `HOME` (Git Bash sets one).
pub fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"));
    #[cfg(not(windows))]
    let home = env::var_os("HOME");
    home.map(PathBuf::from)
}

impl AppPaths {
    pub fn discover() -> Result<Self> {
        let home = home_dir().context("HOME is not set")?;
        // macOS keeps app settings and history under ~/Library; an XDG
        // variable someone set on purpose still wins there too.
        #[cfg(target_os = "macos")]
        let fallback = |base: &str| match base {
            ".cache" => home.join("Library/Caches/ShadowCode"),
            ".config" => home.join("Library/Application Support/ShadowCode/config"),
            ".local/share" => home.join("Library/Application Support/ShadowCode/data"),
            _ => home.join("Library/Application Support/ShadowCode/state"),
        };
        // Windows: settings roam with the account (%APPDATA%); history,
        // models and caches stay on this computer (%LOCALAPPDATA%).
        #[cfg(windows)]
        let fallback = |base: &str| {
            let folder = |key: &str, default: &str| {
                env::var_os(key)
                    .map(PathBuf::from)
                    .filter(|p| p.is_absolute())
                    .unwrap_or_else(|| home.join(default))
                    .join("ShadowCode")
            };
            match base {
                ".config" => folder("APPDATA", "AppData/Roaming").join("config"),
                ".local/share" => folder("LOCALAPPDATA", "AppData/Local").join("data"),
                ".cache" => folder("LOCALAPPDATA", "AppData/Local").join("cache"),
                _ => folder("LOCALAPPDATA", "AppData/Local").join("state"),
            }
        };
        #[cfg(all(unix, not(target_os = "macos")))]
        let fallback = |base: &str| home.join(base).join("shadow-agent");
        let xdg = |key: &str, base: &str| {
            env::var_os(key)
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .map(|p| p.join("shadow-agent"))
                .unwrap_or_else(|| fallback(base))
        };
        let result = Self {
            config: xdg("XDG_CONFIG_HOME", ".config"),
            data: xdg("XDG_DATA_HOME", ".local/share"),
            state: xdg("XDG_STATE_HOME", ".local/state"),
            cache: xdg("XDG_CACHE_HOME", ".cache"),
        };
        result.ensure()?;
        Ok(result)
    }

    /// Explicit roots keep tests and command-line profiles away from user data.
    pub fn isolated(root: &Path) -> Result<Self> {
        let result = Self {
            config: root.join("config"),
            data: root.join("data"),
            state: root.join("state"),
            cache: root.join("cache"),
        };
        result.ensure()?;
        Ok(result)
    }

    pub fn ensure(&self) -> Result<()> {
        for path in [&self.config, &self.data, &self.state] {
            private_directory(path)?;
        }
        Ok(())
    }
    pub fn database(&self) -> PathBuf {
        self.state.join("shadow-agent.db")
    }
    pub fn config_file(&self) -> PathBuf {
        self.config.join("config.yaml")
    }
    pub fn secrets_file(&self) -> PathBuf {
        self.config.join("secrets.env")
    }
    pub fn remembered_workspace(&self) -> Option<PathBuf> {
        let path = PathBuf::from(
            fs::read_to_string(self.state.join("last-workspace.txt"))
                .ok()?
                .trim(),
        );
        path.canonical().ok().filter(|p| p.is_dir())
    }
    pub fn remember_workspace(&self, path: &Path) -> Result<()> {
        atomic_write(
            &self.state.join("last-workspace.txt"),
            format!("{}\n", path.canonical()?.display()).as_bytes(),
            false,
        )
    }

    /// Hold this for the whole process lifetime. A second manager must not mark
    /// live jobs interrupted or overwrite another manager's workspace state.
    pub fn lock(&self) -> Result<ProfileLock> {
        self.ensure()?;
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(false).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let file = options
            .open(self.state.join("native.lock"))
            .context("Cannot open the profile lock; native.lock must be a regular file")?;
        let metadata = file.metadata()?;
        ensure!(metadata.is_file(), "Profile lock must be a regular file");
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            ensure!(
                metadata.uid() == unsafe { libc::geteuid() } && metadata.nlink() == 1,
                "Profile lock must be owned by your account and must not have other hard links"
            );
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.try_lock_exclusive()
            .context("ShadowCode is already running for this profile")?;
        Ok(ProfileLock {
            file,
            owner_pid: std::process::id(),
        })
    }
}
/// A path naming the directory held open as `fd`. Linux names the
/// descriptor itself; macOS has no /proc and asks the kernel for the
/// directory's current path, so callers that later act through the held
/// descriptor fail closed if the directory moved in between.
#[cfg(unix)]
pub(crate) fn held_directory(fd: std::os::fd::RawFd) -> Result<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        Ok(PathBuf::from(format!("/proc/self/fd/{fd}")))
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let mut buffer = vec![0u8; libc::PATH_MAX as usize];
        // SAFETY: F_GETPATH writes at most PATH_MAX bytes, NUL-terminated.
        let rc = unsafe { libc::fcntl(fd, libc::F_GETPATH, buffer.as_mut_ptr()) };
        anyhow::ensure!(
            rc != -1,
            "Could not name a held directory: {}",
            std::io::Error::last_os_error()
        );
        let end = buffer.iter().position(|b| *b == 0).unwrap_or(buffer.len());
        Ok(PathBuf::from(std::ffi::OsStr::from_bytes(&buffer[..end])))
    }
}

/// Restrict only application-owned leaves, not the user's XDG base or an
/// existing --profile parent. Use the opened directory for validation/chmod so
/// a final symlink cannot redirect a permission change to another directory.
pub(crate) fn private_directory(path: &Path) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(path)
        .with_context(|| format!("Cannot create profile directory {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
        let directory = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .with_context(|| {
                format!(
                    "Profile directory {} must be a real directory, not a symlink",
                    path.display()
                )
            })?;
        ensure!(
            directory.metadata()?.uid() == unsafe { libc::geteuid() },
            "Profile directory {} must be owned by your account",
            path.display()
        );
        directory.set_permissions(fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Make a rename or new entry in `directory` durable. Windows cannot open a
/// folder as a file; NTFS journals its metadata, so there is nothing to do.
pub fn sync_directory(directory: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::File::open(directory)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = directory;
    Ok(())
}

/// Make a file's written bytes durable. Windows flushes only through a
/// handle that may write.
pub fn sync_file(path: &Path) -> Result<()> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    options.write(true);
    options.open(path)?.sync_all()?;
    Ok(())
}

pub fn atomic_write(path: &Path, bytes: &[u8], private: bool) -> Result<()> {
    use std::io::Write;
    let parent = path.parent().context("Path has no parent")?;
    fs::create_dir_all(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    #[cfg(not(unix))]
    let _ = private;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if private {
            0o600
        } else {
            fs::metadata(path)
                .map(|m| m.permissions().mode() & 0o777)
                .unwrap_or(0o644)
        };
        temp.as_file()
            .set_permissions(fs::Permissions::from_mode(mode))?;
    }
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    sync_directory(parent)?;
    Ok(())
}
