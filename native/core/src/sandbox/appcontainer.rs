//! The Windows shell sandbox: agent commands run in an AppContainer.
//!
//! An AppContainer process reads Windows' own folders and Program Files
//! (granted to all application packages), and nothing else of the user's
//! unless its SID is granted access. ShadowCode grants its container SID:
//!
//! * the project: read, write and delete (inherited by everything in it);
//! * a fresh scratch folder per command: the same (also HOME, TEMP and TMP);
//! * the toolchain folders of the home layout, the user's own PATH folders
//!   and the shell's folder when it is not under Program Files: read and run.
//!
//! The rest of the home folder (credentials, browser data, other projects)
//! stays unreadable. Without capabilities the container has no network at
//! all, loopback included; "on" grants the internet and private-network
//! capabilities. Loopback stays closed even then (opening it needs an
//! administrator), so the allow-list proxy cannot be reached and the
//! allow-list is refused rather than weakened.
//!
//! Grants are access entries on those folders for ShadowCode's container SID
//! only; they are added once (a project's first sandboxed command) and give
//! nothing to other programs. Creating a process in a container needs a
//! process attribute Rust's standard library cannot set yet, so the command
//! starts through a launcher: ShadowCode's own executable run with
//! [`LAUNCH_FLAG`] (see [`launch_main`]), the counterpart of `bwrap`.
use super::{
    create_scratch, network_label, scratch_base, HomeLayout, PreparedShell, ShellNetwork,
    ShellPolicy,
};
use anyhow::{bail, ensure, Context, Result};
use serde_json::json;
use std::{
    ffi::{c_void, OsStr, OsString},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSidToSidW, GetNamedSecurityInfoW,
            SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS,
            NO_MULTIPLE_TRUSTEE, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
        },
        EqualSid, FreeSid, GetAce,
        Isolation::{CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName},
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION,
        INHERIT_ONLY_ACE, OBJECT_INHERIT_ACE, PSID, SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES,
        SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    },
    Storage::FileSystem::{
        DELETE, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    },
    System::{
        Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
        Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
            InitializeProcThreadAttributeList, UpdateProcThreadAttribute, WaitForSingleObject,
            CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
            PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    },
};

/// The first argument that makes ShadowCode's executable the launcher.
pub const LAUNCH_FLAG: &str = "--shadowcode-sandbox";
/// ShadowCode's one AppContainer profile.
const PROFILE: &str = "ShadowCode.Sandbox";
/// internetClient, internetClientServer, privateNetworkClientServer.
const NETWORK_CAPABILITIES: [&str; 3] = ["S-1-15-3-1", "S-1-15-3-2", "S-1-15-3-3"];
const READ: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
const MODIFY: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE | FILE_DELETE_CHILD;
/// HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS).
const ALREADY_EXISTS: i32 = 0x800700B7_u32 as i32;

fn wide(text: &OsStr) -> Vec<u16> {
    text.encode_wide().chain(Some(0)).collect()
}

/// The container's SID as text (`S-1-15-2-…`), created on first use.
pub fn container_sid() -> Result<String> {
    static SID: OnceLock<std::result::Result<String, String>> = OnceLock::new();
    SID.get_or_init(|| create_profile().map_err(|e| format!("{e:#}")))
        .clone()
        .map_err(anyhow::Error::msg)
}

fn create_profile() -> Result<String> {
    let name = wide(OsStr::new(PROFILE));
    let display = wide(OsStr::new("ShadowCode sandbox"));
    let description = wide(OsStr::new("Agent shell commands run by ShadowCode"));
    let mut sid: PSID = std::ptr::null_mut();
    // SAFETY: NUL-terminated strings; the SID is freed with FreeSid below.
    let mut result = unsafe {
        CreateAppContainerProfile(
            name.as_ptr(),
            display.as_ptr(),
            description.as_ptr(),
            std::ptr::null(),
            0,
            &mut sid,
        )
    };
    if result == ALREADY_EXISTS {
        // SAFETY: as above.
        result = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
    }
    ensure!(
        result >= 0 && !sid.is_null(),
        "Could not create the Windows sandbox profile ({result:#x})"
    );
    let text = sid_text(sid);
    // SAFETY: allocated by the profile call above.
    unsafe { FreeSid(sid) };
    text
}

