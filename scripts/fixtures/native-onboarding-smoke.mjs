// Shared by the real native desktop/endurance and opt-in download flows.
// Keep DOM checks callable through WebDriver's execute(script, args).
import assert from "node:assert/strict";

export async function assertFolderOnboarding(execute) {
  const dialog = await execute(`
    const d = document.querySelector('.wizard[role="dialog"]');
    return d && {
      text: d.innerText,
      fields: [...d.querySelectorAll('input, select, textarea')].map(e => e.type || e.tagName),
      open: [...d.querySelectorAll('button')].some(b => b.textContent.trim() === 'Open project'),
      folder: !!d.querySelector('#onboarding-folder'),
    };
  `);
  assert.ok(dialog, "Accessible first-run dialog");
  assert.match(dialog.text, /Welcome to ShadowCode/);
  assert.match(dialog.text, /Ask-first approvals are\s+on/);
  assert.match(dialog.text, /Opening trusts this folder: the agent may read it/);
  assert.match(dialog.text, /File edits and\s+commands still wait for your approval until you change that/);
  assert.doesNotMatch(dialog.text, /\b(Provider|provider|Endpoint|endpoint|API key|Choose a model|Next)\b/, "Folder onboarding has no model step");
  assert.deepEqual(dialog.fields, ["text"], "Only a project folder is requested; permissions default to ask-first");
  assert.ok(dialog.folder && dialog.open, "Project folder and explicit Open project action");
}

export async function assertWorkspacePermissions(api, project) {
  const status = await api("GET", "/api/workspace/status");
  assert.equal(status.workspace, project);
  assert.equal(status.trusted, true, "Opening explicitly trusts the chosen workspace");
  assert.equal(status.onboarding?.completed, true, "Onboarding completion persisted");
  assert.equal(status.onboarding?.workspace, project, "Onboarding records the chosen folder");
  assert.equal(status.permissions?.mode, "ask", "Live workspace still requires approvals");
  assert.equal(status.permissions?.level, "workspace", "Opening does not grant elevated access");
  const config = await api("GET", "/api/config");
  const values = config.values || config.config || config;
  assert.equal(values.permissions?.mode, "ask", "Ask-first mode saved in configuration");
  assert.equal(values.permissions?.level, "workspace", "Workspace permission level saved");
}

export async function assertWelcomeControls(execute) {
  // The inline API-key provider is a legitimate select, not a model picker.
  const unexpected = await execute(`return [...document.querySelectorAll('select')]
    .filter(s => !s.closest('.worktree-base') && !s.matches('.welcome-model-setup .api-key-quick select[aria-label="API key provider"]'))
    .map(s => s.outerHTML)`);
  assert.deepEqual(unexpected, [], "No select-based model controls in the workspace");
}

export async function assertWelcomeModelSetup(execute) {
  const setup = await execute(`
    const s = document.querySelector('.welcome-model-setup .model-setup');
    if (!s) return null;
    const key = s.querySelector('input[aria-label="OpenRouter API key"]');
    return {
      radios: [...s.querySelectorAll('.mode-options input[type=radio]')].map(r => r.closest('label').innerText),
      providers: [...s.querySelectorAll('.provider-tile button[aria-label]')].map(b => b.getAttribute('aria-label')),
      keyType: key?.type,
      keyProviders: [...s.querySelectorAll('.api-key-quick select option')].map(o => o.value),
      saveDisabled: s.querySelector('.api-key-quick button[type=submit]')?.disabled,
    };
  `);
  assert.ok(setup, "Model setup is in the empty conversation after onboarding");
  assert.equal(setup.radios.length, 1, "Local download is the single model-setup radio");
  assert.match(setup.radios[0], /Download a free model to run on this computer/);
  // A real CI host may lack vendor CLIs: honest 'not installed' controls are
  // valid, as are Connect and Connected. Never start a vendor login here.
  for (const provider of ["Codex", "Claude Code", "Cursor", "Grok"]) {
    assert.ok(setup.providers.some(label => [
      `Connect ${provider}`, `Connected ${provider}`, `${provider} is not installed`,
    ].includes(label)), `${provider} connection or availability control`);
  }
  assert.ok(setup.providers.some(label => /Antigravity/.test(label)), "Antigravity connection or install status");
  assert.equal(setup.keyType, "password", "OpenRouter key entry is masked");
  assert.deepEqual(setup.keyProviders, ["openrouter", "grok", "openai"], "Inline key provider choices");
  assert.equal(setup.saveDisabled, true, "An empty API key cannot be saved");
}
