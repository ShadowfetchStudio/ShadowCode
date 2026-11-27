import assert from 'node:assert/strict';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digest } from './native-release-verification.mjs';

// Platform jobs hand off immutable Actions artifacts. Validate each sidecar
// against the actual files before deriving any package-manager pins.
export async function platformAssets({ directory, version, output, verifyInstaller }) {
  const prefix = `ShadowCode_${version}_`;
  const groups = {
    macos: ['aarch64.dmg', 'x64.dmg'],
    flatpak: ['x86_64.flatpak', 'aarch64.flatpak'],
    windows: ['x64-setup.exe', 'busybox-w32-source.tar.gz'],
  };
  const expected = new Map();
  const wanted = Object.entries(groups).flatMap(([group, names]) =>
    [...names, group + '.sha256'].map(name => prefix + name));
  assert.deepEqual((await readdir(directory)).sort(), wanted.sort(), 'Unexpected or missing platform release files');
  for (const name of wanted) {
    const file = path.join(directory, name);
    const stat = await lstat(file);
    assert(stat.isFile() && stat.size > 0, `Invalid release file ${name}`);
    if (name.endsWith('.sha256')) assert(stat.size <= 1024, 'Oversized checksum file');
    expected.set(name, { file, hash: await digest(file) });
  }
  for (const [group, suffixes] of Object.entries(groups)) {
    const sums = await readFile(expected.get(prefix + group + '.sha256').file, 'utf8');
    const lines = [];
    for (const suffix of suffixes) {
      const name = prefix + suffix;
      const asset = expected.get(name);
      lines.push(asset.hash + '  ' + name);
      if (!suffix.endsWith('.tar.gz')) await verifyInstaller(asset.file, 'release-' + group);
    }
    assert.deepEqual(sums.trimEnd().split('\n').sort(), lines.sort(), `Invalid ${group} checksum list`);
  }
  const hash = suffix => expected.get(prefix + suffix).hash;
  const save = async (name, content) => {
    const file = path.join(output, name);
    await writeFile(file, content, { flag: 'wx' });
    expected.set(name, { file, hash: await digest(file) });
  };
  const cask = await readFile(new URL('../Casks/shadowcode.rb', import.meta.url), 'utf8');
  const replace = (body, pattern, value) => {
    assert.equal([...body.matchAll(pattern)].length, 1, 'Package manifest format changed: ' + pattern);
    return body.replace(pattern, value);
  };
  let body = replace(cask, /^  version "[\d.]+"$/gm, `  version "${version}"`);
  body = replace(body, /sha256 arm: "[a-f0-9]{64}"/g, `sha256 arm: "${hash('aarch64.dmg')}"`);
  await save('shadowcode.rb', replace(body, /intel: "[a-f0-9]{64}"/g, `intel: "${hash('x64.dmg')}"`));
  for (const suffix of ['installer', 'locale.en-US', '']) {
    const name = ['ShadowfetchStudio.ShadowCode', suffix, 'yaml'].filter(Boolean).join('.');
    let yaml = await readFile(new URL('../packaging/winget/' + name, import.meta.url), 'utf8');
    yaml = replace(yaml, /^PackageVersion: [\d.]+$/gm, 'PackageVersion: ' + version);
    if (suffix === 'installer') {
      yaml = replace(yaml, /^    InstallerUrl: .*$/gm,
        '    InstallerUrl: https://github.com/ShadowfetchStudio/ShadowCode/releases/download/v' + version + '/' + prefix + 'x64-setup.exe');
      yaml = replace(yaml, /^    InstallerSha256: [0-9A-F]{64}$/gm, '    InstallerSha256: ' + hash('x64-setup.exe').toUpperCase());
    } else if (suffix) {
      yaml = replace(yaml, /^ReleaseNotesUrl: .*$/gm, 'ReleaseNotesUrl: https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v' + version);
    }
    await save(name, yaml);
  }
  return expected;
}
