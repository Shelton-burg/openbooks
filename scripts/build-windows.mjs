import {spawnSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
const root = process.cwd(),
  payload = resolve('windows-release/payload'),
  out = resolve('windows-release');
const version = JSON.parse(await readFile('package.json')).version;
const makensis =
  process.env.MAKENSIS ||
  (process.platform === 'win32' ? 'C:\\Program Files (x86)\\NSIS\\makensis.exe' : 'makensis');
await mkdir(out, {recursive: true});
function run(file, args) {
  const r = spawnSync(file, args, {stdio: 'inherit', cwd: root});
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Build step failed: ' + file);
}
const flag = process.platform === 'win32' ? '/' : '-';
run(makensis, [
  flag + 'DOUTPUT=' + join(payload, 'OpenBooks.exe'),
  resolve('desktop/windows/launcher.nsi'),
]);
const name = 'OpenBooks-Setup-' + version + '-x64.exe',
  path = join(out, name);
run(makensis, [
  flag + 'DPAYLOAD=' + payload,
  flag + 'DVERSION=' + version,
  flag + 'DOUTPUT=' + path,
  resolve('desktop/windows/installer.nsi'),
]);
const sum = createHash('sha256')
  .update(await readFile(path))
  .digest('hex');
await writeFile(join(out, 'SHA256SUMS.txt'), sum + '  ' + name + '\n');
console.log('Installer built: ' + path + '\nSHA256 ' + sum);
