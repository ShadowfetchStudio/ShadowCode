// Installed-binary endurance qualification on Windows, macOS and Linux.
// Uses a private profile/project and a loopback scripted provider, never credentials.
// Desktop rendering and inference-server memory require separate qualification.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir, platform, release } from "node:os";
import path from "node:path";

const exec = promisify(execFile);
const binary = process.env.SHADOW_STRESS_BINARY;
assert.ok(
  binary && path.isAbsolute(binary),
  "Set SHADOW_STRESS_BINARY to the installed native executable, not a wrapper",
);
const artifacts = path.resolve(
  process.env.SHADOW_STRESS_ARTIFACTS || "artifacts/platform-runtime",
);
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(path.join(tmpdir(), "shadowcode-platform-"));
const profile = path.join(scratch, "profile");
const projects = Array.from({ length: 4 }, (_, i) =>
  path.join(scratch, "project-" + i),
);
const children = new Set(),
  sockets = new Set(),
  measurements = [];
let owner,
  fixtureError,
  requests = 0,
  stalled = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fixtureError) throw fixtureError;
    const v = await fn();
    if (v) return v;
    await sleep(50);
  }
  throw Error(label + " timed out");
}
function launch(args, workspace = projects[0]) {
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const child = spawn(
    binary,
    ["--profile", profile, "--workspace", workspace, "--json", ...args],
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  children.add(child);
  const output = { stdout: "", stderr: "", closed: false, code: null };
  for (const stream of ["stdout", "stderr"])
    child[stream].on("data", (b) => {
      output[stream] += b;
      if (output[stream].length > 4000000) child.kill();
    });
  child.on("error", (e) => {
    output.error = e;
    output.closed = true;
  });
  child.on("close", (code) => {
    output.code = code;
    output.closed = true;
    children.delete(child);
  });
  return { child, output };
}
async function finish(run, expected = 0) {
  await until("CLI completion", () => run.output.closed, 60000);
  if (run.output.error) throw run.output.error;
  assert.equal(run.output.code, expected, run.output.stderr);
  return JSON.parse(run.output.stdout);
}
const cli = (args, workspace) => finish(launch(args, workspace));
const provider = createServer(async (req, res) => {
  try {
    let text = "";
    for await (const b of req) {
      text += b;
      assert.ok(text.length < 2000000);
    }
    const payload = JSON.parse(text);
    requests++;
    const index = payload.messages.findLastIndex((m) => m.role === "user");
    const prompt = payload.messages[index].content;
    if (prompt.includes("STALL")) {
      stalled++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.flushHeaders();
      return;
    }
    const tool = payload.messages
      .slice(index + 1)
      .find((m) => m.role === "tool");
    if (tool) assert.ok(tool.content.includes("platform-fixture-evidence"));
    const message = tool
      ? {
          role: "assistant",
          content: prompt + " verified. " + "Bounded evidence. ".repeat(100),
        }
      : {
          role: "assistant",
          content: "Inspect the fixture.",
          tool_calls: [
            {
              id: "read-" + requests,
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "README.md" }),
              },
            },
          ],
        };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message, finish_reason: tool ? "stop" : "tool_calls" }],
        usage: {
          prompt_tokens: 400,
          completion_tokens: 800,
          total_tokens: 1200,
        },
      }),
    );
  } catch (e) {
    fixtureError = e;
    res.writeHead(500);
    res.end("Fixture failed");
  }
});
provider.on("connection", (s) => {
  sockets.add(s);
  s.on("close", () => sockets.delete(s));
});
async function metrics(round) {
  const pid = owner.child.pid;
  let value;
  if (process.platform === "linux") {
    const s = await readFile(`/proc/${pid}/status`, "utf8");
    value = {
      rssKiB: Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1]),
      threads: Number(s.match(/^Threads:\s+(\d+)/m)?.[1]),
      resources: (await readdir(`/proc/${pid}/fd`)).length,
      resourceKind: "file descriptors",
    };
  } else if (process.platform === "darwin") {
    const { stdout } = await exec("/bin/ps", ["-p", String(pid), "-o", "rss="]);
    const threads = await exec("/bin/ps", ["-M", "-p", String(pid)]);
    const files = await exec("/usr/sbin/lsof", [
      "-a",
      "-p",
      String(pid),
      "-Ff",
    ]);
    value = {
      rssKiB: Number(stdout.trim()),
      threads: threads.stdout.trim().split("\n").length - 1,
      resources: files.stdout.split("\n").filter((l) => /^f\d/.test(l)).length,
      resourceKind: "file descriptors",
    };
  } else if (process.platform === "win32") {
    const script = `$p=Get-Process -Id ${pid} -ErrorAction Stop; @{rssKiB=[math]::Ceiling($p.WorkingSet64/1024);threads=$p.Threads.Count;resources=$p.HandleCount;resourceKind='handles'} | ConvertTo-Json -Compress`;
    const { stdout } = await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { timeout: 15000, windowsHide: true },
    );
    value = JSON.parse(stdout);
  } else throw Error("Unsupported qualification platform " + process.platform);
  assert.ok(
    value.rssKiB > 0 && value.threads > 0 && value.resources > 0,
    "Process measurements must be available",
  );
  measurements.push({ round, ...value });
  return value;
}
try {
  const hash = createHash("sha256")
    .update(await readFile(binary))
    .digest("hex");
  const version = await exec(binary, ["--version"], {
    timeout: 30000,
    windowsHide: true,
  });
  assert.match(version.stdout, /ShadowCode \d+\.\d+\.\d+/);
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  for (const p of projects) {
    await mkdir(p);
    await writeFile(
      path.join(p, "README.md"),
      "platform-fixture-evidence\n" + "Evidence line.\n".repeat(1000),
    );
  }
  await mkdir(path.join(profile, "config"), { recursive: true });
  await writeFile(
    path.join(profile, "config/config.yaml"),
    JSON.stringify({
      model: {
        default: "platform-fixture",
        name: "platform-fixture",
        provider: "local",
        endpoint: `http://127.0.0.1:${provider.address().port}/v1`,
        context_limit: 32768,
      },
      trusted_workspaces: projects,
      onboarding: { completed: true, workspace: projects[0] },
      ui: { notify: false },
    }),
  );
  owner = launch(["serve"]);
  await until("persistent engine startup", () =>
    owner.output.stderr.includes("serving"),
  );
  const ids = [];
  const warmup = await cli(["run", "WARMUP"]);
  assert.equal(warmup.status, "completed");
  const baseline = await metrics("warmup");
  for (let i = 0; i < 100; i++) {
    const task = await cli(["run", "SEQUENTIAL " + i]);
    assert.equal(task.status, "completed");
    ids.push(task.id);
    if ((i + 1) % 25 === 0) {
      await metrics("sequential-" + (i + 1));
      console.log(`Sequential ${i + 1}/100`);
    }
  }
  for (let round = 0; round < 20; round++) {
    const tasks = await Promise.all(
      projects.map((p, i) => cli(["run", `CONCURRENT ${round} ${i}`], p)),
    );
    for (const t of tasks) {
      assert.equal(t.status, "completed");
      ids.push(t.id);
    }
  }
  assert.equal(ids.length, 180);
  assert.equal(new Set(ids).size, 180);
  const cancelled = [];
  for (let i = 0; i < 5; i++) {
    const before = stalled,
      task = await cli(["run", "STALL " + i, "--detach"]);
    await until("provider stall", () => stalled > before);
    await cli(["jobs", task.id, "--cancel"]);
    await until(
      "cancelled task",
      async () => (await cli(["jobs", task.id])).status === "cancelled",
    );
    cancelled.push(task.id);
  }
  const last = await metrics("completed");
  assert.ok(
    Math.max(...measurements.map((s) => s.rssKiB)) < 768 * 1024,
    "Engine RSS exceeds 768 MiB",
  );
  assert.ok(
    last.rssKiB - baseline.rssKiB < 128 * 1024,
    "Engine RSS grew by 128 MiB",
  );
  assert.ok(
    last.resources <= baseline.resources + 32,
    "Process resources grew beyond allowance",
  );
  assert.ok(
    last.threads <= baseline.threads + 8,
    "Process threads grew beyond allowance",
  );
  // Node terminates Windows processes rather than delivering a console signal.
  // Explicitly qualify persisted completed work after forced termination there;
  // this is not a claim of graceful Windows service shutdown.
  owner.child.kill("SIGTERM");
  await until("engine exit", () => owner.output.closed);
  if (process.platform !== "win32")
    assert.equal(owner.output.code, 0, owner.output.stderr);
  for (const id of [ids[0], ids[99], ids[179]])
    assert.equal((await cli(["jobs", id])).status, "completed");
  for (const id of cancelled)
    assert.equal((await cli(["jobs", id])).status, "cancelled");
  await writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        passed: true,
        platform: platform(),
        osRelease: release(),
        version: version.stdout.trim(),
        binarySha256: hash,
        sequentialCompleted: 100,
        concurrentCompleted: 80,
        cancelled: 5,
        requests,
        measurements,
        persistenceAfterStop: true,
        shutdown:
          process.platform === "win32"
            ? "forced termination; graceful shutdown not tested"
            : "SIGTERM graceful shutdown",
        scope:
          "Installed native engine with loopback scripted provider. Not desktop UI, paid providers, real model inference or inference-server memory.",
      },
      null,
      2,
    ),
  );
  console.log("Installed platform endurance passed.");
} catch (e) {
  await writeFile(
    path.join(artifacts, "failure.txt"),
    `${e.stack}\n${JSON.stringify(measurements)}\n${owner?.output.stderr || ""}`,
  );
  throw e;
} finally {
  for (const c of children) c.kill();
  await sleep(200);
  for (const c of children) c.kill("SIGKILL");
  for (const s of sockets) s.destroy();
  await new Promise((r) => provider.close(r));
  await rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
