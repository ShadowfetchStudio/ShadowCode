//! macOS apps opened from Finder or the Dock inherit launchd's minimal
//! `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), so Homebrew's Git, Node and the
//! vendor command-line tools would be missing. When not started from a
//! terminal, ask the user's login shell for its `PATH` once at startup and
//! put those entries first; the inherited entries stay after them.
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const MARK: &str = "__SHADOWCODE_PATH__";
const WAIT: Duration = Duration::from_secs(5);

/// Adopt the login shell's `PATH`. Call before any other thread starts.
pub fn adopt() {
    if std::env::var_os("TERM").is_some() {
        // Started from a terminal: its PATH is already the user's.
        return;
    }
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut entries: Vec<String> = login_path().map(|p| split(&p)).unwrap_or_default();
    if entries.is_empty() {
        // The shell did not answer in time: the usual install locations.
        let home = std::env::var("HOME").unwrap_or_default();
        entries = [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            &format!("{home}/.local/bin"),
            &format!("{home}/.cargo/bin"),
        ]
        .iter()
        .filter(|dir| Path::new(dir).is_dir())
        .map(|dir| dir.to_string())
        .collect();
    }
    for entry in split(&inherited) {
        if !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    // Called at startup, before the program starts other threads.
    std::env::set_var("PATH", entries.join(":"));
}

fn split(path: &str) -> Vec<String> {
    path.split(':')
        .filter(|entry| entry.starts_with('/'))
        .map(str::to_owned)
        .collect()
}

/// `PATH` as an interactive login shell sets it (.zprofile and .zshrc).
fn login_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|shell| shell.starts_with('/') && Path::new(shell).is_file())
        .unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-l", "-i", "-c"])
        .arg(format!("printf '{MARK}%s{MARK}' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < WAIT => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let text = reader.join().ok()?;
    let start = text.find(MARK)? + MARK.len();
    let end = start + text[start..].find(MARK)?;
    Some(text[start..end].to_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_absolute_entries_are_kept() {
        assert_eq!(
            super::split("/a::relative:/b"),
            vec!["/a".to_string(), "/b".to_string()]
        );
    }
}
