//! The Windows sandbox (AppContainer) around agent shell commands: the
//! project is writable, the rest of the home folder is unreadable, nothing
//! is written outside the project and the scratch folder, and output and
//! exit codes pass through the launcher.
#![cfg(windows)]
use shadowcode_core::{
    config::ShellNetwork,
    sandbox::{self, ShellPolicy},
};
use std::{fs, path::Path, process::Command, sync::Mutex};

/// One test at a time: a grant rewrites folder permissions, which must not
/// change under a command another test is running in the container.
static SERIAL: Mutex<()> = Mutex::new(());

fn policy(require: bool) -> ShellPolicy {
    ShellPolicy {
        network: ShellNetwork::Off,
        allow: Vec::new(),
        allow_text: Vec::new(),
        home_binds: Vec::new(),
        require,
        landlock: false,
    }
}

fn run(workspace: &Path, command: &str) -> (i32, String) {
    std::env::set_var(
        "SHADOWCODE_SANDBOX_LAUNCHER",
        env!("CARGO_BIN_EXE_shadowcode-sandbox"),
    );
    let prepared = sandbox::prepare_shell(workspace, workspace, command, &policy(true)).unwrap();
    assert_eq!(prepared.note["mode"], "appcontainer", "{}", prepared.note);
    let output = Command::new(&prepared.program)
        .args(&prepared.args)
        .current_dir(workspace)
        .output()
        .unwrap();
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    (output.status.code().unwrap_or(-1), text)
}

#[test]
fn commands_write_the_project_but_cannot_read_the_home_folder_or_write_outside() {
    let _serial = SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let home = shadowcode_core::paths::home_dir().unwrap();
    // A secret in the home folder, outside the project.
    let secret_dir = tempfile::Builder::new()
        .prefix("shadowcode-sandbox-secret-")
        .tempdir_in(&home)
        .unwrap();
    let secret = secret_dir.path().join("secret.txt");
    fs::write(&secret, "do-not-read").unwrap();
    let outside = secret_dir.path().join("written.txt");
    let root = tempfile::Builder::new()
        .prefix("shadowcode-sandbox-project-")
        .tempdir_in(&home)
        .unwrap();
    let workspace = root.path().canonicalize().unwrap();
    let workspace = dunce_path(&workspace);
    let slash = |p: &Path| shadowcode_core::paths::slash(p);

    let (code, text) = run(&workspace, "echo inside > made.txt; echo printed; exit 7");
    assert_eq!(code, 7, "{text}");
    assert!(text.contains("printed"), "{text}");
    assert!(workspace.join("made.txt").is_file(), "{text}");

    let (code, text) = run(&workspace, &format!("cat '{}'", slash(&secret)));
    assert_ne!(code, 0, "{text}");
    assert!(
        !text.contains("do-not-read"),
        "the sandbox read the home folder: {text}"
    );

    let (_, text) = run(&workspace, &format!("echo escaped > '{}'", slash(&outside)));
    assert!(
        !outside.exists(),
        "the sandbox wrote outside the project: {text}"
    );
}

fn dunce_path(path: &Path) -> std::path::PathBuf {
    let text = path.to_string_lossy();
    std::path::PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

#[test]
fn foreground_external_commands_keep_their_output_and_exit_code_in_a_job() {
    let _serial = SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::env::set_var(
        "SHADOWCODE_SANDBOX_LAUNCHER",
        env!("CARGO_BIN_EXE_shadowcode-sandbox"),
    );
    let root = tempfile::tempdir().unwrap();
    let workspace = dunce_path(&root.path().canonicalize().unwrap());
    let runtime = tokio::runtime::Runtime::new().unwrap();
    for code in [7, 0] {
        // No trailing shell builtin: exercise busybox's final-command exec
        // path under the same job cleanup used by the real agent.
        let command = format!("cmd.exe /c \"echo external-output & exit /b {code}\"");
        let prepared =
            sandbox::prepare_shell(&workspace, &workspace, &command, &policy(true)).unwrap();
        let result = runtime
            .block_on(shadowcode_core::process::run(
                shadowcode_core::process::ProcessSpec {
                    program: prepared.program,
                    args: prepared.args,
                    cwd: workspace.clone(),
                    timeout: std::time::Duration::from_secs(15),
                    output_limit: 4096,
                    env: Default::default(),
                    child: prepared.child,
                },
                tokio_util::sync::CancellationToken::new(),
                None,
            ))
            .unwrap();
        assert_eq!(result.exit_code, code, "{result:?}");
        assert_eq!(result.ok, code == 0, "{result:?}");
        assert!(result.stdout.contains("external-output"), "{result:?}");
        if let Some(scratch) = prepared.scratch {
            sandbox::discard_scratch(&scratch).unwrap();
        }
    }
}

/// Programs start in the container (a failed start is 0xC0000142): system
/// programs and busybox `sh`, the sandbox's shell. Git for Windows' bash
/// (MSYS2) cannot start in an AppContainer; it is not used inside it. The
/// container may not open the null device (cmd's `>nul` is refused), so
/// busybox's /dev/null is the handle the launcher opened for it.
#[test]
fn system_programs_and_busybox_start_in_the_container() {
    let _serial = SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::env::set_var(
        "SHADOWCODE_SANDBOX_LAUNCHER",
        env!("CARGO_BIN_EXE_shadowcode-sandbox"),
    );
    // The doctor's check: it also lets the container read busybox's folder.
    sandbox::appcontainer::probe().unwrap();
    let sid = sandbox::appcontainer::container_sid().unwrap();
    let system = std::env::var("SystemRoot").unwrap();
    let busybox = std::env::var("SHADOWCODE_BUSYBOX").expect("SHADOWCODE_BUSYBOX");
    let programs: Vec<Vec<String>> = vec![
        vec![format!(r"{system}\System32\whoami.exe")],
        vec![
            format!(r"{system}\System32\cmd.exe"),
            "/c".into(),
            "echo cmd-ok".into(),
        ],
        vec![
            busybox,
            "sh".into(),
            "-c".into(),
            "echo busybox-ok; echo hidden >/dev/null; ls / 2>/dev/null >/dev/null; \
             cat </dev/null; echo null-ok"
                .into(),
        ],
    ];
    let mut report = Vec::new();
    let mut failed = false;
    for program in programs {
        let output = Command::new(env!("CARGO_BIN_EXE_shadowcode-sandbox"))
            .args(["--sid", &sid, "--network", "off", "--"])
            .args(&program)
            .output()
            .unwrap();
        let code = output.status.code().unwrap_or(-1);
        failed |= code != 0;
        report.push(format!(
            "{code:#x} {}: {}{}",
            program[0],
            String::from_utf8_lossy(&output.stdout)
                .replace("\r\n", "\n")
                .trim(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let report = report.join("\n");
    assert!(!failed, "{report}");
    assert!(
        report.contains("busybox-ok\nnull-ok") && !report.contains("hidden"),
        "{report}"
    );
}
