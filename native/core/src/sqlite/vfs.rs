//! Preserve the directory capability in SQLite's filename. The bundled Unix
//! VFS otherwise canonicalizes /proc/self/fd back to an ambient path, losing
//! the held parent when a project directory is renamed. All locking, WAL and
//! I/O methods remain SQLite's own; this is not a second locking implementation.
//!
//! macOS has no /proc: a name under a reserved prefix stands for the held
//! directory, and SQLite's own `open` and `stat` calls for such a name are
//! answered relative to that directory (`openat`), see [`calls`].
use anyhow::{ensure, Context, Result};
use rusqlite::ffi;
use std::{
    ffi::{c_char, c_int, CStr},
    os::fd::RawFd,
    sync::OnceLock,
};

pub(super) const NAME: &str = "shadowcode-confined-readonly";

#[cfg(target_os = "linux")]
const PREFIX: &str = "/proc/self/fd/";
#[cfg(not(target_os = "linux"))]
const PREFIX: &str = "/.shadowcode-confined-fd/";

/// SQLite's filename for `leaf` inside the held directory `dir`.
pub(super) fn filename(dir: RawFd, leaf: &str) -> String {
    format!("{PREFIX}{dir}/{leaf}")
}

/// The held directory and the single leaf a confined name stands for.
fn split(name: &CStr) -> Option<(RawFd, &CStr)> {
    let bytes = name.to_bytes_with_nul();
    let rest = bytes.strip_prefix(PREFIX.as_bytes())?;
    let split = rest.iter().position(|b| *b == b'/')?;
    let (fd, leaf) = rest.split_at(split);
    let leaf = &leaf[1..];
    let valid = !fd.is_empty()
        && fd.len() <= 9
        && fd.iter().all(u8::is_ascii_digit)
        && leaf.len() > 1
        && !leaf.contains(&b'/')
        && leaf != b".\0"
        && leaf != b"..\0";
    if !valid {
        return None;
    }
    let fd = std::str::from_utf8(fd).ok()?.parse().ok()?;
    Some((fd, CStr::from_bytes_with_nul(leaf).ok()?))
}

fn valid(name: &CStr) -> bool {
    split(name).is_some()
}