fn sid_text(sid: PSID) -> Result<String> {
    let mut text: *mut u16 = std::ptr::null_mut();
    // SAFETY: a valid SID; the string is freed with LocalFree.
    unsafe {
        ensure!(
            ConvertSidToStringSidW(sid, &mut text) != 0,
            "Could not name the sandbox: {}",
            std::io::Error::last_os_error()
        );
        let len = (0..).take_while(|&i| *text.add(i) != 0).count();
        let value = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
        LocalFree(text.cast());
        Ok(value)
    }
}

/// A SID parsed from text, freed when dropped.
struct Sid(PSID);
impl Sid {
    fn parse(text: &str) -> Result<Self> {
        let text = wide(OsStr::new(text));
        let mut sid: PSID = std::ptr::null_mut();
        // SAFETY: NUL-terminated; the SID is freed in Drop.
        ensure!(
            unsafe { ConvertStringSidToSidW(text.as_ptr(), &mut sid) } != 0,
            "Invalid SID: {}",
            std::io::Error::last_os_error()
        );
        Ok(Self(sid))
    }
}
impl Drop for Sid {
    fn drop(&mut self) {
        // SAFETY: allocated by ConvertStringSidToSidW.
        unsafe { LocalFree(self.0) };
    }
}

/// Whether `path` already allows `sid` at least `mask`, for the folder and
/// (with `inherit`) everything created in it.
fn has_grant(path: &[u16], sid: &Sid, mask: u32, inherit: bool) -> bool {
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor: *mut c_void = std::ptr::null_mut();
    // SAFETY: reads the DACL; the descriptor is freed with LocalFree.
    let status = unsafe {
        GetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 || dacl.is_null() {
        return false;
    }
    let wanted = if inherit {
        OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
    } else {
        0
    };
    // SAFETY: the DACL lives in `descriptor`; each ACE is read in bounds.
    let found = unsafe {
        (0..u32::from((*dacl).AceCount)).any(|index| {
            let mut ace: *mut c_void = std::ptr::null_mut();
            if GetAce(dacl, index, &mut ace) == 0 {
                return false;
            }
            let header = &*(ace as *const ACE_HEADER);
            if u32::from(header.AceType) != 0
                || u32::from(header.AceFlags) & INHERIT_ONLY_ACE != 0
                || u32::from(header.AceFlags) & wanted != wanted
            {
                return false;
            }
            let allowed = &*(ace as *const ACCESS_ALLOWED_ACE);
            allowed.Mask & mask == mask
                && EqualSid(std::ptr::addr_of!(allowed.SidStart) as PSID, sid.0) != 0
        })
    };
    // SAFETY: allocated by GetNamedSecurityInfoW.
    unsafe { LocalFree(descriptor) };
    found
}

/// Allow the container `mask` on `path` (and, with `inherit`, on everything
/// in it), unless it already has that.
fn grant(path: &Path, sid: &Sid, mask: u32, inherit: bool) -> Result<()> {
    // Grants already made this run need no check of a large folder's DACL.
    static DONE: OnceLock<Mutex<std::collections::HashSet<(PathBuf, u32)>>> = OnceLock::new();
    let done = DONE.get_or_init(Default::default);
    let key = (path.to_path_buf(), mask);
    if done.lock().is_ok_and(|d| d.contains(&key)) {
        return Ok(());
    }
    let name = wide(path.as_os_str());
    if !has_grant(&name, sid, mask, inherit) {
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor: *mut c_void = std::ptr::null_mut();
        // SAFETY: as in has_grant.
        let status = unsafe {
            GetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut descriptor,
            )
        };
        ensure!(
            status == 0,
            "Cannot read the permissions of {} ({status})",
            path.display()
        );
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: mask,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: if inherit {
                SUB_CONTAINERS_AND_OBJECTS_INHERIT
            } else {
                0
            },
            Trustee: TRUSTEE_W {
                pMultipleTrustee: std::ptr::null_mut(),
                MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: sid.0.cast(),
            },
        };
        let mut merged: *mut ACL = std::ptr::null_mut();
        // SAFETY: one entry merged into the existing DACL; the result and
        // the descriptor are freed with LocalFree.
        let status = unsafe {
            let status = SetEntriesInAclW(1, &entry, dacl, &mut merged);
            let applied = if status == 0 {
                // Inheritable entries reach what is already in the folder.
                SetNamedSecurityInfoW(
                    name.as_ptr(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    merged,
                    std::ptr::null(),
                )
            } else {
                status
            };
            if !merged.is_null() {
                LocalFree(merged.cast());
            }
            LocalFree(descriptor);
            applied
        };
        ensure!(
            status == 0,
            "Cannot give the sandbox access to {} ({status})",
            path.display()
        );
    }
    if let Ok(mut done) = done.lock() {
        done.insert(key);
    }
    Ok(())
}

