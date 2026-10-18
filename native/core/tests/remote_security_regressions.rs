#![cfg_attr(not(unix), allow(unused))]
// Regression tests for the remote-access defects found in the 2.0 audit.
// Real HTTP, temporary profiles, and fake secrets only.
use serde_json::{json, Value};
use shadowcode_core::{
    paths::AppPaths,
    remote::{assets, Manager},
    service::Service,
};
use std::sync::{Arc, Once};

struct Fixture {
    _dir: tempfile::TempDir,
    service: Service,
    manager: Arc<Manager>,
    base: String,
    workspace: std::path::PathBuf,
}

/// The web interface files every test server serves (one per test binary).
fn ui_files() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let dir = std::env::temp_dir().join(format!("shadowcode-remote-ui-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(
            dir.join("index.html"),
            "<!doctype html><title>ShadowCode</title>",
        )
        .unwrap();
        std::fs::write(dir.join("assets/app-abc.js"), "console.log('ui')").unwrap();
        std::fs::write(dir.join("manifest.webmanifest"), "{}").unwrap();
        // A file next to the UI folder that must never be served.
        std::fs::write(
            dir.parent()
                .unwrap()
                .join(format!("shadowcode-remote-secret-{}", std::process::id())),
            "private",
        )
        .unwrap();
        assets::set_bundled(Arc::new(assets::DirAssets::new(&dir).unwrap()));
    });
}

async fn fixture() -> Fixture {
    ui_files();
    let dir = tempfile::tempdir().unwrap();
    let paths = AppPaths::isolated(&dir.path().join("profile")).unwrap();
    let workspace = dir.path().join("project");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::write(workspace.join(".env"), "TOKEN=hidden").unwrap();
    std::fs::write(workspace.join("notes.txt"), "hello").unwrap();
    let service = Service::open(paths, Some(workspace.clone())).unwrap();
    let manager = service.remote().clone();
    let address = manager
        .start(&service, Some("127.0.0.1:0".parse().unwrap()))
        .unwrap();
    Fixture {
        base: format!("http://{address}"),
        _dir: dir,
        service,
        manager,
        workspace,
    }
}

