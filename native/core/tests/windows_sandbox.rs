//! The Windows sandbox (AppContainer) around agent shell commands: the
//! project is writable, the rest of the home folder is unreadable, nothing
//! is written outside the project and the scratch folder, and output and
//! exit codes pass through the launcher.
#![cfg(windows)]
use shadowcode_core::{
    config::ShellNetwork,
    sandbox::{self, ShellPolicy},
};
use std::{fs, path::Path, process::Command};

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

/// Which programs start in the container at all (a failed start is
/// 0xC0000142): every result is printed when one of them fails.
#[test]
fn system_programs_start_in_the_container() {
    std::env::set_var(
        "SHADOWCODE_SANDBOX_LAUNCHER",
        env!("CARGO_BIN_EXE_shadowcode-sandbox"),
    );
    let sid = sandbox::appcontainer::container_sid().unwrap();
    let system = std::env::var("SystemRoot").unwrap();
    let git = std::env::var("ProgramFiles").unwrap() + r"\Git";
    let programs: Vec<Vec<String>> = vec![
        vec![format!(r"{system}\System32\whoami.exe")],
        vec![
            format!(r"{system}\System32\cmd.exe"),
            "/c".into(),
            "echo cmd-ok".into(),
        ],
        vec![
            format!(r"{system}\System32\WindowsPowerShell\v1.0\powershell.exe"),
            "-NoProfile".into(),
            "-Command".into(),
            "echo powershell-ok".into(),
        ],
        vec![
            format!(r"{git}\usr\bin\bash.exe"),
            "-c".into(),
            "echo msys-ok".into(),
        ],
        vec![
            format!(r"{git}\bin\bash.exe"),
            "-c".into(),
            "echo gitbash-ok".into(),
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
            String::from_utf8_lossy(&output.stdout).trim(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    assert!(!failed, "{}", report.join("\n"));
}