/// Folders every AppContainer may already read.
fn system_readable(path: &Path) -> bool {
    [
        "SystemRoot",
        "ProgramFiles",
        "ProgramW6432",
        "ProgramFiles(x86)",
    ]
    .iter()
    .filter_map(std::env::var_os)
    .any(|root| path.starts_with(PathBuf::from(root)))
}

/// The launcher: `SHADOWCODE_SANDBOX_LAUNCHER`, else ShadowCode's own
/// executable. Anything else (a test binary) cannot launch, so the sandbox
/// is unavailable there.
fn launcher() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("SHADOWCODE_SANDBOX_LAUNCHER") {
        return Ok(PathBuf::from(path));
    }
    let exe = std::env::current_exe()?;
    ensure!(
        exe.file_stem()
            .is_some_and(|stem| stem.eq_ignore_ascii_case("shadowcode")),
        "the sandbox launcher is ShadowCode's own program, which is not running"
    );
    Ok(exe)
}

/// The command in ShadowCode's AppContainer.
pub(super) fn prepare(
    workspace: &Path,
    cwd: &Path,
    command: &str,
    policy: &ShellPolicy,
    layout: &HomeLayout,
) -> Result<PreparedShell> {
    let program = launcher()?;
    let sid_text = container_sid()?;
    let sid = Sid::parse(&sid_text)?;
    grant(workspace, &sid, MODIFY, true)?;
    let scratch = create_scratch(&scratch_base())?;
    grant(&scratch.path, &sid, MODIFY, true)?;
    let home = scratch.path.join("home");
    let temp = scratch.path.join("tmp");
    std::fs::create_dir_all(&home)?;
    std::fs::create_dir_all(&temp)?;
    let (shell, shell_args) = sandbox_shell(cwd, command)?;
    // Read-only: the toolchains the home layout shows, the user's own PATH
    // folders and the shell's folder, unless Windows already allows them.
    // Best effort: a folder ShadowCode may not change is skipped.
    let mut readable: Vec<PathBuf> = layout
        .binds
        .iter()
        .map(|(source, _)| source.clone())
        .collect();
    if let Some(home_dir) = &layout.home {
        if let Some(path) = std::env::var_os("PATH") {
            readable.extend(
                std::env::split_paths(&path)
                    .filter(|dir| dir.starts_with(home_dir) && dir != home_dir && dir.is_dir()),
            );
        }
    }
    if let Some(root) = Path::new(&shell).parent() {
        readable.push(root.to_owned());
    }
    let mut skipped = Vec::new();
    for dir in readable {
        if system_readable(&dir) || dir.starts_with(workspace) {
            continue;
        }
        if let Err(error) = grant(&dir, &sid, READ, true) {
            skipped.push(format!("{}: {error:#}", dir.display()));
        }
    }
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut args = vec![
        LAUNCH_FLAG.to_owned(),
        "--sid".into(),
        sid_text,
        "--network".into(),
        network_label(policy.network).into(),
    ];
    for (name, value) in [
        ("HOME", s(&home)),
        ("TEMP", s(&temp)),
        ("TMP", s(&temp)),
        ("SHADOWCODE_SCRATCH", s(&scratch.path)),
    ] {
        args.push("--env".into());
        args.push(format!("{name}={value}"));
    }
    args.push("--".into());
    args.push(shell);
    args.extend(shell_args);
    Ok(PreparedShell {
        program: s(&program),
        args,
        child: None,
        scratch: Some(scratch.path.clone()),
        gate: None,
        note: json!({
            "mode": "appcontainer",
            "network": network_label(policy.network),
            "network_requested": network_label(policy.network),
            "network_enforcement": match policy.network {
                ShellNetwork::Off => "no_network",
                _ => "none",
            },
            "shell": "PowerShell 7 (pwsh)",
            "home": "empty temporary folder",
            "home_read_only": layout.binds.iter().map(|(s, _)| s.to_string_lossy()).collect::<Vec<_>>(),
            "home_skipped": layout.skipped,
            "read_grants_skipped": skipped,
            "scratch": scratch.path.to_string_lossy(),
            "workspace_cow": false,
            "note": "Windows sandbox (AppContainer), commands run in PowerShell 7: Windows and Program Files read-only, the home folder hidden except read-only toolchains and PATH folders, writable project, ephemeral scratch at SHADOWCODE_SCRATCH (also HOME, TEMP and TMP); network off unless on, and never to this computer's own services. Not a complete OS sandbox."
        }),
        warning: None,
    })
}