impl Fixture {
    /// Pair a device the way the web interface does, returning its token.
    async fn pair(&self) -> String {
        let link = self.manager.pair(None).unwrap()["link"]
            .as_str()
            .unwrap()
            .to_owned();
        let code = link.split("#pair=").nth(1).unwrap().to_owned();
        let response = reqwest::Client::new()
            .post(format!("{}/_remote/pair", self.base))
            .json(&json!({"code": code, "name": "Test phone"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["device"]["name"], "Test phone");
        body["token"].as_str().unwrap().to_owned()
    }
    async fn api(
        &self,
        token: &str,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> (u16, Value) {
        let client = reqwest::Client::new();
        let mut request = client
            .request(method.parse().unwrap(), format!("{}{path}", self.base))
            .bearer_auth(token)
            .header("x-shadow-view", "test-view-0001");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.unwrap();
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }
}

#[tokio::test]
async fn remote_cannot_open_a_private_profile_ancestor_or_inherit_one() {
    let f = fixture().await;
    let token = f.pair().await;
    let parent = f._dir.path().to_path_buf();
    let settings_file = f.service.engine.paths().config.join("remote.json");
    let before = std::fs::read(&settings_file).unwrap();
    let (status, body) = f
        .api(
            &token,
            "POST",
            "/api/projects/trust",
            Some(json!({"path":parent})),
        )
        .await;
    assert_eq!(status, 403, "{body}");
    // A desktop may still open home. Its inherited selection must not let
    // the remote editor reach the private profile through a fresh view.
    let local = f
        .service
        .dispatch(shadowcode_core::service::Request {
            method: "POST".into(),
            path: "/api/projects/trust".into(),
            body: json!({"path":parent}),
        })
        .await
        .unwrap();
    let relative = settings_file
        .strip_prefix(&parent)
        .unwrap()
        .to_string_lossy();
    let (status, body) = f
        .api(
            &token,
            "GET",
            &format!("/api/workspace/file?path={relative}&head=true"),
            None,
        )
        .await;
    assert_ne!(status, 200, "{body}");
    let sid = local["session_id"].as_str().unwrap();
    let (status, body) = f
        .api(
            &token,
            "POST",
            &format!("/api/sessions/{sid}/activate"),
            Some(json!({})),
        )
        .await;
    assert_ne!(status, 200, "{body}");
    let (status, body) = f
        .api(
            &token,
            "POST",
            "/api/run",
            Some(json!({"session_id":sid,"prompt":"Read remote.json"})),
        )
        .await;
    assert_ne!(status, 200, "{body}");
    let goal = f
        .service
        .engine
        .store()
        .create_goal(
            &parent,
            "Private desktop goal",
            &shadowcode_core::store::MilestoneSpec::default_plan(),
        )
        .unwrap();
    let gid = goal["id"].as_str().unwrap();
    let (status, body) = f
        .api(
            &token,
            "POST",
            &format!("/api/goals/{gid}/run"),
            Some(json!({})),
        )
        .await;
    assert_ne!(status, 200, "{body}");
    assert_ne!(f.service.engine.store().goal(gid).unwrap()["running"], true);
    assert_eq!(std::fs::read(settings_file).unwrap(), before);
    f.manager.stop();
}

#[cfg(unix)]
#[tokio::test]
async fn remote_quoted_git_paths_hide_secret_file_contents() {
    let f = fixture().await;
    let token = f.pair().await;
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(&f.workspace)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init", "-q"]);
    git(&["config", "user.name", "Audit"]);
    git(&["config", "user.email", "audit@example.invalid"]);
    let folder = f.workspace.join("folder\tname");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join(".env"), "PASSWORD=old-fixture\n").unwrap();
    git(&["add", "--", "folder\tname/.env"]);
    git(&[
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "Fixture",
    ]);
    std::fs::write(folder.join(".env"), "PASSWORD=new-fixture\n").unwrap();
    let (status, body) = f
        .api(
            &token,
            "POST",
            "/api/projects/trust",
            Some(json!({"path":f.workspace})),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let (status, diff) = f.api(&token, "GET", "/api/workspace/diff", None).await;
    assert_eq!(status, 200, "{diff}");
    assert!(!diff.to_string().contains("PASSWORD=new-fixture"), "{diff}");
    f.manager.stop();
}

#[tokio::test]
async fn remote_aggregate_hunks_hide_secret_file_contents() {
    let f = fixture().await;
    let token = f.pair().await;
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .current_dir(&f.workspace)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init", "-q"]);
    git(&["config", "user.name", "Audit"]);
    git(&["config", "user.email", "audit@example.invalid"]);
    std::fs::write(f.workspace.join(".env"), "PASSWORD=old-fixture\n").unwrap();
    git(&["add", "--", ".env"]);
    git(&[
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "Fixture",
    ]);
    std::fs::write(f.workspace.join(".env"), "PASSWORD=new-fixture\n").unwrap();
    let (status, diff) = f.api(&token, "GET", "/api/workspace/diff", None).await;
    assert_eq!(status, 200, "{diff}");
    assert!(
        !diff["diff"]
            .as_str()
            .unwrap()
            .contains("PASSWORD=new-fixture"),
        "Raw diff was expected to be hidden: {diff}"
    );
    assert!(!diff.to_string().contains("PASSWORD=new-fixture"), "{diff}");
    // The cached diff suffers the same problem.
    git(&["add", "--", ".env"]);
    let (status, staged) = f.api(&token, "GET", "/api/workspace/diff", None).await;
    assert_eq!(status, 200, "{staged}");
    assert!(
        !staged.to_string().contains("PASSWORD=new-fixture"),
        "{staged}"
    );
    f.manager.stop();
}
