import {cp, mkdir, readFile, writeFile, readdir, lstat, rm, copyFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(fileURLToPath(new URL('../', import.meta.url))),
  target = resolve(root, 'windows-release', 'payload');
const runtime = process.env.NODE_WINDOWS_DIR;
if (!runtime) throw new Error('Set NODE_WINDOWS_DIR to the verified Windows Node distribution.');
const version = JSON.parse(await readFile(join(root, 'package.json'))).version;
if (!(await lstat(join(root, '.next/standalone/server.js'))).isFile())
  throw new Error('Run npm run build first.');
await rm(target, {recursive: true, force: true});
await mkdir(target, {recursive: true});
await cp(join(root, '.next/standalone'), join(target, 'app'), {
  recursive: true,
  dereference: true,
});
await cp(join(root, '.next/static'), join(target, 'app/.next/static'), {recursive: true});
await cp(join(root, 'public'), join(target, 'app/public'), {recursive: true});
await cp(join(root, 'drizzle'), join(target, 'app/drizzle'), {recursive: true});
await cp(join(root, 'desktop'), join(target, 'desktop'), {recursive: true});
await mkdir(join(target, 'server'));
for (const name of ['auth-core.mjs', 'storage.mjs', 'context.mjs'])
  await copyFile(join(root, 'server', name), join(target, 'server', name));
await mkdir(join(target, 'runtime'));
await copyFile(join(runtime, 'node.exe'), join(target, 'runtime/node.exe'));
await copyFile(join(runtime, 'LICENSE'), join(target, 'runtime/LICENSE'));
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
  await copyFile(join(root, name), join(target, name));
await copyFile(join(root, 'docs/WINDOWS-START-HERE.html'), join(target, 'WINDOWS-START-HERE.html'));
await writeFile(
  join(target, 'release.json'),
  JSON.stringify(
    {
      product: 'OpenBooks',
      version,
      target: 'win32-x64',
      node: '24.22.0',
      beta: true,
    },
    null,
    2,
  ),
);
// The app uses local plain images; Next image optimization is disabled.
// Native image/compiler dependencies are unnecessary in the production runtime,
// but @next/env is plain JS and required by next/config.js — keep it.
const nm = join(target, 'app/node_modules');
for (const name of ['sharp', '@img']) await rm(join(nm, name), {recursive: true, force: true});
const nxt = join(nm, '@next');
if (await lstat(nxt).catch(() => null)) {
  for (const item of await readdir(nxt)) {
    if (item.startsWith('swc') || item === 'eslint-plugin-next')
      await rm(join(nxt, item), {recursive: true, force: true});
  }
}
// Preserve package notices even when Next's runtime tracing omits them.
async function notices(dir, source) {
  for (const item of await readdir(dir, {withFileTypes: true})) {
    if (item.isDirectory()) await notices(join(dir, item.name), join(source, item.name));
  }
  if (await lstat(join(dir, 'package.json')).catch(() => null)) {
    for (const name of await readdir(source).catch(() => [])) {
      if (
        /^(licen[cs]e|copying|notice|authors)([.-]|$)/i.test(name) &&
        (await lstat(join(source, name))).isFile()
      )
        await copyFile(join(source, name), join(dir, name));
    }
  }
}
await notices(nm, join(root, 'node_modules'));
await cp(join(root, 'vendor'), join(target, 'vendor'), {recursive: true});
async function verify(dir) {
  for (const item of await readdir(dir, {withFileTypes: true})) {
    const p = join(dir, item.name);
    if (item.isSymbolicLink()) throw new Error('Non-portable symlink: ' + p);
    if (item.isDirectory()) await verify(p);
    else if (item.name === '.env' || /\.sqlite(?:-wal|-shm)?$/.test(item.name))
      throw new Error('Private runtime data in installer');
  }
}
await verify(target);
console.log('Windows payload staged: ' + target);