/// Whether a confined name is a regular file, never following a link.
fn regular_file(name: &CStr) -> std::io::Result<bool> {
    let (fd, leaf) = split(name).ok_or(std::io::ErrorKind::InvalidInput)?;
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // `fd` is the caller's held directory and `leaf` one NUL-terminated name.
    let code = unsafe {
        libc::fstatat(
            fd,
            leaf.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if code != 0 {
        return Err(std::io::Error::last_os_error());
    }
    let stat = unsafe { stat.assume_init() };
    Ok(stat.st_mode & libc::S_IFMT == libc::S_IFREG)
}

/// Keeps a held directory reachable through [`filename`] while a connection
/// is open. Linux names it through /proc and needs no registration.
pub(super) struct Held(#[allow(dead_code)] RawFd);

pub(super) fn hold(dir: RawFd) -> Held {
    #[cfg(target_os = "macos")]
    calls::hold(dir);
    Held(dir)
}

#[cfg(target_os = "macos")]
impl Drop for Held {
    fn drop(&mut self) {
        calls::release(self.0);
    }
}

unsafe extern "C" fn full_path(
    _: *mut ffi::sqlite3_vfs,
    input: *const c_char,
    size: c_int,
    out: *mut c_char,
) -> c_int {
    if input.is_null() || out.is_null() {
        return ffi::SQLITE_CANTOPEN;
    }
    // SQLite owns the NUL-terminated input and the output buffer of `size` bytes.
    let name = unsafe { CStr::from_ptr(input) };
    let bytes = name.to_bytes_with_nul();
    if !valid(name) || size < 0 || bytes.len() > size as usize {
        return ffi::SQLITE_CANTOPEN;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr().cast(), out, bytes.len());
    }
    ffi::SQLITE_OK
}

unsafe extern "C" fn open(
    vfs: *mut ffi::sqlite3_vfs,
    name: *const c_char,
    file: *mut ffi::sqlite3_file,
    flags: c_int,
    actual: *mut c_int,
) -> c_int {
    unsafe {
        (*file).pMethods = std::ptr::null();
    }
    if name.is_null()
        || flags & (ffi::SQLITE_OPEN_MAIN_DB | ffi::SQLITE_OPEN_MAIN_JOURNAL | ffi::SQLITE_OPEN_WAL)
            == 0
    {
        return ffi::SQLITE_READONLY;
    }
    let name_str = unsafe { CStr::from_ptr(name) };
    if !valid(name_str) {
        return ffi::SQLITE_CANTOPEN;
    }
    match regular_file(name_str) {
        Ok(true) => (),
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound
                && flags & ffi::SQLITE_OPEN_WAL != 0
                && flags & ffi::SQLITE_OPEN_CREATE != 0 => {}
        _ => return ffi::SQLITE_CANTOPEN,
    }
    // The main database and rollback journal are always read-only. Let SQLite
    // manage WAL coordination normally: even a read-only connection may need
    // to create a WAL or initialize shared memory after a clean/crashed writer.
    // SQL authorization separately prevents data/schema writes and checkpoints.
    let flags = if flags & ffi::SQLITE_OPEN_WAL != 0 {
        flags
    } else {
        (flags
            & !(ffi::SQLITE_OPEN_READWRITE
                | ffi::SQLITE_OPEN_CREATE
                | ffi::SQLITE_OPEN_DELETEONCLOSE))
            | ffi::SQLITE_OPEN_READONLY
    };
    let base = unsafe { ffi::sqlite3_vfs_find(c"unix".as_ptr()) };
    if base.is_null() {
        return ffi::SQLITE_CANTOPEN;
    }
    unsafe { (*base).xOpen.unwrap()(vfs, name, file, flags, actual) }
}

unsafe extern "C" fn delete(_: *mut ffi::sqlite3_vfs, _: *const c_char, _: c_int) -> c_int {
    ffi::SQLITE_READONLY
}

unsafe extern "C" fn access(
    _: *mut ffi::sqlite3_vfs,
    name: *const c_char,
    flags: c_int,
    result: *mut c_int,
) -> c_int {
    unsafe {
        *result = 0;
    }
    if name.is_null() {
        return ffi::SQLITE_CANTOPEN;
    }
    let name = unsafe { CStr::from_ptr(name) };
    if !valid(name) {
        return ffi::SQLITE_CANTOPEN;
    }
    match regular_file(name) {
        Ok(true) => {
            unsafe {
                *result = i32::from(flags != ffi::SQLITE_ACCESS_READWRITE);
            }
            ffi::SQLITE_OK
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ffi::SQLITE_OK,
        _ => ffi::SQLITE_CANTOPEN,
    }
}

pub(super) fn register() -> Result<()> {
    static REGISTERED: OnceLock<Result<(), String>> = OnceLock::new();
    let result = REGISTERED.get_or_init(|| {
        let register = || -> Result<()> {
            ensure!(
                cfg!(any(target_os = "linux", target_os = "macos")),
                "Native SQLite inspection requires Linux or macOS"
            );
            // SQLite's immutable callback table and pAppData have process lifetime.
            // This private copy is published once, never made default or mutated
            // after registration, and retained until process exit as required.
            let base = unsafe { ffi::sqlite3_vfs_find(c"unix".as_ptr()) };
            ensure!(!base.is_null(), "SQLite Unix VFS unavailable");
            #[cfg(target_os = "macos")]
            calls::install(base)?;
            let mut vfs = Box::new(unsafe { std::ptr::read(base) });
            vfs.zName = c"shadowcode-confined-readonly".as_ptr();
            vfs.pNext = std::ptr::null_mut();
            vfs.xFullPathname = Some(full_path);
            vfs.xOpen = Some(open);
            vfs.xDelete = Some(delete);
            vfs.xAccess = Some(access);
            vfs.xDlOpen = None;
            vfs.xDlSym = None;
            vfs.xDlClose = None;
            vfs.xSetSystemCall = None;
            let code = unsafe { ffi::sqlite3_vfs_register(Box::leak(vfs), 0) };
            ensure!(
                code == ffi::SQLITE_OK,
                "Could not register read-only SQLite VFS ({code})"
            );
            Ok(())
        };
        register().map_err(|e| format!("{e:#}"))
    });
    result
        .as_ref()
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!(e.clone()))
        .context("Native SQLite initialization failed")
}

/// macOS: SQLite's Unix VFS opens and stats files by name through its
/// replaceable system-call table. Names under [`PREFIX`] for a registered
/// directory are answered with `openat`/`fstatat` on that directory, never
/// following a final link; every other name goes to SQLite's original call
/// unchanged. The table is process-wide, so the replacements are installed
/// once and only pass other names through.
#[cfg(target_os = "macos")]
mod calls {
    use super::{split, CStr};
    use anyhow::{ensure, Result};
    use rusqlite::ffi;
    use std::{
        ffi::{c_char, c_int},
        os::fd::RawFd,
        sync::{Mutex, OnceLock},
    };
    type Open = unsafe extern "C" fn(*const c_char, c_int, c_int) -> c_int;
    type Stat = unsafe extern "C" fn(*const c_char, *mut libc::stat) -> c_int;
    static OPEN: OnceLock<Open> = OnceLock::new();
    static STAT: OnceLock<Stat> = OnceLock::new();
    static LSTAT: OnceLock<Stat> = OnceLock::new();
    /// Directories currently held by an open inspection, one entry per hold.
    static HELD: Mutex<Vec<RawFd>> = Mutex::new(Vec::new());

    pub(super) fn hold(dir: RawFd) {
        HELD.lock().unwrap_or_else(|e| e.into_inner()).push(dir);
    }
    pub(super) fn release(dir: RawFd) {
        let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(index) = held.iter().position(|fd| *fd == dir) {
            held.swap_remove(index);
        }
    }
    /// The held directory and leaf for a confined name; `Err` for a confined
    /// name whose directory is not held; `Ok(None)` for any other name.
    fn confined<'a>(path: *const c_char) -> Result<Option<(RawFd, &'a CStr)>, ()> {
        if path.is_null() {
            return Ok(None);
        }
        // SQLite passes a NUL-terminated name that outlives the call.
        let name: &'a CStr = unsafe { CStr::from_ptr(path) };
        if !name.to_bytes().starts_with(super::PREFIX.as_bytes()) {
            return Ok(None);
        }
        let (fd, leaf) = split(name).ok_or(())?;
        let held = HELD.lock().unwrap_or_else(|e| e.into_inner());
        if held.contains(&fd) {
            Ok(Some((fd, leaf)))
        } else {
            Err(())
        }
    }
    fn refuse() -> c_int {
        unsafe { *libc::__error() = libc::ENOENT };
        -1
    }
    unsafe extern "C" fn open(path: *const c_char, flags: c_int, mode: c_int) -> c_int {
        match confined(path) {
            Ok(Some((fd, leaf))) => unsafe {
                libc::openat(
                    fd,
                    leaf.as_ptr(),
                    flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    mode as libc::c_uint,
                )
            },
            Ok(None) => unsafe { OPEN.get().expect("installed before use")(path, flags, mode) },
            Err(()) => refuse(),
        }
    }
    fn stat_with(original: &OnceLock<Stat>, path: *const c_char, out: *mut libc::stat) -> c_int {
        match confined(path) {
            Ok(Some((fd, leaf))) => unsafe {
                libc::fstatat(fd, leaf.as_ptr(), out, libc::AT_SYMLINK_NOFOLLOW)
            },
            Ok(None) => unsafe { original.get().expect("installed before use")(path, out) },
            Err(()) => refuse(),
        }
    }
    unsafe extern "C" fn stat(path: *const c_char, out: *mut libc::stat) -> c_int {
        stat_with(&STAT, path, out)
    }
    unsafe extern "C" fn lstat(path: *const c_char, out: *mut libc::stat) -> c_int {
        stat_with(&LSTAT, path, out)
    }
    pub(super) fn install(base: *mut ffi::sqlite3_vfs) -> Result<()> {
        // SAFETY: `base` is SQLite's registered Unix VFS. Each original call is
        // recorded before its replacement is installed, and the function
        // pointer types match SQLite's osOpen/osStat/osLstat declarations.
        unsafe {
            let get = (*base).xGetSystemCall.expect("Unix VFS system calls");
            let set = (*base).xSetSystemCall.expect("Unix VFS system calls");
            let (Some(o), Some(s), Some(l)) = (
                get(base, c"open".as_ptr()),
                get(base, c"stat".as_ptr()),
                get(base, c"lstat".as_ptr()),
            ) else {
                anyhow::bail!("SQLite Unix VFS lacks replaceable open/stat calls");
            };
            OPEN.get_or_init(|| std::mem::transmute::<unsafe extern "C" fn(), Open>(o));
            STAT.get_or_init(|| std::mem::transmute::<unsafe extern "C" fn(), Stat>(s));
            LSTAT.get_or_init(|| std::mem::transmute::<unsafe extern "C" fn(), Stat>(l));
            for (name, call) in [
                (
                    c"open",
                    std::mem::transmute::<Open, unsafe extern "C" fn()>(open as Open),
                ),
                (
                    c"stat",
                    std::mem::transmute::<Stat, unsafe extern "C" fn()>(stat as Stat),
                ),
                (
                    c"lstat",
                    std::mem::transmute::<Stat, unsafe extern "C" fn()>(lstat as Stat),
                ),
            ] {
                let code = set(base, name.as_ptr(), Some(call));
                ensure!(
                    code == ffi::SQLITE_OK,
                    "Could not route SQLite {name:?} through the held directory ({code})"
                );
            }
        }
        Ok(())
    }
}
