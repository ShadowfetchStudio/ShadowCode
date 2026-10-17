//! Shared by the integration tests; each uses only some of it.
#![allow(dead_code)]
use serde_json::Value;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
pub struct Server {
    pub endpoint: String,
    pub requests: Arc<Mutex<Vec<Value>>>,
    worker: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.worker.abort();
    }
}
pub async fn server(
    handler: impl Fn(usize, &Value) -> (Value, Duration) + Send + 'static,
) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = requests.clone();
    let worker = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut wire = Vec::new();
            let mut buffer = [0; 8192];
            let body = loop {
                let count = socket.read(&mut buffer).await.unwrap_or(0);
                if count == 0 {
                    return;
                }
                wire.extend_from_slice(&buffer[..count]);
                assert!(wire.len() < 16_000_000);
                if let Some(end) = wire.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&wire[..end]).to_lowercase();
                    let len = headers
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if wire.len() >= end + 4 + len {
                        break serde_json::from_slice::<Value>(&wire[end + 4..end + 4 + len])
                            .unwrap();
                    }
                }
            };
            let index = {
                let mut seen = captured.lock().unwrap();
                let index = seen.len();
                seen.push(body.clone());
                index
            };
            let (response, delay) = handler(index, &body);
            let text = response.to_string();
            if socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",text.len()).as_bytes()).await.is_err(){continue;}
            tokio::time::sleep(delay).await;
            let _ = socket.write_all(text.as_bytes()).await;
        }
    });
    Server {
        endpoint,
        requests,
        worker,
    }
}

/// Whether a process exists and has not exited (a zombie has).
pub fn running(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| {
            stat.rsplit_once(") ")
                .is_some_and(|(_, state)| !state.starts_with('Z') && !state.starts_with('X'))
        })
    }
    #[cfg(target_os = "macos")]
    {
        let Ok(pid) = i32::try_from(pid) else {
            return false;
        };
        // SAFETY: proc_bsdinfo is plain data; proc_pidinfo writes at most
        // `size` bytes into it.
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
        let written = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        written == size && info.pbi_status != libc::SZOMB
    }
}

/// Whether a process id is still taken, zombies included (not yet reaped).
pub fn exists(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid, 0) == 0 || *errno() == libc::EPERM }
}
#[cfg(target_os = "linux")]
unsafe fn errno() -> *mut i32 {
    unsafe { libc::__errno_location() }
}
#[cfg(target_os = "macos")]
unsafe fn errno() -> *mut i32 {
    unsafe { libc::__error() }
}
