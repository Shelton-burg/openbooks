import {readdirSync, readFileSync, lstatSync} from 'node:fs';
import {join, relative} from 'node:path';
const ignored = new Set([
  'node_modules',
  '.next',
  '.data',
  '.git',
  'demo-dist',
  'dist',
  'windows-release',
  '.windows-tools',
]);
const blocked = [
  /appgprj_[a-f0-9]+/,
  /sk-proj-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
];
const issues = [];
let checked = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (ignored.has(name) || name.endsWith('.tsbuildinfo')) continue;
    const p = join(dir, name),
      s = lstatSync(p);
    if (s.isSymbolicLink()) throw new Error('Unexpected symlink: ' + p);
    if (s.isDirectory()) {
      walk(p);
      continue;
    }
    if (name === 'xero-reference-data.ts') {
      issues.push(p + ' private reference data');
      continue;
    }
    if (name.startsWith('.env') && name !== '.env.example') {
      issues.push(p + ' environment file');
      continue;
    }
    // Site photo and screenshot assets for the GitHub Pages landing page are intentional.
    if (p.includes(join('site', 'photos')) || p.includes(join('site', 'screenshots'))) {
      continue;
    }
    if (/\.(sqlite|db|zip|tar|png|jpg|jpeg|pdf)$/i.test(name)) {
      issues.push(p + ' unexpected data/binary file');
      continue;
    }
    const value = readFileSync(p, 'utf8');
    if (
      p !== join(process.cwd(), 'scripts/release-check.mjs') &&
      blocked.some((r) => r.test(value))
    )
      issues.push(relative(process.cwd(), p) + ' contains private-source markers');
    checked++;
  }
}
walk(process.cwd());
if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Release content check passed (' +
      checked +
      ' source files). Runtime data, environment files and build output must also be excluded from release archives.',
  );
