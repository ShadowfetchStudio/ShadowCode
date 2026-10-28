import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { publish } from './publish-native-release.mjs';

import { fixture as signedFixture, ARM } from './publisher-fixtures.mjs';
const fixture = run => signedFixture(run, publish);

test('uploads to a draft, verifies all bytes, then publishes', () => fixture(async ({ state, execute }) => {
  assert.equal((await execute()).status, 'published');
  assert.equal(state.release.draft, false);
  const publication = state.calls.findIndex(args => args[1] === 'edit');
  assert.equal(state.calls.slice(0, publication).filter(args => args[1] === 'download').length, 7);
}));
test('new draft visibility can lag creation without duplicate creation or premature uploads', () => fixture(async ({ state, execute, gh }) => {
  let hiddenListings = 3;
  const waits = [];
  const delayedGh = args => {
    const result = gh(args);
    if (args[0] === 'api' && args[1].includes('/releases?') && state.release && hiddenListings > 0) {
      hiddenListings--;
      return '[[]]';
    }
    return result;
  };
  assert.equal((await execute({ gh: delayedGh, sleep: async milliseconds => {
    waits.push(milliseconds);
    assert.equal(state.assets.size, 0);
    assert(state.release.draft);
  } })).status, 'published');
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(state.calls.filter(args => args[1] === 'create').length, 1);
  assert.equal(state.calls.filter(args => args[1] === 'download').length, 7);
}));
test('invisible new draft exhausts bounded retries without uploading or creating again', () => fixture(async ({ state, execute, gh }) => {
  const waits = [];
  await assert.rejects(execute({ gh: args => {
    const result = gh(args);
    return args[0] === 'api' && args[1].includes('/releases?') ? '[[]]' : result;
  }, sleep: async milliseconds => { waits.push(milliseconds); } }), /Draft release is missing after creation/);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000]);
  assert.equal(state.calls.filter(args => args[1] === 'create').length, 1);
  assert(!state.calls.some(args => ['upload', 'edit'].includes(args[1])));
  assert(state.release.draft);
}));
test('draft visibility retries stop immediately on API authorization failure', () => fixture(async ({ state, execute, gh }) => {
  const waits = [];
  await assert.rejects(execute({ gh: args => {
    const result = gh(args);
    return args[0] === 'api' && args[1].includes('/releases?') ? '[[]]' : result;
  }, sleep: async milliseconds => { waits.push(milliseconds); state.apiFailure = true; } }), /HTTP 403/);
  assert.deepEqual(waits, [1000]);
  assert.equal(state.calls.filter(args => args[1] === 'create').length, 1);
  assert(!state.calls.some(args => ['upload', 'edit'].includes(args[1])));
}));
test('interrupted upload stays draft and retry resumes without overwrites', () => fixture(async ({ state, execute }) => {
  state.failUpload = true;
  await assert.rejects(execute, /upload interrupted/);
  assert(state.release.draft);
  assert.equal(state.assets.size, 1);
  state.failUpload = false;
  await execute();
  assert.equal(state.calls.filter(args => args[1] === 'upload' && args[3].endsWith('_amd64.AppImage')).length, 1);
}));
test('published retry verifies bytes without mutations', () => fixture(async ({ state, execute }) => {
  await execute(); state.calls = [];
  assert.equal((await execute()).status, 'already-published');
  assert(state.calls.every(args => args[0] === 'api' || args[1] === 'download'));
}));
test('a published retry leaves the macOS images, Flatpaks and Windows files alone but a draft refuses them', () => fixture(async ({ state, execute }) => {
  await execute(); state.calls = [];
  state.assets.set('ShadowCode_1.0.0_x64.dmg', Buffer.from('macOS image'));
  state.assets.set('ShadowCode_1.0.0_macos.sha256', Buffer.from('checksums'));
  state.assets.set('ShadowCode_1.0.0_aarch64.flatpak', Buffer.from('Flatpak bundle'));
  state.assets.set('ShadowCode_1.0.0_flatpak.sha256', Buffer.from('checksums'));
  state.assets.set('ShadowCode_1.0.0_x64-setup.exe', Buffer.from('Windows installer'));
  state.assets.set('ShadowCode_1.0.0_busybox-w32-source.tar.gz', Buffer.from('source'));
  state.assets.set('ShadowCode_1.0.0_windows.sha256', Buffer.from('checksums'));
  assert.equal((await execute()).status, 'already-published');
  assert(state.calls.every(args => args[0] === 'api' || args[1] === 'download'));
  state.release.draft = true;
  await assert.rejects(execute, /Unexpected remote asset ShadowCode_1.0.0_/);
}));
test('same version with changed local content is refused', () => fixture(async ({ state, execute, files, rebuild }) => {
  await execute(); state.calls = [];
  await writeFile(files[0], 'different binary');
  await rebuild();
  await assert.rejects(execute, /Content mismatch/);
  assert(state.calls.every(args => args[0] === 'api' || args[1] === 'download'));
}));
test('mismatched draft content is never overwritten or published', () => fixture(async ({ state, execute }) => {
  state.release = { draft: true, tag_name: 'v1.0.0' };
  state.assets.set('ShadowCode_1.0.0_amd64.AppImage', Buffer.from('wrong bytes'));
  await assert.rejects(execute, /Content mismatch/);
  assert(state.release.draft);
  assert(!state.calls.some(args => ['upload', 'edit'].includes(args[1])));
}));
test('authorization failure cannot create another release', () => fixture(async ({ state, execute }) => {
  state.apiFailure = true;
  await assert.rejects(execute, /HTTP 403/);
  assert.equal(state.calls.length, 1);
}));
test('incomplete published release is refused without repair writes', () => fixture(async ({ state, execute, files }) => {
  state.release = { draft: false, tag_name: 'v1.0.0' };
  state.assets.set('ShadowCode_1.0.0_amd64.AppImage', readFileSync(files[0]));
  await assert.rejects(execute, /Incomplete/);
  assert(!state.calls.some(args => ['upload', 'edit'].includes(args[1])));
}));

