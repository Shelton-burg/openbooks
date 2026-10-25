import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const version = '24.22.0',
  hash = 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3',
  root = resolve('.windows-tools'),
  name = 'node-v' + version + '-win-x64.zip',
  path = join(root, name);
await mkdir(root, {recursive: true});
let bytes = await readFile(path).catch(() => null);
if (!bytes) {
  const r = await fetch('https://nodejs.org/dist/v' + version + '/' + name, {
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error('Windows runtime download failed: ' + r.status);
  bytes = Buffer.from(await r.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== hash)
  throw new Error('Windows runtime checksum mismatch.');
await writeFile(path, bytes);
if (process.platform !== 'win32')
  throw new Error(
    'Checksum verified. Extract the ZIP with a trusted ZIP tool, then set NODE_WINDOWS_DIR to its extracted directory.',
  );
const r = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Expand-Archive -LiteralPath $env:TD_RUNTIME_ARCHIVE -DestinationPath $env:TD_RUNTIME_DEST -Force',
  ],
  {stdio: 'inherit', env: {...process.env, TD_RUNTIME_ARCHIVE: path, TD_RUNTIME_DEST: root}},
);
if (r.status !== 0) throw new Error('Runtime extraction failed.');
console.log('Verified Windows runtime: ' + join(root, 'node-v' + version + '-win-x64'));
