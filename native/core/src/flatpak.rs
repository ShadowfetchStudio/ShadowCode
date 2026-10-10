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
