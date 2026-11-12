//! Bounded, opt-in real local-model lifecycle check. No downloads or user profile.
//! Usage: qualification_local_lifecycle REPORT.json LLAMA_SERVER MODEL.gguf
//!        [--fail-after-load]
//! Use an external TMPDIR and build cache. Models must be <= 1 GiB. The optional
//! failure exercises the same unconditional shutdown path and exits nonzero.
use anyhow::{bail, ensure, Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use shadowcode_core::{
    config::Config,
    paths::AppPaths,
    service::{Request, Service},
};
use std::{
    fs,
    io::Read,
    path::Path,
    time::{Duration, Instant},
};

const CONTEXT: u64 = 4096;
const LIFECYCLE_SECONDS: u64 = 150;

fn sha256(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    // Signal zero checks existence only; this example never signals arbitrary PIDs.
    unsafe {
        libc::kill(pid as i32, 0) == 0
            || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
    }
}
#[cfg(not(unix))]
fn pid_alive(_: u32) -> bool {
    true
}

async fn dead(pid: u32) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(3), async {
        while pid_alive(pid) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .context("owned child PID still exists after cleanup")
}

async fn call(
    service: &Service,
    steps: &mut Vec<Value>,
    name: &str,
    method: &str,
    path: &str,
    body: Value,
    seconds: u64,
) -> Result<Value> {
    let start = Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(seconds),
        service.dispatch(Request {
            method: method.into(),
            path: path.into(),
            body,
        }),
    )
    .await
    .context(format!("{name}: {seconds}s deadline"))
    .and_then(|r| r);
    match &result {
        Ok(response) => {
            // Catalog includes incidental Ollama discovery; record only explicit
            // qualification inputs and runtime/hardware, not other model paths.
            let response = if name == "catalog" {
                json!({"hardware":response["hardware"], "runtime":response["runtime"], "models":response["models"], "loaded":response["loaded"]})
            } else { response.clone() };
            steps.push(json!({"step":name,"elapsed_ms":start.elapsed().as_millis(),"response":response}));
        }
        Err(error) => steps.push(json!({"step":name,"elapsed_ms":start.elapsed().as_millis(),"error":format!("{error:#}")})),
    }
    eprintln!(
        "{name}: {} ms, {}",
        start.elapsed().as_millis(),
        if result.is_ok() { "returned" } else { "failed" }
    );
    result
}