test('uploaded bytes must verify before draft becomes public', () => fixture(async ({ state, execute }) => {
  state.corruptUpload = true;
  await assert.rejects(execute, /Content mismatch/);
  assert(state.release.draft);
  assert(!state.calls.some(args => args[1] === 'edit'));
}));

test('missing required verification cannot create or publish a release', () => fixture(async ({ state, execute }) => {
  await assert.rejects(execute({ verification: null }), /verification/i);
  assert.equal(state.calls.length, 0);
}));

for (const status of ['failed', 'skipped', 'running']) {
  test(`required ${status} verification cannot create or publish a release`, () => fixture(async ({ state, execute, verification }) => {
    verification.gates['native-behavior'].status = status;
    await assert.rejects(execute, /Required verification gate did not pass/);
    assert.equal(state.calls.length, 0);
  }));
}

const twoTargets = run => signedFixture(run, publish, { targets: ['x86_64-unknown-linux-gnu', ARM] });
test('one release carries the x86_64 and aarch64 bundles under disjoint names', () => twoTargets(async ({ state, execute }) => {
  assert.equal((await execute()).status, 'published');
  assert.deepEqual([...state.assets.keys()].sort(), [
    'RELEASE-AUTH', 'RELEASE-AUTH-aarch64', 'RELEASE-AUTH-aarch64.sig', 'RELEASE-AUTH.sig',
    'RELEASE-MANIFEST-aarch64.json', 'RELEASE-MANIFEST.json', 'SHA256SUMS', 'SHA256SUMS-aarch64',
    'ShadowCode_1.0.0_aarch64.AppImage', 'ShadowCode_1.0.0_aarch64_appimage-runtime-sources.tar.gz', 'ShadowCode_1.0.0_amd64.AppImage', 'ShadowCode_1.0.0_amd64.deb',
    'ShadowCode_1.0.0_appimage-runtime-sources.tar.gz', 'ShadowCode_1.0.0_arm64.deb',
  ].sort());
  const publication = state.calls.findIndex(args => args[1] === 'edit');
  assert.equal(state.calls.slice(0, publication).filter(args => args[1] === 'download').length, 14);
  // A retry reads the published release back and changes nothing.
  const before = state.calls.length;
  assert.equal((await execute()).status, 'already-published');
  assert(state.calls.slice(before).every(args => args[0] === 'api' || args[1] === 'download'));
}));
test('an aarch64 bundle is authenticated for its own target before any release operation', () => twoTargets(async ({ state, execute, signedBundles, bundles, trustDir }) => {
  const [x86, arm] = signedBundles;
  // The x86_64 bundle is required; targets cannot repeat or be unknown.
  await assert.rejects(execute({ bundles: [arm] }), /x86_64 release bundle is required/);
  await assert.rejects(execute({ bundles: [x86, x86] }), /Duplicate release target/);
  await assert.rejects(execute({ bundles: [x86, { ...arm, target: 'riscv64gc-unknown-linux-gnu' }] }), /Unsupported release target/);
  // x86_64 receipts or files offered as the aarch64 bundle are refused.
  await assert.rejects(execute({ bundles: [x86, { ...x86, target: ARM }] }), /Unexpected release asset|asset set mismatch/);
  await assert.rejects(execute({ bundles: [x86, { ...arm, verification: x86.verification }] }), /Verification package set or bytes changed/);
  // An aarch64 envelope is invalid once the policy stops trusting aarch64.
  const policy = path.join(trustDir, 'policy'), trusted = await readFile(policy, 'utf8');
  await writeFile(policy, trusted.replace(`,${ARM}`, ''));
  await assert.rejects(execute(), /Release target is not trusted/);
  await writeFile(policy, trusted);
  // A tampered aarch64 package fails its own signed checksums.
  await writeFile(bundles[1].packages[1], 'tampered');
  await assert.rejects(execute(), /Checksums|digest|Verification package/);
  assert.equal(state.calls.length, 0);
}));