/// The shell inside the container. Git for Windows' bash (MSYS2) cannot start
/// in an AppContainer (its runtime fails to initialize, 0xC0000142) and
/// Windows PowerShell cannot load its own modules there; PowerShell 7 runs.
fn sandbox_shell(cwd: &Path, command: &str) -> Result<(String, Vec<String>)> {
    let pwsh = crate::sandbox::which("pwsh").or_else(|| {
        ["ProgramW6432", "ProgramFiles"]
            .iter()
            .filter_map(std::env::var_os)
            .map(|base| PathBuf::from(base).join(r"PowerShell\7\pwsh.exe"))
            .find(|path| path.is_file())
    });
    let pwsh = pwsh.context(
        "commands in the Windows sandbox run in PowerShell 7, which is not installed (winget install Microsoft.PowerShell)",
    )?;
    Ok((
        pwsh.to_string_lossy().into_owned(),
        vec![
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-Command".into(),
            // PowerShell cannot confirm an inherited folder whose parents the
            // container may not read, and would start at the drive root.
            format!(
                "Set-Location -LiteralPath '{}'\n{command}",
                cwd.to_string_lossy().replace('\'', "''")
            ),
        ],
    ))
}

/// One argument as the Windows C runtime (and MSYS) parse a command line:
/// the rules Rust's standard library uses.
fn quote(arg: &OsStr, out: &mut Vec<u16>) {
    let text: Vec<u16> = arg.encode_wide().collect();
    let needs = text.is_empty()
        || text
            .iter()
            .any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == b'"' as u16);
    if !needs {
        out.extend(text);
        return;
    }
    out.push(b'"' as u16);
    let mut backslashes = 0;
    for c in text {
        if c == b'\\' as u16 {
            backslashes += 1;
        } else {
            if c == b'"' as u16 {
                out.extend(std::iter::repeat_n(b'\\' as u16, backslashes + 1));
            }
            backslashes = 0;
        }
        out.push(c);
    }
    out.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
    out.push(b'"' as u16);
}