async fn qualify(binary: &Path, model: &Path, inject_failure: bool) -> Result<Value> {
    ensure!(
        cfg!(unix),
        "PID cleanup qualification currently requires Unix"
    );
    ensure!(
        fs::metadata(model)?.len() <= 1024 * 1024 * 1024,
        "qualification is restricted to models <= 1 GiB"
    );
    let provenance_path = model.with_extension("provenance.json");
    let provenance: Value = serde_json::from_slice(
        &fs::read(&provenance_path).context("model requires adjacent .provenance.json")?,
    )?;
    let model_sha256 = sha256(model)?;
    ensure!(
        provenance["sha256"].as_str() == Some(model_sha256.as_str()),
        "model checksum differs from provenance"
    );
    ensure!(
        provenance["bytes"].as_u64() == Some(fs::metadata(model)?.len()),
        "model size differs from provenance"
    );
    let root = tempfile::Builder::new().prefix("local-life-").tempdir()?;
    let workspace = root.path().join("workspace");
    fs::create_dir(&workspace)?;
    let paths = AppPaths::isolated(&root.path().join("profile"))?;
    Config::patch(
        &paths,
        json!({
            "model":{"context_limit":CONTEXT},
            "local_engine":{"llama_binary":binary,"files":[model],"context_size":CONTEXT},
            "network":{"mode":"offline"},"cli_agents":{"enabled":false}
        }),
    )?;
    let service = Service::open(paths, Some(workspace))?;
    let start = Instant::now();
    let mut steps = Vec::new();
    let mut pids = Vec::new();
    let lifecycle = async {
        let catalog = call(
            &service,
            &mut steps,
            "catalog",
            "GET",
            "/api/local-models",
            Value::Null,
            20,
        )
        .await?;
        let row = catalog["models"]
            .as_array()
            .context("catalog models missing")?
            .iter()
            .find(|row| row["path"].as_str() == model.to_str())
            .context("explicit model absent from catalog")?;
        let id = row["id"].as_str().context("model ID missing")?.to_owned();
        ensure!(
            row["compatible"] == true,
            "explicit model is incompatible: {row}"
        );
        let loaded = call(
            &service,
            &mut steps,
            "load",
            "POST",
            "/api/local-models/load",
            json!({"id":id}),
            45,
        )
        .await?;
        let first = service
            .engine
            .local_runtime()
            .loaded()
            .context("load did not publish a model")?;
        let pid = first.pid.context("owned PID missing")?;
        pids.push(pid);
        ensure!(
            loaded["ok"] == true && first.id == id && first.ctx <= CONTEXT,
            "load/context contract failed"
        );
        ensure!(
            pid_alive(pid) && service.engine.local_runtime().in_use() == 0,
            "load did not release its lease"
        );
        steps.push(json!({"step":"first_process","pid":pid,"alive":true,"leases":0,"context_tokens":first.ctx}));
        if inject_failure {
            bail!("injected failure after first load (cleanup exercise)");
        }
        let reply = call(
            &service,
            &mut steps,
            "short_model_test",
            "POST",
            "/api/models/test",
            json!({"id":id}),
            45,
        )
        .await?;
        ensure!(
            reply["ok"] == true
                && reply["reply"]
                    .as_str()
                    .is_some_and(|s| !s.trim().is_empty()),
            "real completion failed: {reply}"
        );
        ensure!(
            service.engine.local_runtime().in_use() == 0,
            "model test retained a lease"
        );
        call(
            &service,
            &mut steps,
            "same_model_reuse",
            "POST",
            "/api/local-models/load",
            json!({"id":id}),
            10,
        )
        .await?;
        let reused = service
            .engine
            .local_runtime()
            .loaded()
            .context("reuse missing")?;
        ensure!(
            reused.pid == Some(pid) && reused.since == first.since && reused.port == first.port,
            "same-model request restarted the process"
        );
        ensure!(
            service.engine.local_runtime().in_use() == 0,
            "reuse retained a lease"
        );
        steps.push(json!({"step":"reuse_verified","pid":pid,"same_since":true,"same_port":true,"leases":0}));
        let unloaded = call(
            &service,
            &mut steps,
            "unload",
            "POST",
            "/api/local-models/unload",
            json!({}),
            10,
        )
        .await?;
        dead(pid).await?;
        ensure!(
            unloaded["unloaded"] == true
                && service.engine.local_runtime().loaded().is_none()
                && service.engine.local_runtime().in_use() == 0,
            "unload contract failed"
        );
        steps.push(
            json!({"step":"unload_verified","pid":pid,"dead":true,"loaded":false,"leases":0}),
        );
        call(
            &service,
            &mut steps,
            "reload",
            "POST",
            "/api/local-models/load",
            json!({"id":id}),
            45,
        )
        .await?;
        let reloaded = service
            .engine
            .local_runtime()
            .loaded()
            .context("reload missing")?;
        let new_pid = reloaded.pid.context("reload PID missing")?;
        pids.push(new_pid);
        ensure!(
            pid_alive(new_pid) && reloaded.since != first.since && reloaded.ctx <= CONTEXT,
            "reload did not create a fresh bounded runtime"
        );
        ensure!(
            service.engine.local_runtime().in_use() == 0,
            "reload retained a lease"
        );
        steps.push(json!({"step":"reload_verified","pid":new_pid,"alive":true,"leases":0}));
        Ok::<(), anyhow::Error>(())
    };
    let outcome = tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(LIFECYCLE_SECONDS), lifecycle) => result.context("total lifecycle deadline exceeded").and_then(|r|r),
        _ = tokio::signal::ctrl_c() => Err(anyhow::anyhow!("qualification interrupted; cleaning up")),
    };
    // Unconditional cleanup: no assertion/error propagation above can skip this.
    // Also capture a currently published PID if a step failed before recording it.
    if let Some(pid) = service.engine.local_runtime().loaded().and_then(|l| l.pid) {
        if !pids.contains(&pid) {
            pids.push(pid);
        }
    }
    let cleanup_start = Instant::now();
    let shutdown = tokio::time::timeout(Duration::from_secs(20), service.engine.shutdown())
        .await
        .context("shutdown deadline exceeded")
        .and_then(|r| r);
    // An independent bounded stop still runs if another shutdown subsystem fails.
    let stop = tokio::time::timeout(
        Duration::from_secs(5),
        service.engine.local_runtime().stop(),
    )
    .await;
    let mut processes = Vec::new();
    for pid in pids {
        let gone = dead(pid).await.is_ok();
        processes.push(json!({"pid":pid,"dead":gone}));
    }
    let loaded_after = service.engine.local_runtime().loaded_json();
    let leases_after = service.engine.local_runtime().in_use();
    let cleaned = shutdown.is_ok()
        && stop.is_ok()
        && loaded_after.is_none()
        && leases_after == 0
        && processes.iter().all(|p| p["dead"] == true);
    let report = json!({
        "schema":1,"passed":outcome.is_ok() && cleaned,"injected_failure":inject_failure,
        "error":outcome.err().map(|e|format!("{e:#}")),
        "model":model,"model_sha256":model_sha256,"model_provenance":provenance,
        "binary":binary,"binary_sha256":sha256(binary)?,
        "profile_kind":"isolated temporary; removed after shutdown","temporary_root":root.path(),
        "limits":{"context_tokens":CONTEXT,"response_seconds":45,"lifecycle_seconds":LIFECYCLE_SECONDS,"shutdown_seconds":20,"fallback_stop_seconds":5,"pid_wait_seconds_each":3},
        "steps":steps,"elapsed_ms":start.elapsed().as_millis(),
        "cleanup":{"passed":cleaned,"elapsed_ms":cleanup_start.elapsed().as_millis(),"shutdown_error":shutdown.err().map(|e|format!("{e:#}")),"fallback_stop_completed":stop.is_ok(),"processes":processes,"loaded":loaded_after,"leases":leases_after},
        "interpretation":"Single-run lifecycle timing observations, not benchmarks. Backend/provenance describes discovery and requested placement; no confirmed Metal layer offload claim."
    });
    drop(service);
    root.close().context("temporary profile removal failed")?;
    Ok(report)
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    ensure!(args.len() == 3 || (args.len() == 4 && args[3] == "--fail-after-load"), "usage: qualification_local_lifecycle REPORT.json LLAMA_SERVER MODEL.gguf [--fail-after-load]");
    let report_path = Path::new(&args[0]);
    ensure!(
        !report_path.exists(),
        "report already exists; choose a fresh output path"
    );
    let binary = fs::canonicalize(&args[1])?;
    let model = fs::canonicalize(&args[2])?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    let result = runtime.block_on(qualify(&binary, &model, args.len() == 4));
    runtime.shutdown_timeout(Duration::from_secs(5));
    let report =
        result.unwrap_or_else(|e| json!({"passed":false,"setup_or_report_error":format!("{e:#}")}));
    fs::write(report_path, serde_json::to_vec_pretty(&report)?)?;
    println!(
        "{}",
        json!({"passed":report["passed"],"report":report_path,"cleanup":report["cleanup"]})
    );
    ensure!(
        report["passed"] == true,
        "qualification failed; inspect {}",
        report_path.display()
    );
    Ok(())
}
