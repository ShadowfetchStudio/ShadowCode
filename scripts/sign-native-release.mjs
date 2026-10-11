// Protected-job data consumer. Never imports or executes anything from a build artifact.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEnvelope, signEnvelope, publicKeyIdentity, parseTrustPolicy, metadataNames, IDENTITY, TARGETS, LIMITS } from './native-release-auth.mjs';
import { withReleaseSnapshot, validateContext, validateStagedRelease, readReceipts, requireTransportLayout, retainBundle, releaseNames, readBytes } from './native-release-assets.mjs';

export async function signRelease({ bundleDir, trustDir, privateKey, context, outputDir, target = IDENTITY.target }) {
  assert(trustDir && privateKey, 'Provisioned publisher trust and private signing key required');
  assert(Object.hasOwn(TARGETS, target), 'Unsupported release target');
  const version = validateContext(context), files = await requireTransportLayout(bundleDir, version, false, target);
  const verification = await readReceipts(bundleDir), names = metadataNames(target);
  await withReleaseSnapshot({ files, version, signed: false, target }, async (directory, observed) => {
    await validateStagedRelease({ directory, observed, verification, context, signed: false, target });
    const keyId = publicKeyIdentity(privateKey);
    // The independently reviewed tooling checkout supplies this bounded public policy.
    const trust = parseTrustPolicy(await readBytes(path.join(trustDir, 'policy'), LIMITS.trust));
    assert(trust.targets.includes(target), 'Release target is not in the provisioned trust policy');
    const entry = trust.keys.find(key => key.id === keyId);
    assert(entry, 'Private signing key is not in the provisioned trust policy');
    const bytes = await createEnvelope({ bundleDir: directory, version, commit: context.commit, keyId, keyEpoch: entry.epoch, target });
    await writeFile(path.join(directory, names.auth), bytes, { flag: 'wx', mode: 0o400 });
    await writeFile(path.join(directory, names.signature), signEnvelope(bytes, privateKey), { flag: 'wx', mode: 0o400 });
    // Applies current floors/key ranges and verifies all three exact package snapshots.
    await validateStagedRelease({ directory, observed, verification, context, trustDir, signed: true, target });
    await retainBundle(directory, outputDir, releaseNames(version, true, target), verification);
  });
}
async function main() {
  // An optional fourth argument names the target; x86_64 when omitted.
  const [bundleDir, trustDir, outputDir, target = IDENTITY.target] = process.argv.slice(2);
  const privateKey = process.env.NATIVE_RELEASE_SIGNING_KEY_PEM;
  delete process.env.NATIVE_RELEASE_SIGNING_KEY_PEM;
  try {
    assert(bundleDir && trustDir && outputDir && (process.argv.length === 5 || process.argv.length === 6));
    const context = { repo: process.env.GITHUB_REPOSITORY, tag: process.env.GITHUB_REF_NAME, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT };
    await signRelease({ bundleDir, trustDir, privateKey, context, outputDir, target });
    console.log('Publisher signature created and verified for the required release asset set.');
  } catch {
    // Do not serialize crypto exceptions/arguments from a secret-bearing process.
    console.error('Release signing refused; no completed authenticated bundle was retained.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
