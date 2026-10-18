// Run with the installed /app/bin/node inside Flatpak, in an isolated profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import path from "node:path";

const output = path.resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(output, "package-"));
const project = path.join(scratch, "project with spaces"), profile = path.join(scratch, "profile");
await mkdir(project); await mkdir(path.join(profile, "config"), { recursive: true });
await writeFile(path.join(project, "README.md"), "Flatpak fixture read value\n");
const checks = [], children = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(50); }
  throw new Error(`${label} timed out`);
}
async function cli(args, code = 0) {
  const child = spawn("/app/bin/shadowcode", ["--profile", profile, "--workspace", project, "--json", ...args]);
  children.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
  const result = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => resolve(code)); });
  children.delete(child);
  assert.equal(result, code, `${args}: ${stderr} ${stdout}`);
  if (args[0] === "--version") return stdout.trim();
  return JSON.parse(stdout);
}
let modelError, hostNetwork;
const model = createServer(async (req, res) => {
  try {
    let body = ""; for await (const bytes of req) body += bytes;
    const payload = JSON.parse(body), results = payload.messages.filter(m => m.role === "tool");
    const shell = payload.messages.some(m => m.role === "user" && m.content.includes("SANDBOX"));
    let message;
    if (!results.length) {
      const command = "printf '%s\\n' \"$(readlink /proc/self/ns/net)\"; printf sandbox-file > sandbox.txt";
      message = { role: "assistant", content: "Inspecting the fixture.", tool_calls: [{ id: "flatpak-call", type: "function", function: { name: shell ? "exec" : "read_file", arguments: JSON.stringify(shell ? { command } : { path: "README.md" }) } }] };
    } else {
      assert.ok(results.some(m => m.content.includes(shell ? "net:[" : "Flatpak fixture read value")), JSON.stringify(results));
      if (shell) assert.ok(!JSON.stringify(results).includes(hostNetwork), "Network-off command shares the host network namespace");
      message = { role: "assistant", content: "Flatpak task completed." };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
  } catch (error) { modelError = error; res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
await writeFile(path.join(profile, "config/config.yaml"), JSON.stringify({
  model: { default: "flatpak-fixture", name: "flatpak-fixture", provider: "local", endpoint: `http://127.0.0.1:${model.address().port}/v1`, context_limit: 16384 },
  onboarding: { completed: true, workspace: project }, permissions: { approve_shell: false },
  network: { shell: "off" }, ui: { notify: false },
}));
let owner, lease;
try {
  assert.equal(await cli(["--version"]), "ShadowCode 2.3.0");
  assert.equal((await cli(["health"])).runtime, "rust");
  await cli(["trust"]);
  const exec = await cli(["exec", "printf host-command > host.txt; git --version; node --version; readlink /proc/self/ns/net"]);
  assert.equal(exec.ok, true, JSON.stringify(exec));
  assert.match(exec.stdout, /git version/); assert.match(exec.stdout, /v\d+\.\d+/);
  hostNetwork = exec.stdout.match(/net:\[\d+\]/)?.[0]; assert.ok(hostNetwork);
  assert.equal(await readFile(path.join(project, "host.txt"), "utf8"), "host-command");
  checks.push("version, headless startup, trust, host Git/Node, cwd with spaces and project writes");
  assert.equal((await cli(["run", "READ fixture"])).status, "completed");
  assert.equal((await cli(["run", "SANDBOX fixture"])).status, "completed");
  assert.equal(await readFile(path.join(project, "sandbox.txt"), "utf8"), "sandbox-file");
  assert.ifError(modelError);
  checks.push("model-response fixture, project read, approved agent command through host bubblewrap");
  owner = spawn("/app/bin/shadowcode", ["--profile", profile, "--workspace", project, "--json", "serve"]);
  children.add(owner); let errors = ""; owner.stderr.on("data", data => errors += data); owner.stdout.resume();
  await until("persistent engine", () => errors.includes("serving"));
  const roots = await Promise.all(["config", "data", "state"].map(name => realpath(path.join(profile, name))));
  const identity = createHash("sha256"); for (const root of roots) identity.update(root).update(Buffer.from([0]));
  const digest = identity.digest("hex"), socket = `/run/user/${process.getuid()}/shadowcode/${digest.slice(0, 32)}.sock`;
  function exchange(method, route, body = null, view = null, keep = false) {
    return new Promise((resolve, reject) => {
      const peer = net.createConnection(socket); let bytes = Buffer.alloc(0);
      peer.on("error", reject);
      peer.on("connect", () => {
        const data = Buffer.from(JSON.stringify({ protocol: 1, profile: digest, workspace: project, session_id: null, view, request: { method, path: route, body } }));
        const header = Buffer.alloc(4); header.writeUInt32BE(data.length); peer.write(Buffer.concat([header, data]));
      });
      peer.on("data", chunk => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length < 4 || bytes.length < 4 + bytes.readUInt32BE(0)) return;
        const response = JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32BE(0)));
        peer.removeAllListeners("data");
        if (!keep) peer.end(); else lease = peer;
        if (response.error) reject(new Error(response.error)); else resolve(response.result);
      });
    });
  }
  const view = (await exchange("POST", "/api/views", null, null, true)).view;
  const about = await exchange("GET", "/api/about", null, view);
  assert.equal(about.version, "2.3.0"); assert.equal(about.publisher, "Shadowfetch");
  assert.equal(about.install.kind, "flatpak");
  assert.equal(about.links.website, "https://www.shadowfetchlinux.org/shadowcode");
  assert.equal(about.links.publisher, "https://shadowfetch.com");
  assert.equal(about.links.contributors, "https://github.com/ShadowfetchStudio/ShadowCode/graphs/contributors");
  assert.match(about.license.trademark_policy, /Based on ShadowCode by Shadowfetch/);
  checks.push("About identity, official links, contributors, Flatpak classification and embedded trademark policy");
  const opened = await exchange("POST", "/api/terminals", { cols: 100, rows: 30 }, view);
  const id = opened.id;
  assert.ok(id, JSON.stringify(opened));
  await exchange("POST", `/api/terminals/${id}/input`, { data: "printf 'PTY_OK:%s\\n' \"$PWD\"; sleep 60 & echo $! > terminal-child.pid\n" }, view);
  const terminal = await until("PTY output", async () => {
    const result = await exchange("GET", `/api/terminals/${id}/output`, null, view);
    const text = Buffer.from(result.data, "base64").toString("utf8");
    return text.includes(`PTY_OK:${project}`) && { ...result, text };
  });
  assert.doesNotMatch(JSON.stringify(terminal), /no job control|cannot set terminal process group/);
  const terminalChild = Number(await until("terminal child PID", async () => { try { return (await readFile(path.join(project, "terminal-child.pid"), "utf8")).trim(); } catch { return null; } }));
  await exchange("POST", `/api/terminals/${id}/resize`, { cols: 111, rows: 37 }, view);
  await delay(150);
  await exchange("POST", `/api/terminals/${id}/input`, { data: "stty size; printf 'SIZE_DONE\\n'; sleep 60\n" }, view);
  await until("terminal resize", async () => {
    const value = await exchange("GET", `/api/terminals/${id}/output`, null, view);
    return Buffer.from(value.data, "base64").toString().includes("37 111");
  });
  await delay(150);
  await exchange("POST", `/api/terminals/${id}/input`, { data: "\u0003" }, view);
  await exchange("POST", `/api/terminals/${id}/input`, { data: "printf 'INTERRUPT_OK\\n'\n" }, view);
  await until("terminal Ctrl-C", async () => {
    const value = await exchange("GET", `/api/terminals/${id}/output`, null, view);
    return /[\r\n]INTERRUPT_OK[\r\n]/.test(Buffer.from(value.data, "base64").toString());
  }, 3000);
  await exchange("POST", `/api/terminals/${id}/close`, null, view);
  await until("terminal descendant cleanup", async () => {
    const result = await cli(["exec", `if kill -0 ${terminalChild} 2>/dev/null; then printf alive; else printf dead; fi`]);
    return result.stdout === "dead";
  }, 5000);
  checks.push("persistent engine, attached view, real host PTY, shell job control, resize, Ctrl-C and descendant cleanup");
  await writeFile(path.join(output, "package-result.json"), JSON.stringify({ version: "2.3.0", profile, project, checks, terminal, terminal_child_pid: terminalChild, host_network: hostNetwork }, null, 2) + "\n");
  console.log(JSON.stringify(checks, null, 2));
} finally {
  if (lease) lease.destroy();
  for (const child of children) child.kill("SIGTERM");
  model.closeAllConnections(); model.close();
  await delay(1000);
}
