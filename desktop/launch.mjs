import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const mode = process.argv[2] || '';
if (!['', '--controls', '--startup', '--stop'].includes(mode))
  throw new Error('Invalid launcher command.');
const run = fileURLToPath(new URL('./run.mjs', import.meta.url));
if (mode === '--stop') {
  const p = spawn(process.execPath, [run, mode], {windowsHide: true, stdio: 'inherit'});
  p.on('error', () => process.exit(1));
  p.on('exit', (code) => process.exit(code || 0));
} else {
  const p = spawn(process.execPath, [run, ...(mode ? [mode] : [])], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  let failed = false;
  p.on('error', () => {
    failed = true;
  });
  p.on('exit', (code) => {
    if (code) failed = true;
  });
  p.unref();
  let ready = false;
  const home =
    process.env.TRADEDESK_DESKTOP_HOME || join(process.env.LOCALAPPDATA || '', 'TradeDesk Books');
  for (let n = 0; n < 180 && !failed; n++) {
    try {
      const s = JSON.parse(await readFile(join(home, 'desktop-session.json'), 'utf8'));
      const r = await fetch('http://127.0.0.1:' + s.port + '/status', {
        headers: {'x-desktop-token': s.token},
        signal: AbortSignal.timeout(500),
      });
      if (r.ok && (await r.json()).instance === s.instance) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) {
    console.error(
      'TradeDesk Books could not start. Open ' +
        join(home, 'desktop.log') +
        ' for details. Another application may be using port 38471.',
    );
    process.exitCode = 1;
  }
}
