// Test-only helper. Keys exist only in temporary fixture directories.
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { assetNames, metadataNames, createEnvelope, signEnvelope, publicKeyIdentity, digestBytes, IDENTITY } from './native-release-auth.mjs';

export const COMMIT = 'c'.repeat(40);
export async function provision(root, privateFile, targets = [IDENTITY.target]) {
  const pair = generateKeyPairSync('ed25519');
  const publicPem = pair.publicKey.export({ format: 'pem', type: 'spki' });
  const privatePem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
  const id = publicKeyIdentity(publicPem), trust = path.join(root, 'release/trust');
  await mkdir(trust, { recursive: true });
  await writeFile(privateFile, privatePem, { mode: 0o600 });
  await writeFile(path.join(trust, `${id}.pem`), publicPem);
  await writeFile(path.join(trust, 'policy'), `ShadowCode-Release-Trust-v1\nrepository=${IDENTITY.repository}\nrepository-id=${IDENTITY.repositoryId}\nowner-id=${IDENTITY.ownerId}\ntarget=${targets.join(',')}\nchannel=stable\nminimum-epoch=1\nminimum-version=0.28.0\nkeys=ed25519-spki-sha256\nkey=1\t${id}\t0.28.0\t999.999.999\n`);
  await writeFile(path.join(root, 'release/install-policy'), 'ShadowCode-Install-Policy-v1\nfirst-authenticated-version=0.28.0\n');
}
const FIXTURE_TARGETS = { amd64: 'x86_64-unknown-linux-gnu', aarch64: 'aarch64-unknown-linux-gnu' };
// The AppImage name selects the signed target unless a test overrides it.
export async function signFixture(file, privateFile, target) {
  const match = /^ShadowCode_(\d+\.\d+\.\d+)_(amd64|aarch64)\.AppImage$/.exec(path.basename(file));
  if (!match) throw new Error('Invalid fixture filename');
  const version = match[1];
  target ??= FIXTURE_TARGETS[match[2]];
  const directory = path.dirname(file), assets = {};
  for (const [role, name] of assetNames(version, target)) {
    const assetFile = path.join(directory, name);
    if (role !== 'appimage') await writeFile(assetFile, `Fixture ${role} ${version}\n`);
    assets[name] = digestBytes(await readFile(assetFile));
  }
  // Release asset names: aarch64 metadata carries its target suffix.
  const meta = metadataNames(target);
  await writeFile(path.join(directory, meta.sums), Object.entries(assets).map(([name, hash]) => `${hash}  ${name}\n`).join(''));
  await writeFile(path.join(directory, meta.manifest), `${JSON.stringify({ schema: 1, tag: `v${version}`, commit: COMMIT, target, assets, fixture_only: true }, null, 2)}\n`);
  const privatePem = await readFile(privateFile);
  const envelope = await createEnvelope({ bundleDir: directory, version, commit: COMMIT, keyId: publicKeyIdentity(privatePem), keyEpoch: 1, target });
  await writeFile(path.join(directory, meta.auth), envelope);
  await writeFile(path.join(directory, meta.signature), signEnvelope(envelope, privatePem));
}
if (process.argv[2] === 'provision') await provision(process.argv[3], process.argv[4], process.argv[5]?.split(','));
if (process.argv[2] === 'sign') await signFixture(process.argv[3], process.argv[4]);
