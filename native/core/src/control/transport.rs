//! The control channel's byte stream and who may use it.
//!
//! * Unix: a socket file in a private folder, mode 600, whose peer's user ID
//!   is checked on both ends (see `control.rs`).
//! * Windows: a named pipe that refuses remote clients and whose only access
//!   rule is this user's SID. Before sending anything, a client checks that
//!   the process serving the pipe runs as this user, so another account
//!   cannot answer by creating the pipe name first.
use anyhow::Result;
use std::path::Path;

#[cfg(unix)]
pub type Stream = tokio::net::UnixStream;
#[cfg(windows)]
pub use windows::{Listener, Stream};

#[cfg(unix)]
pub type ReadHalf = tokio::net::unix::OwnedReadHalf;
#[cfg(unix)]
pub type WriteHalf = tokio::net::unix::OwnedWriteHalf;
// A pipe has no half-close; the view protocol ends with explicit messages.
#[cfg(windows)]
pub type ReadHalf = tokio::io::ReadHalf<Stream>;
#[cfg(windows)]
pub type WriteHalf = tokio::io::WriteHalf<Stream>;

pub fn split(stream: Stream) -> (ReadHalf, WriteHalf) {
    #[cfg(unix)]
    {
        stream.into_split()
    }
    #[cfg(windows)]
    {
        tokio::io::split(stream)
    }
}

/// Connect to the engine listening at `path`.
pub async fn connect(path: &Path) -> Result<Stream> {
    #[cfg(unix)]
    {
        use anyhow::{ensure, Context};
        let stream = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            tokio::net::UnixStream::connect(path),
        )
        .await
        .context("Local engine connection timed out")??;
        ensure!(
            stream.peer_cred()?.uid() == super::uid(),
            "Local engine belongs to another OS user"
        );
        Ok(stream)
    }
    #[cfg(windows)]
    {
        windows::connect(path).await
    }
}

/// Whether the peer of an accepted connection runs as this user.
pub fn peer_is_this_user(stream: &Stream) -> Result<bool> {
    #[cfg(unix)]
    {
        Ok(stream.peer_cred()?.uid() == super::uid())
    }
    #[cfg(windows)]
    {
        windows::client_is_this_user(stream)
    }
}

/// The process ID of an accepted connection's peer, when known.
pub fn peer_pid(stream: &Stream) -> Result<Option<i32>> {
    #[cfg(unix)]
    {
        Ok(stream.peer_cred()?.pid())
    }
    #[cfg(windows)]
    {
        windows::client_pid(stream).map(Some)
    }
}

