//! The user's own OpenAI-compatible endpoints against a fake server (a small
//! Python server on loopback). It serves `/v1/models` and streaming
//! `/v1/chat/completions` with a canned tool call, checks the bearer key,
//! and records every request. Covers listing an endpoint's models, adding
//! them (the key saved privately), the picker row, a task on the native loop,
//! and removal.
use serde_json::{json, Value};
use shadowcode_core::{
    config::Config,
    paths::AppPaths,
    service::{Request, Service},
};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

const FAKE: &str = r#"#!/usr/bin/env python3
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = "sk-endpoint-good"

def log(value):
    with open(os.path.join(HERE, "requests.jsonl"), "a") as f:
        f.write(json.dumps(value) + "\n")

def sse(handler, chunks):
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.end_headers()
    for chunk in chunks:
        handler.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
    handler.wfile.write(b"data: [DONE]\n\n")

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    def log_message(self, *a):
        pass
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def auth(self):
        return self.headers.get("Authorization", "") == "Bearer " + KEY
    def do_GET(self):
        log({"method": "GET", "path": self.path, "auth": self.auth()})
        if not self.auth():
            return self.reply(401, {"error": {"message": "Incorrect API key provided"}})
        if self.path == "/v1/models":
            return self.reply(200, {"object": "list", "data": [
                {"id": "acme-coder", "object": "model"},
                {"id": "acme-chat", "object": "model"}]})
        self.reply(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        messages = body.get("messages", [])
        log({"method": "POST", "path": self.path, "auth": self.auth(), "model": body.get("model")})
        if not self.auth():
            return self.reply(401, {"error": {"message": "Incorrect API key provided"}})
        if self.path != "/v1/chat/completions":
            return self.reply(404, {})
        done = any(m.get("role") == "tool" for m in messages)
        if body.get("tools") and not done:
            return sse(self, [
                {"choices": [{"delta": {"role": "assistant", "content": None, "tool_calls": [
                    {"index": 0, "id": "call_1", "type": "function", "function": {
                        "name": "write_file",
                        "arguments": json.dumps({"path": "hello.txt", "content": "hi from my endpoint\n"})}}]},
                    "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "tool_calls"}],
                 "usage": {"prompt_tokens": 40, "completion_tokens": 9}}])
        return sse(self, [
            {"choices": [{"delta": {"role": "assistant", "content": "Wrote hello.txt."}, "finish_reason": None}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}],
             "usage": {"prompt_tokens": 55, "completion_tokens": 5}}])

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
"#;

struct Fake {
    child: Child,
    /// The address as a person would type it: no `/v1`.
    host: String,
    dir: tempfile::TempDir,
}
impl Drop for Fake {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Fake {
    fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("fake_endpoint.py");
        fs::write(&script, FAKE).unwrap();
        let mut child = Command::new("python3")
            .arg(&script)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let host = format!("http://127.0.0.1:{}", line.trim());
        Self { child, host, dir }
    }
    fn requests(&self) -> Vec<Value> {
        fs::read_to_string(self.dir.path().join("requests.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }
}

async fn call(service: &Service, method: &str, path: &str, body: Value) -> anyhow::Result<Value> {
    service
        .dispatch(Request {
            method: method.into(),
            path: path.into(),
            body,
        })
        .await
}

async fn wait_job(service: &Service, id: &str) -> Value {
    let started = Instant::now();
    loop {
        let job = call(service, "GET", &format!("/api/jobs/{id}"), Value::Null)
            .await
            .unwrap();
        if matches!(
            job["status"].as_str(),
            Some("completed" | "failed" | "cancelled")
        ) {
            return job;
        }
        assert!(started.elapsed() < Duration::from_secs(30), "{job}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn setup(root: &Path) -> (AppPaths, Service) {
    let project = root.join("project");
    fs::create_dir(&project).unwrap();
    let paths = AppPaths::isolated(&root.join("profile")).unwrap();
    Config::patch(
        &paths,
        json!({
            "trusted_workspaces": [project.clone()],
            "permissions": {"mode": "allow_edits"},
            // Never probe the vendor CLIs installed on the test machine.
            "cli_agents": {"enabled": false}
        }),
    )
    .unwrap();
    let service = Service::open(paths.clone(), Some(project)).unwrap();
    (paths, service)
}

fn endpoint_rows(picker: &Value) -> Vec<Value> {
    picker["targets"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["custom"] == true)
        .cloned()
        .collect()
}

#[tokio::test]
async fn an_endpoint_is_listed_added_used_and_removed() {
    // A name no developer machine sets, so the saved key is the one used.
    const KEY_NAME: &str = "SHADOWCODE_TEST_ENDPOINT_KEY";
    std::env::remove_var(KEY_NAME);
    let fake = Fake::start();
    let root = tempfile::tempdir().unwrap();
    let (paths, service) = setup(root.path());
    let project = root.path().join("project");

    // The wrong key: the server's refusal, and nothing is saved.
    let refused = call(
        &service,
        "POST",
        "/api/providers/models",
        json!({"provider":"openai_compatible","endpoint":fake.host,"api_key":"sk-wrong","api_key_env":KEY_NAME}),
    )
    .await;
    let error = format!("{:#}", refused.unwrap_err());
    assert!(
        error.contains("401") && error.contains("check the API key"),
        "{error}"
    );
    assert!(
        !error.contains("sk-wrong"),
        "the key is never echoed: {error}"
    );

    // The typed key lists the models; the address gains /v1.
    let listed = call(
        &service,
        "POST",
        "/api/providers/models",
        json!({"provider":"openai_compatible","endpoint":fake.host,"api_key":"sk-endpoint-good","api_key_env":KEY_NAME}),
    )
    .await
    .unwrap();
    let endpoint = format!("{}/v1", fake.host);
    assert_eq!(listed["endpoint"], endpoint);
    assert_eq!(listed["api_key_env"], KEY_NAME);
    assert_eq!(listed["key_saved"], false);
    assert_eq!(listed["local"], true);
    let names: Vec<&str> = listed["models"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["acme-coder", "acme-chat"]);
    assert!(
        fs::read_to_string(paths.secrets_file())
            .map(|s| !s.contains("sk-endpoint-good"))
            .unwrap_or(true),
        "listing saves nothing"
    );
    assert!(endpoint_rows(
        &call(&service, "GET", "/api/picker", Value::Null)
            .await
            .unwrap()
    )
    .is_empty());

    // Adding saves the key privately and registers the chosen model.
    let added = call(
        &service,
        "POST",
        "/api/models/endpoints",
        json!({"provider":"openai_compatible","endpoint":fake.host,"models":["acme-coder"," acme-coder "],
               "api_key":"sk-endpoint-good","api_key_env":KEY_NAME}),
    )
    .await
    .unwrap();
    let models = added["models"].as_array().unwrap();
    assert_eq!(models.len(), 1, "duplicates are added once: {added}");
    assert_eq!(models[0]["endpoint"], endpoint);
    assert_eq!(models[0]["api_key_env"], KEY_NAME);
    let id = models[0]["default"].as_str().unwrap().to_owned();
    assert!(id.starts_with("model:"), "{id}");
    assert!(!added.to_string().contains("sk-endpoint-good"));
    assert!(fs::read_to_string(paths.secrets_file())
        .unwrap()
        .contains(KEY_NAME));

    // Listing again uses the saved key on this computer's window.
    let again = call(
        &service,
        "POST",
        "/api/providers/models",
        json!({"provider":"openai_compatible","endpoint":fake.host,"api_key_env":KEY_NAME}),
    )
    .await
    .unwrap();
    assert_eq!(again["key_saved"], true);
    assert_eq!(again["models"].as_array().unwrap().len(), 2);

    // The picker lists it with the models on this computer.
    let rows = endpoint_rows(
        &call(&service, "GET", "/api/picker", Value::Null)
            .await
            .unwrap(),
    );
    assert_eq!(rows.len(), 1, "{rows:?}");
    let row = &rows[0];
    assert_eq!(row["id"], id.as_str());
    assert_eq!(row["group"], "local");
    assert_eq!(row["inference"], "local");
    assert_eq!(row["availability"], "ready");
    assert_eq!(row["name"], "acme-coder · This computer");
    assert!(row["subtitle"]
        .as_str()
        .unwrap()
        .starts_with("OpenAI-compatible · 127.0.0.1:"));
    // A cached (snapshot) read lists it too.
    let cached = call(&service, "GET", "/api/picker?cached=1", Value::Null)
        .await
        .unwrap();
    assert_eq!(endpoint_rows(&cached).len(), 1);

    // A task runs on ShadowCode's own loop with the saved key.
    let job = call(
        &service,
        "POST",
        "/api/jobs",
        json!({"task":"Create hello.txt","model":id}),
    )
    .await
    .unwrap();
    let done = wait_job(&service, job["id"].as_str().unwrap()).await;
    assert_eq!(done["status"], "completed", "{done}");
    assert_eq!(
        fs::read_to_string(project.join("hello.txt")).unwrap(),
        "hi from my endpoint\n"
    );
    let chats: Vec<Value> = fake
        .requests()
        .into_iter()
        .filter(|r| r["path"] == "/v1/chat/completions")
        .collect();
    assert_eq!(chats.len(), 2, "{chats:?}");
    assert!(chats
        .iter()
        .all(|r| r["auth"] == true && r["model"] == "acme-coder"));

    // Only the user's endpoint rows can be removed here.
    let not_endpoint = call(&service, "POST", "/api/models/remove", json!({"id":"mock"})).await;
    assert!(not_endpoint.is_err());
    call(&service, "POST", "/api/models/remove", json!({"id":id}))
        .await
        .unwrap();
    assert!(endpoint_rows(
        &call(&service, "GET", "/api/picker", Value::Null)
            .await
            .unwrap()
    )
    .is_empty());
    assert!(
        call(&service, "POST", "/api/models/remove", json!({"id":id}))
            .await
            .is_err()
    );
    // The saved key stays for other models of this server.
    assert!(fs::read_to_string(paths.secrets_file())
        .unwrap()
        .contains(KEY_NAME));
}

#[tokio::test]
async fn endpoint_requests_are_checked_before_anything_is_sent() {
    let root = tempfile::tempdir().unwrap();
    let (paths, service) = setup(root.path());
    let refuse = |body: Value| {
        let service = &service;
        async move {
            format!(
                "{:#}",
                call(service, "POST", "/api/providers/models", body)
                    .await
                    .unwrap_err()
            )
        }
    };
    assert!(refuse(json!({"provider":"openrouter"}))
        .await
        .contains("Choose a provider"));
    assert!(
        refuse(json!({"provider":"vllm","endpoint":"ftp://example.com"}))
            .await
            .contains("http://")
    );
    assert!(
        refuse(json!({"provider":"vllm","endpoint":"https://user:secret@example.com/v1"}))
            .await
            .contains("user name or password")
    );
    assert!(refuse(
        json!({"provider":"vllm","endpoint":"https://example.com/v1","api_key_env":"not a name"})
    )
    .await
    .contains("key name"));
    assert!(call(
        &service,
        "POST",
        "/api/models/endpoints",
        json!({"provider":"vllm","endpoint":"http://127.0.0.1:9/v1","models":[]})
    )
    .await
    .is_err());
    // Offline: only servers on this computer can be reached.
    Config::patch(&paths, json!({"network": {"mode": "offline"}})).unwrap();
    assert!(refuse(
        json!({"provider":"openai_compatible","endpoint":"https://api.example.com/v1"})
    )
    .await
    .contains("Offline mode"));
}
