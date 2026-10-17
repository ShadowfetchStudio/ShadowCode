//! The drawer's terminals on Windows: not ported yet (docs/WINDOWS_PORT.md;
//! they need ConPTY). The same interface as the Unix version, so the routes
//! compile and answer with a clear message instead of a terminal.
use anyhow::{bail, Result};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::broadcast;

/// Scrollback kept per terminal. Older output is dropped from the front.
pub const SCROLLBACK_BYTES: usize = 512 * 1024;
/// Open terminals per desktop view, across projects.
pub const MAX_TERMINALS: usize = 12;
/// One read returns at most this much output; `more` asks for another read.
pub const READ_LIMIT: usize = 256 * 1024;
/// One write (a keystroke batch or a paste) is at most this large.
pub const WRITE_LIMIT: usize = 64 * 1024;

const UNAVAILABLE: &str = "Terminals are not available on Windows yet.";

/// How to start a terminal. `shell` overrides the login shell (tests).
#[derive(Clone, Debug, Default)]
pub struct OpenOptions {
    pub cols: u16,
    pub rows: u16,
    pub shell: Option<PathBuf>,
    /// Start the shell as a login shell (reads the user's profile).
    pub login: bool,
}

/// The terminals of one desktop view (none on Windows yet).
pub struct Terminals {
    _sender: broadcast::Sender<Value>,
}

impl Terminals {
    pub fn new(sender: broadcast::Sender<Value>) -> Self {
        Self { _sender: sender }
    }
    pub fn open(&self, _workspace: &Path, _options: OpenOptions) -> Result<Value> {
        bail!(UNAVAILABLE)
    }
    pub fn list(&self, _workspace: Option<&Path>) -> Result<Vec<Value>> {
        Ok(Vec::new())
    }
    pub fn workspace(&self, _id: &str) -> Result<PathBuf> {
        bail!("Unknown terminal")
    }
    pub fn write(&self, _id: &str, _data: &[u8]) -> Result<()> {
        bail!("Unknown terminal")
    }
    pub fn resize(&self, _id: &str, _cols: u16, _rows: u16) -> Result<Value> {
        bail!("Unknown terminal")
    }
    pub fn read(&self, _id: &str, _after: u64) -> Result<Value> {
        bail!("Unknown terminal")
    }
    pub fn close(&self, _id: &str) -> Result<()> {
        bail!("Unknown terminal")
    }
    pub fn close_all(&self, _wait: Duration) {}
}

/// Terminal-safe check used by routes: a terminal id is 32 hex digits.
pub fn valid_id(id: &str) -> Result<&str> {
    if id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(id)
    } else {
        bail!("Unknown terminal")
    }
}
