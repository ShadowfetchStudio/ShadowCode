// Draft staging with byte verification; never replace a versioned asset.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { digest } from './native-release-verification.mjs';
import { IDENTITY, TARGETS } from './native-release-auth.mjs';
import { withReleaseSnapshot, validateContext, validateStagedRelease, readReceipts, requireTransportLayout } from './native-release-assets.mjs';

import { platformAssets } from './platform-release-assets.mjs';

export { digest } from './native-release-verification.mjs';
// Historical Linux-only publications had platform files appended after promotion.
// Only the legacy read-only retry may ignore those known additional files.
const ATTACHED_LATER = /^ShadowCode_\d+\.\d+\.\d+_((x64|aarch64)\.dmg|(x86_64|aarch64)\.flatpak|x64-setup\.exe|busybox-w32-source\.tar\.gz|(macos|flatpak|windows)\.sha256)$/;
const command = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

// One release carries every target's signed bundle. Each bundle is snapshotted
// and authenticated for its own target before any release operation; their
// asset names are disjoint (non-x86_64 metadata carries a target suffix).
export async function publish({ repo, tag, commit, files, verification, bundles, trustDir, runId, runAttempt, platforms, gh = command, sleep = delay }) {
  const context = { repo, tag, commit, runId, runAttempt };
  const version = validateContext(context);
  bundles ??= [{ target: IDENTITY.target, files, verification }];
  assert(Array.isArray(bundles) && bundles.length >= 1, 'At least one signed release bundle is required');
  const targets = bundles.map(bundle => bundle.target);
  assert(targets.every(target => Object.hasOwn(TARGETS, target)), 'Unsupported release target');
  assert.equal(new Set(targets).size, targets.length, 'Duplicate release target');
  assert(targets.includes(IDENTITY.target), 'The x86_64 release bundle is required');
  const expected = new Map();
  const stage = async index => {
    if (index === bundles.length) {
      if (!platforms) return publishVerified({ repo, tag, commit, expected, gh, sleep, legacy: true }); // Historical Linux-only bundles.
      assert.equal(targets.length, Object.keys(TARGETS).length, 'Both signed Linux targets are required');
      const verifyInstaller = (file, workflow) => gh(['attestation', 'verify', file, '--repo', repo,
        '--source-ref', 'refs/tags/' + tag, '--source-digest', commit,
        '--signer-workflow', repo + '/.github/workflows/' + workflow + '.yml', '--deny-self-hosted-runners']);
      const output = await mkdtemp(path.join(tmpdir(), 'shadowcode-manifests-'));
      try {
        for (const [name, asset] of expected) {
          if (name.endsWith('.deb') || name.endsWith('.AppImage')) verifyInstaller(asset.file, 'release');
        }
        const extra = await platformAssets({ directory: platforms, version, output, verifyInstaller });
        for (const [name, asset] of extra) {
          assert(!expected.has(name), 'Duplicate platform asset ' + name);
          expected.set(name, asset);
        }
        return await publishVerified({ repo, tag, commit, expected, gh, sleep });
      } finally { await rm(output, { recursive: true, force: true }); }
    }
    const { target, files: bundleFiles, verification: receipts } = bundles[index];
    return withReleaseSnapshot({ files: bundleFiles, version, target }, async (directory, observed) => {
      await validateStagedRelease({ directory, observed, verification: receipts, context, trustDir, signed: true, target });
      for (const [name, asset] of observed) {
        assert(!expected.has(name), `Duplicate release asset across targets: ${name}`);
        expected.set(name, asset);
      }
      return stage(index + 1);
    });
  };
  return stage(0);
}
async function publishVerified({ repo, tag, commit, expected, gh, sleep, legacy = false }) {
  const identity = JSON.parse(gh(['api', `repos/${repo}`]));
  assert.equal(String(identity.id), IDENTITY.repositoryId, 'Remote repository identity changed');
  assert.equal(String(identity.owner?.id), IDENTITY.ownerId, 'Remote repository owner changed');
  const verifyTag = () => {
    let object = JSON.parse(gh(['api', `repos/${repo}/git/ref/tags/${tag}`])).object;
    let depth = 0;
    while (object?.type === 'tag') {
      assert(++depth <= 4 && /^[a-f0-9]{40}$/.test(object.sha), 'Invalid annotated tag chain');
      object = JSON.parse(gh(['api', `repos/${repo}/git/tags/${object.sha}`])).object;
    }
    assert.equal(object?.type, 'commit', 'Release tag must resolve to a commit');
    assert.equal(object.sha, commit, 'Remote release tag changed');
  };
  verifyTag();
  // Listing includes authenticated drafts; the tag endpoint describes
  // published releases and must not be used to infer draft absence.
  const inspect = () => {
    const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--slurp'])).flat();
    const matches = releases.filter(release => release.tag_name === tag);
    assert(matches.length <= 1, 'Multiple releases use this tag; review before publication');
    return matches[0];
  };
  let release = inspect();
  if (!release) {
    verifyTag();
    gh(['release', 'create', tag, '--repo', repo, '--draft', '--verify-tag', '--target', commit,
      '--title', `ShadowCode ${tag}`, '--notes-file', 'docs/RELEASE_NOTES.md']);
    release = inspect();
    // GitHub can acknowledge creation before the authenticated listing reflects
    // the draft. Retry only a successful empty listing, never creation or an API
    // error, and leave the created draft intact if visibility does not converge.
    for (const milliseconds of [1000, 2000, 4000, 8000]) {
      if (release) break;
      await sleep(milliseconds);
      release = inspect();
    }
  }
  assert(release, 'Draft release is missing after creation');
  assert.equal(release.tag_name, tag);
  assert.equal(typeof release.draft, 'boolean');
  const verify = async (record, allowMissing) => {
    const names = new Set();
    const scratch = await mkdtemp(path.join(tmpdir(), 'shadowcode-release-'));
    try {
      for (const asset of record.assets) {
        if (legacy && !record.draft && ATTACHED_LATER.test(asset.name)) continue;
        assert(expected.has(asset.name), `Unexpected remote asset ${asset.name}; review the draft`);
        assert(!names.has(asset.name), `Duplicate remote asset ${asset.name}`);
        names.add(asset.name);
        const target = path.join(scratch, asset.name);
        gh(['release', 'download', tag, '--repo', repo, '--pattern', asset.name, '--output', target]);
        assert.equal(await digest(target), expected.get(asset.name).hash, `Content mismatch for ${asset.name}; never overwrite this version`);
      }
      if (!allowMissing) assert.equal(names.size, expected.size, 'Incomplete remote asset set');
      return names;
    } finally { await rm(scratch, { recursive: true, force: true }); }
  };
  const present = await verify(release, release.draft);
  if (!release.draft) return { status: 'already-published' }; // Read-only retry.
  for (const [name, asset] of expected) {
    if (!present.has(name)) gh(['release', 'upload', tag, asset.file, '--repo', repo]);
  }
  release = inspect();
  assert(release.draft, 'Release changed during staging');
  await verify(release, false);
  verifyTag();
  gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--verify-tag']);
  return { status: 'published' };
}

async function main() {
  const [bundle, trustDir, aarch64Bundle, platforms] = process.argv.slice(2);
  assert(bundle && trustDir && aarch64Bundle && platforms && process.argv.length === 6,
    'Usage: node publish-native-release.mjs X86_64_BUNDLE TRUST_DIR AARCH64_BUNDLE PLATFORM_BUNDLES');
  const context = { repo: process.env.GITHUB_REPOSITORY, tag: process.env.GITHUB_REF_NAME, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT };
  const version = validateContext(context);
  const load = async (directory, target) => ({ target, files: await requireTransportLayout(directory, version, true, target), verification: await readReceipts(directory) });
  const bundles = [await load(bundle, IDENTITY.target)];
  if (aarch64Bundle) bundles.push(await load(aarch64Bundle, 'aarch64-unknown-linux-gnu'));
  console.log(await publish({ ...context, bundles, trustDir, platforms }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
