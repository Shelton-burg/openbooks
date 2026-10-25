import {createInterface} from 'node:readline/promises';
import {spawnSync} from 'node:child_process';
export async function question(label, secret = false) {
  if (secret && !process.stdin.isTTY) throw new Error('A terminal is required for password entry.');
  const rl = createInterface({input: process.stdin, output: process.stdout});
  if (secret) spawnSync('stty', ['-echo'], {stdio: 'inherit'});
  try {
    return await rl.question(label);
  } finally {
    if (secret) {
      spawnSync('stty', ['echo'], {stdio: 'inherit'});
      process.stdout.write('\n');
    }
    rl.close();
  }
}