#[cfg(windows)]
mod windows {
    use anyhow::{ensure, Context, Result};
    use std::{
        ffi::c_void,
        io,
        os::windows::io::{AsRawHandle, RawHandle},
        path::Path,
        pin::Pin,
        task::{Context as TaskContext, Poll},
        time::{Duration, Instant},
    };
    use tokio::{
        io::{AsyncRead, AsyncWrite, ReadBuf},
        net::windows::named_pipe::{
            ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions,
        },
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SDDL_REVISION_1,
            },
            EqualSid, GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
        },
        System::{
            Pipes::{GetNamedPipeClientProcessId, GetNamedPipeServerProcessId},
            Threading::{
                GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
    };

    /// ERROR_PIPE_BUSY: every instance is serving another client.
    const PIPE_BUSY: i32 = 231;

    /// One end of the engine's named pipe.
    pub enum Stream {
        Server(NamedPipeServer),
        Client(NamedPipeClient),
    }
    impl Stream {
        fn handle(&self) -> RawHandle {
            match self {
                Self::Server(pipe) => pipe.as_raw_handle(),
                Self::Client(pipe) => pipe.as_raw_handle(),
            }
        }
    }
    impl AsyncRead for Stream {
        fn poll_read(
            self: Pin<&mut Self>,
            cx: &mut TaskContext<'_>,
            buf: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            match self.get_mut() {
                Self::Server(pipe) => Pin::new(pipe).poll_read(cx, buf),
                Self::Client(pipe) => Pin::new(pipe).poll_read(cx, buf),
            }
        }
    }
    impl AsyncWrite for Stream {
        fn poll_write(
            self: Pin<&mut Self>,
            cx: &mut TaskContext<'_>,
            buf: &[u8],
        ) -> Poll<io::Result<usize>> {
            match self.get_mut() {
                Self::Server(pipe) => Pin::new(pipe).poll_write(cx, buf),
                Self::Client(pipe) => Pin::new(pipe).poll_write(cx, buf),
            }
        }
        fn poll_flush(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
            match self.get_mut() {
                Self::Server(pipe) => Pin::new(pipe).poll_flush(cx),
                Self::Client(pipe) => Pin::new(pipe).poll_flush(cx),
            }
        }
        fn poll_shutdown(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
            match self.get_mut() {
                Self::Server(pipe) => Pin::new(pipe).poll_shutdown(cx),
                Self::Client(pipe) => Pin::new(pipe).poll_shutdown(cx),
            }
        }
    }

    /// A handle closed when dropped.
    struct Owned(HANDLE);
    impl Drop for Owned {
        fn drop(&mut self) {
            // SAFETY: the handle was opened by this module and is closed once.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// The user SID of a process's token, as owned bytes.
    fn process_user(process: HANDLE) -> Result<Vec<u8>> {
        let mut token: HANDLE = std::ptr::null_mut();
        // SAFETY: OpenProcessToken writes one handle on success.
        ensure!(
            unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } != 0,
            "Could not read a process token: {}",
            io::Error::last_os_error()
        );
        let token = Owned(token);
        let mut needed = 0u32;
        // SAFETY: a size query; nothing is written with a zero length.
        unsafe { GetTokenInformation(token.0, TokenUser, std::ptr::null_mut(), 0, &mut needed) };
        ensure!(needed > 0 && needed < 4096, "Unexpected token size");
        let mut buffer = vec![0u8; needed as usize];
        // SAFETY: the buffer is `needed` bytes long.
        ensure!(
            unsafe {
                GetTokenInformation(
                    token.0,
                    TokenUser,
                    buffer.as_mut_ptr().cast(),
                    needed,
                    &mut needed,
                )
            } != 0,
            "Could not read a process's user: {}",
            io::Error::last_os_error()
        );
        Ok(buffer)
    }

    /// Whether two TOKEN_USER buffers name the same account.
    fn same_user(a: &[u8], b: &[u8]) -> bool {
        // SAFETY: both buffers hold a TOKEN_USER filled by GetTokenInformation;
        // its SID pointer points into the same buffer.
        unsafe {
            let a = &*(a.as_ptr() as *const TOKEN_USER);
            let b = &*(b.as_ptr() as *const TOKEN_USER);
            EqualSid(a.User.Sid, b.User.Sid) != 0
        }
    }

    fn this_user() -> Result<Vec<u8>> {
        // SAFETY: GetCurrentProcess returns a pseudo-handle that needs no closing.
        process_user(unsafe { GetCurrentProcess() })
    }

    /// Whether the process `pid` runs as this user.
    fn pid_is_this_user(pid: u32) -> Result<bool> {
        // SAFETY: OpenProcess returns a handle or null.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        ensure!(
            !process.is_null(),
            "Could not inspect process {pid}: {}",
            io::Error::last_os_error()
        );
        let process = Owned(process);
        Ok(same_user(&process_user(process.0)?, &this_user()?))
    }

    pub fn client_pid(stream: &Stream) -> Result<i32> {
        let mut pid = 0u32;
        // SAFETY: the handle is the open pipe; one u32 is written.
        ensure!(
            unsafe { GetNamedPipeClientProcessId(stream.handle() as HANDLE, &mut pid) } != 0,
            "Could not identify the local client: {}",
            io::Error::last_os_error()
        );
        Ok(pid as i32)
    }

    pub fn client_is_this_user(stream: &Stream) -> Result<bool> {
        pid_is_this_user(client_pid(stream)? as u32)
    }

    pub async fn connect(path: &Path) -> Result<Stream> {
        let deadline = Instant::now() + Duration::from_secs(2);
        let client = loop {
            match ClientOptions::new().open(path) {
                Ok(client) => break client,
                Err(error)
                    if error.raw_os_error() == Some(PIPE_BUSY) && Instant::now() < deadline =>
                {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(error) => return Err(error.into()),
            }
        };
        let mut pid = 0u32;
        // SAFETY: the handle is the open pipe; one u32 is written.
        ensure!(
            unsafe { GetNamedPipeServerProcessId(client.as_raw_handle() as HANDLE, &mut pid) } != 0,
            "Could not identify the local engine: {}",
            io::Error::last_os_error()
        );
        ensure!(
            pid_is_this_user(pid)?,
            "Local engine belongs to another Windows user"
        );
        Ok(Stream::Client(client))
    }

    /// A security descriptor that grants this user, and nobody else, access.
    struct Descriptor(*mut c_void);
    impl Drop for Descriptor {
        fn drop(&mut self) {
            // SAFETY: allocated by ConvertStringSecurityDescriptorToSecurityDescriptorW.
            unsafe { LocalFree(self.0) };
        }
    }
    // The descriptor is only read by CreateNamedPipeW.
    unsafe impl Send for Descriptor {}
    unsafe impl Sync for Descriptor {}

    fn only_this_user() -> Result<Descriptor> {
        let user = this_user()?;
        let mut text: *mut u16 = std::ptr::null_mut();
        // SAFETY: the SID points into `user`; ConvertSidToStringSidW allocates
        // the string, which is freed below.
        let sid = unsafe {
            let token = &*(user.as_ptr() as *const TOKEN_USER);
            ensure!(
                ConvertSidToStringSidW(token.User.Sid, &mut text) != 0,
                "Could not name this user: {}",
                io::Error::last_os_error()
            );
            let len = (0..).take_while(|&i| *text.add(i) != 0).count();
            let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
            LocalFree(text.cast());
            sid
        };
        // Protected DACL with one rule: full access for this user.
        let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut descriptor: *mut c_void = std::ptr::null_mut();
        // SAFETY: the SDDL string is NUL-terminated; the descriptor is
        // allocated by the call and freed by `Descriptor`.
        ensure!(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    std::ptr::null_mut(),
                )
            } != 0,
            "Could not build the pipe's access rules: {}",
            io::Error::last_os_error()
        );
        Ok(Descriptor(descriptor))
    }

    /// The engine's pipe: always one instance waiting for the next client.
    pub struct Listener {
        name: std::path::PathBuf,
        next: NamedPipeServer,
        descriptor: Descriptor,
    }
    impl Listener {
        /// Create the first instance; fails if an engine already serves `name`.
        pub fn bind(name: &Path) -> Result<Self> {
            let descriptor = only_this_user()?;
            let next = Self::instance(name, &descriptor, true)
                .context("Local engine control endpoint is already running")?;
            Ok(Self {
                name: name.to_path_buf(),
                next,
                descriptor,
            })
        }
        fn instance(name: &Path, descriptor: &Descriptor, first: bool) -> Result<NamedPipeServer> {
            let mut attributes = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor.0,
                bInheritHandle: 0,
            };
            // SAFETY: the attributes and descriptor outlive the call.
            let pipe = unsafe {
                ServerOptions::new()
                    .first_pipe_instance(first)
                    .reject_remote_clients(true)
                    .create_with_security_attributes_raw(
                        name,
                        (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
                    )
            }?;
            Ok(pipe)
        }
        /// Wait for a client; a fresh instance takes its place first.
        pub async fn accept(&mut self) -> Result<Stream> {
            self.next.connect().await?;
            let next = Self::instance(&self.name, &self.descriptor, false)?;
            let connected = std::mem::replace(&mut self.next, next);
            Ok(Stream::Server(connected))
        }
    }
}
