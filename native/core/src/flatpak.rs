//! Host-shell integration for the Flatpak distribution. The GUI, engine,
//! persistence and bundled inference remain inside the application runtime.
use std::path::{Path, PathBuf};

pub fn host_bridge() -> Option<PathBuf> {
    let bridge = Path::new("/app/libexec/shadowcode-host");
    (Path::new("/.flatpak-info").is_file() && bridge.is_file()).then(|| bridge.to_owned())
}

/// Environment needed to reach Flatpak's authenticated host-spawn service.
pub const HOST_ENV: &[&str] = &[
    "DBUS_SESSION_BUS_ADDRESS",
    "SHADOWCODE_HOST_PATH",
    "SHADOWCODE_HOST_DBUS",
];

/// Name of the allow-list relay installed beside the host bridge.
pub const RELAY_NAME: &str = "shadowcode-proxy-relay";

/// The `app-path` of `/.flatpak-info`: where this application's `/app` lives
/// on the host, so a host process can execute a file shipped in it.
pub fn app_path_from_info(info: &str) -> Option<PathBuf> {
    info.lines()
        .find_map(|line| line.trim().strip_prefix("app-path="))
        .map(|value| PathBuf::from(value.trim()))
        .filter(|path| path.is_absolute())
}

/// The relay binary as the host sees it, if this package ships one.
pub fn host_relay() -> Option<PathBuf> {
    let local = Path::new("/app/libexec").join(RELAY_NAME);
    if !local.is_file() {
        return None;
    }
    let info = std::fs::read_to_string("/.flatpak-info").ok()?;
    Some(app_path_from_info(&info)?.join("libexec").join(RELAY_NAME))
}

/// A folder this process and host commands see at the same absolute path:
/// Flatpak's per-application runtime folder, or the launcher's host-visible
/// temporary folder. The relay's probe connection proves it either way.
pub fn shared_socket_base() -> Option<PathBuf> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .zip(std::env::var_os("FLATPAK_ID"))
        .map(|(run, id)| PathBuf::from(run).join("app").join(id))
        .filter(|path| path.is_absolute() && path.is_dir());
    runtime.or_else(|| {
        let tmp = std::env::temp_dir();
        // The Flatpak's own /tmp is private to the application sandbox.
        (!tmp.starts_with("/tmp") && !tmp.starts_with("/var/tmp") && tmp.is_dir()).then_some(tmp)
    })
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn app_path_is_read_from_flatpak_info() {
        let info = "[Application]\nname=com.shadowfetch.shadowcode\n\n[Instance]\napp-path=/var/lib/flatpak/app/com.shadowfetch.shadowcode/x86_64/master/abc/files\n";
        assert_eq!(
            app_path_from_info(info).unwrap(),
            Path::new("/var/lib/flatpak/app/com.shadowfetch.shadowcode/x86_64/master/abc/files")
        );
        assert_eq!(app_path_from_info("[Instance]\napp-path=relative\n"), None);
        assert_eq!(app_path_from_info("[Instance]\n"), None);
    }
}