/// Let the container use this process's window station and desktop when they
/// are not the interactive ones (a service or a CI runner). Every program
/// loads user32, which fails to start (0xC0000142) without them; on the
/// interactive desktop containers already have that access, and nothing is
/// changed there.
fn allow_window_station(container: &Sid) -> Result<()> {
    use windows_sys::Win32::{
        Security::Authorization::{GetSecurityInfo, SetSecurityInfo, SE_WINDOW_OBJECT},
        System::{
            StationsAndDesktops::{
                GetProcessWindowStation, GetThreadDesktop, GetUserObjectInformationW, UOI_NAME,
            },
            Threading::GetCurrentThreadId,
        },
    };
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const GENERIC_EXECUTE: u32 = 0x2000_0000;
    // SAFETY: handles owned by the system for this process; not closed.
    let (station, desktop) = unsafe {
        (
            GetProcessWindowStation(),
            GetThreadDesktop(GetCurrentThreadId()),
        )
    };
    ensure!(
        !station.is_null() && !desktop.is_null(),
        "No window station"
    );
    let mut name = [0u16; 256];
    let mut needed = 0u32;
    // SAFETY: the buffer's size is passed in bytes.
    let named = unsafe {
        GetUserObjectInformationW(
            station,
            UOI_NAME,
            name.as_mut_ptr().cast(),
            std::mem::size_of_val(&name) as u32,
            &mut needed,
        )
    } != 0;
    let length = name.iter().position(|&c| c == 0).unwrap_or(0);
    if named && String::from_utf16_lossy(&name[..length]).eq_ignore_ascii_case("WinSta0") {
        return Ok(());
    }
    for handle in [station, desktop] {
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor: *mut c_void = std::ptr::null_mut();
        // SAFETY: as in grant(), on a window object's handle.
        let status = unsafe {
            let status = GetSecurityInfo(
                handle,
                SE_WINDOW_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut descriptor,
            );
            if status != 0 {
                status
            } else {
                let entry = EXPLICIT_ACCESS_W {
                    grfAccessPermissions: GENERIC_READ | GENERIC_WRITE | GENERIC_EXECUTE,
                    grfAccessMode: GRANT_ACCESS,
                    grfInheritance: 0,
                    Trustee: TRUSTEE_W {
                        pMultipleTrustee: std::ptr::null_mut(),
                        MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                        TrusteeForm: TRUSTEE_IS_SID,
                        TrusteeType: TRUSTEE_IS_UNKNOWN,
                        ptstrName: container.0.cast(),
                    },
                };
                let mut merged: *mut ACL = std::ptr::null_mut();
                let mut status = SetEntriesInAclW(1, &entry, dacl, &mut merged);
                if status == 0 {
                    status = SetSecurityInfo(
                        handle,
                        SE_WINDOW_OBJECT,
                        DACL_SECURITY_INFORMATION,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        merged,
                        std::ptr::null(),
                    );
                }
                if !merged.is_null() {
                    LocalFree(merged.cast());
                }
                LocalFree(descriptor);
                status
            }
        };
        ensure!(
            status == 0,
            "Cannot open the window station to the sandbox ({status})"
        );
    }
    Ok(())
}

/// Entry point of the launcher: `--sid S --network off|on [--env K=V]… --
/// program args…`. Starts the program in the container with this process's
/// standard handles, waits, and returns its exit code (125: not started).
pub fn launch_main(args: Vec<OsString>) -> i32 {
    match launch(args) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("ShadowCode sandbox: {error:#}");
            125
        }
    }
}

fn launch(args: Vec<OsString>) -> Result<i32> {
    let mut args = args.into_iter();
    let mut sid = None;
    let mut network = false;
    let mut env: Vec<(OsString, OsString)> = Vec::new();
    let mut command: Vec<OsString> = Vec::new();
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--sid") => sid = args.next().and_then(|v| v.into_string().ok()),
            Some("--network") => network = args.next().is_some_and(|v| v == "on"),
            Some("--env") => {
                let pair = args.next().context("--env needs NAME=VALUE")?;
                let pair = pair.to_string_lossy().into_owned();
                let (name, value) = pair.split_once('=').context("--env needs NAME=VALUE")?;
                env.push((name.into(), value.into()));
            }
            Some("--") => {
                command.extend(args.by_ref());
                break;
            }
            _ => bail!("Unknown launcher argument: {}", arg.to_string_lossy()),
        }
    }
    ensure!(!command.is_empty(), "No command to run");
    let container = Sid::parse(&sid.context("--sid is required")?)?;
    allow_window_station(&container)?;
    let capabilities: Vec<Sid> = if network {
        NETWORK_CAPABILITIES
            .iter()
            .map(|text| Sid::parse(text))
            .collect::<Result<_>>()?
    } else {
        Vec::new()
    };
    let mut entries: Vec<SID_AND_ATTRIBUTES> = capabilities
        .iter()
        .map(|sid| SID_AND_ATTRIBUTES {
            Sid: sid.0,
            Attributes: 4, // SE_GROUP_ENABLED
        })
        .collect();
    let security = SECURITY_CAPABILITIES {
        AppContainerSid: container.0,
        Capabilities: if entries.is_empty() {
            std::ptr::null_mut()
        } else {
            entries.as_mut_ptr()
        },
        CapabilityCount: entries.len() as u32,
        Reserved: 0,
    };
    // This process's standard handles become the program's, and only they
    // are inherited.
    // SAFETY: GetStdHandle has no preconditions; SetHandleInformation only
    // marks these handles inheritable.
    let standard: Vec<HANDLE> = unsafe {
        [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE]
            .iter()
            .map(|&which| GetStdHandle(which))
            .collect()
    };
    let mut inherit: Vec<HANDLE> = Vec::new();
    for &handle in &standard {
        if !handle.is_null() && handle as isize != -1 && !inherit.contains(&handle) {
            // SAFETY: a live handle of this process.
            unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
            inherit.push(handle);
        }
    }
    let attribute_count = if inherit.is_empty() { 1 } else { 2 };
    let mut size = 0usize;
    // SAFETY: a size query.
    unsafe {
        InitializeProcThreadAttributeList(std::ptr::null_mut(), attribute_count, 0, &mut size)
    };
    let mut list = vec![0u64; size.div_ceil(8)];
    let attributes = list.as_mut_ptr().cast::<c_void>();
    // SAFETY: the buffer has the queried size; the values outlive the call
    // to CreateProcessW below.
    let ready = unsafe {
        InitializeProcThreadAttributeList(attributes, attribute_count, 0, &mut size) != 0
            && UpdateProcThreadAttribute(
                attributes,
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                (&security as *const SECURITY_CAPABILITIES).cast(),
                std::mem::size_of::<SECURITY_CAPABILITIES>(),
                std::ptr::null_mut(),
                std::ptr::null(),
            ) != 0
            && (inherit.is_empty()
                || UpdateProcThreadAttribute(
                    attributes,
                    0,
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                    inherit.as_ptr().cast(),
                    std::mem::size_of_val(inherit.as_slice()),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                ) != 0)
    };
    ensure!(
        ready,
        "Could not prepare the sandboxed process: {}",
        std::io::Error::last_os_error()
    );
    let mut line: Vec<u16> = Vec::new();
    for (index, arg) in command.iter().enumerate() {
        if index > 0 {
            line.push(b' ' as u16);
        }
        quote(arg, &mut line);
    }
    line.push(0);
    let mut vars: Vec<(OsString, OsString)> = std::env::vars_os()
        .filter(|(name, _)| {
            !env.iter().any(|(set, _)| {
                set.to_string_lossy()
                    .eq_ignore_ascii_case(&name.to_string_lossy())
            })
        })
        .collect();
    vars.extend(env);
    vars.sort_by_key(|(name, _)| name.to_string_lossy().to_ascii_uppercase());
    let mut block: Vec<u16> = Vec::new();
    for (name, value) in vars {
        block.extend(name.encode_wide());
        block.push(b'=' as u16);
        block.extend(value.encode_wide());
        block.push(0);
    }
    block.push(0);
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = standard[0];
    startup.StartupInfo.hStdOutput = standard[1];
    startup.StartupInfo.hStdError = standard[2];
    startup.lpAttributeList = attributes;
    let mut process = PROCESS_INFORMATION::default();
    // SAFETY: every buffer is NUL-terminated and outlives the call; the
    // working folder is this process's own.
    let created = unsafe {
        CreateProcessW(
            std::ptr::null(),
            line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
            block.as_ptr().cast(),
            std::ptr::null(),
            &startup.StartupInfo,
            &mut process,
        )
    };
    let error = std::io::Error::last_os_error();
    // SAFETY: initialized above.
    unsafe { DeleteProcThreadAttributeList(attributes) };
    ensure!(
        created != 0,
        "Could not start {} in the sandbox: {error}",
        command[0].to_string_lossy()
    );
    let mut code = 0u32;
    // SAFETY: handles from CreateProcessW, closed once.
    unsafe {
        CloseHandle(process.hThread);
        WaitForSingleObject(process.hProcess, INFINITE);
        GetExitCodeProcess(process.hProcess, &mut code);
        CloseHandle(process.hProcess);
    }
    drop(capabilities);
    Ok(code as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quoted(args: &[&str]) -> String {
        let mut line = Vec::new();
        for (i, arg) in args.iter().enumerate() {
            if i > 0 {
                line.push(b' ' as u16);
            }
            quote(OsStr::new(arg), &mut line);
        }
        String::from_utf16(&line).unwrap()
    }

    #[test]
    fn arguments_are_quoted_as_the_c_runtime_reads_them() {
        assert_eq!(quoted(&["bash", "-c", "echo hi"]), r#"bash -c "echo hi""#);
        assert_eq!(quoted(&["a\"b"]), r#""a\"b""#);
        assert_eq!(quoted(&[r"C:\dir\"]), r"C:\dir\");
        assert_eq!(quoted(&[r"C:\my dir\"]), r#""C:\my dir\\""#);
        assert_eq!(quoted(&[""]), r#""""#);
    }
}
