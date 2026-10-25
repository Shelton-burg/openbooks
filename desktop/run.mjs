import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile, rename, unlink, stat, open} from 'node:fs/promises';
import {existsSync, appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, join, dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {makeBackup, verifyBackup, restoreBackup, listBackups, checkBackupRoot} from './backup.mjs';
import {authorize, readJson} from './security.mjs';
const install = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  app = join(install, 'app');
const home =
  process.env.OPENBOOKS_DESKTOP_HOME || join(process.env.LOCALAPPDATA || '', 'OpenBooks');
if (!process.env.LOCALAPPDATA && !process.env.OPENBOOKS_DESKTOP_HOME)
  throw new Error('A Windows user profile is required.');
const data = join(home, 'data'),
  lockPath = join(home, 'desktop.lock'),
  statePath = join(home, 'desktop-session.json'),
  settingsPath = join(home, 'desktop-settings.json'),
  logPath = join(home, 'desktop.log');
await mkdir(data, {recursive: true, mode: 0o700});
if ((await stat(logPath).catch(() => null))?.size > 5000000)
  await rename(logPath, logPath + '.previous').catch(() => {});
const log = (message) =>
  appendFileSync(logPath, new Date().toISOString() + ' ' + String(message).slice(0, 2000) + '\n', {
    mode: 0o600,
  });
const version = JSON.parse(await readFile(join(install, 'release.json'), 'utf8')).version;
let settings = await readFile(settingsPath, 'utf8')
  .then(JSON.parse)
  .catch((e) => {
    if (e.code === 'ENOENT') return {backupFolder: join(home, 'backups'), dailyBackups: true};
    throw e;
  });
const saveSettings = async () => {
  await writeFile(settingsPath + '.tmp', JSON.stringify(settings, null, 2), {mode: 0o600});
  await rename(settingsPath + '.tmp', settingsPath);
};
const configured = () => {
  if (!existsSync(join(data, 'books.sqlite'))) return false;
  const db = new DatabaseSync(join(data, 'books.sqlite'), {readOnly: true});
  try {
    return !!db.prepare('SELECT id FROM users LIMIT 1').get();
  } finally {
    db.close();
  }
};
function openBrowser(url) {
  if (process.env.OPENBOOKS_DESKTOP_NO_BROWSER === '1') return;
  if (process.platform !== 'win32') return;
  const p = spawn(
    join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'),
    ['url.dll,FileProtocolHandler', url],
    {detached: true, stdio: 'ignore', windowsHide: true},
  );
  p.on('error', (e) => log('Could not open browser: ' + e.message));
  p.unref();
}
async function previousInstance() {
  try {
    const s = JSON.parse(await readFile(statePath, 'utf8'));
    if (
      !Number.isInteger(s.port) ||
      s.port < 1024 ||
      s.port > 65535 ||
      !/^[-\w]{43}$/.test(s.token)
    )
      return null;
    const r = await fetch('http://127.0.0.1:' + s.port + '/status', {
      headers: {'x-desktop-token': s.token},
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok && (await r.json()).instance === s.instance) return s;
  } catch {}
  return null;
}
async function command(s, path, body = {}) {
  const origin = 'http://127.0.0.1:' + s.port;
  const r = await fetch(origin + path, {
    method: 'POST',
    headers: {origin, 'Content-Type': 'application/json', 'x-desktop-token': s.token},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || 'Desktop action failed.');
  return result;
}
const mode = process.argv[2] || '';
if (!['', '--controls', '--stop', '--before-update', '--startup'].includes(mode))
  throw new Error('Unknown desktop command.');
let existing = await previousInstance();
if (existing) {
  if (mode === '--stop' || mode === '--before-update') {
    await command(existing, '/quit');
    for (let n = 0; n < 100 && existsSync(lockPath); n++)
      await new Promise((r) => setTimeout(r, 100));
    if (existsSync(lockPath))
      throw new Error('OpenBooks did not stop. Close it before updating.');
  } else {
    if (mode !== '--startup')
      openBrowser(
        mode === '--controls'
          ? 'http://127.0.0.1:' + existing.port + '/#' + existing.token
          : existing.openUrl,
      );
    process.exit(0);
  }
}
let lock;
try {
  lock = await open(lockPath, 'wx', 0o600);
} catch (e) {
  if (e.code !== 'EEXIST') throw e;
  const prior = await readFile(lockPath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (!prior?.pid) throw new Error('Another startup may be in progress. Try again shortly.');
  let alive = true;
  try {
    process.kill(prior.pid, 0);
  } catch (e) {
    if (e.code === 'ESRCH') alive = false;
  }
  if (alive) {
    for (let n = 0; n < 40; n++) {
      await new Promise((r) => setTimeout(r, 250));
      existing = await previousInstance();
      if (existing) {
        if (mode === '--stop' || mode === '--before-update')
          throw new Error('The application is starting. Wait and retry.');
        openBrowser(
          mode === '--controls'
            ? 'http://127.0.0.1:' + existing.port + '/#' + existing.token
            : existing.openUrl,
        );
        process.exit(0);
      }
    }
    throw new Error('Another OpenBooks process is still starting.');
  }
  await unlink(lockPath);
  lock = await open(lockPath, 'wx', 0o600);
}
await lock.writeFile(JSON.stringify({pid: process.pid}));
await lock.close();
let child = null,
  closing = false,
  busy = false,
  appOrigin = '',
  lastError = '',
  control,
  scheduledTimer;
const token = randomBytes(32).toString('base64url'),
  maintenanceToken = randomBytes(32).toString('base64url'),
  instance = randomBytes(16).toString('hex');
const env = () => {
  const e = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATH',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'LOCALAPPDATA',
  ])
    if (process.env[key]) e[key] = process.env[key];
  return {
    ...e,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    HOSTNAME: '127.0.0.1',
    PORT: String(appPort),
    APP_ORIGIN: appOrigin,
    DATA_DIR: data,
    MAINTENANCE_TOKEN: maintenanceToken,
  };
};
const appPort = Number(process.env.OPENBOOKS_DESKTOP_TEST_PORT || 38471);
if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535)
  throw new Error('Invalid application port.');
appOrigin = 'http://127.0.0.1:' + appPort;
async function stopApp() {
  if (!child) return;
  const p = child;
  child = null;
  const ended = new Promise((r) => p.once('exit', r));
  p.kill();
  await Promise.race([ended, new Promise((r) => setTimeout(r, 5000))]);
  if (p.exitCode === null && p.signalCode === null) {
    p.kill('SIGKILL');
    await Promise.race([ended, new Promise((r) => setTimeout(r, 3000))]);
  }
  if (p.exitCode === null && p.signalCode === null)
    throw new Error('The accounting process could not be stopped.');
}
async function startApp() {
  if (child) return;
  await new Promise((ok, no) => {
    const probe = createServer();
    probe.once('error', () =>
      no(
        new Error(
          'Port ' +
            appPort +
            ' is already in use. Close the other application and reopen OpenBooks.',
        ),
      ),
    );
    probe.listen(appPort, '127.0.0.1', () => probe.close(ok));
  });
  const p = spawn(process.execPath, [join(app, 'server.js')], {
    cwd: app,
    env: env(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child = p;
  p.stdout.on('data', (b) => log(b));
  p.stderr.on('data', (b) => log(b));
  let failed;
  p.on('error', (e) => {
    failed = e;
  });
  p.once('exit', (code) => {
    if (child === p) {
      child = null;
      if (!closing) {
        lastError =
          'The accounting service stopped. Reopen OpenBooks. See desktop.log for details.';
        log('Accounting process exited: ' + code);
      }
    }
  });
  for (let n = 0; n < 120; n++) {
    if (failed) throw failed;
    if (!child) throw new Error(lastError || 'Accounting service failed to start.');
    try {
      const r = await fetch(appOrigin + '/api/account', {signal: AbortSignal.timeout(700)});
      if (r.status === 401) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  await stopApp();
  throw new Error('Accounting service did not become ready.');
}
async function maintenance() {
  const r = await fetch(appOrigin + '/api/maintenance', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + maintenanceToken},
    signal: AbortSignal.timeout(180000),
  });
  const d = await r.json();
  if (!r.ok || d.results?.some((x) => x.status !== 'succeeded'))
    throw new Error(
      'Recurring drafts or business snapshot verification failed. Check Recovery centre.',
    );
  return d;
}
async function backupNow(reason = 'manual', runMaintenance = true) {
  const root = await checkBackupRoot(settings.backupFolder, data, install);
  let maintenanceError = '';
  if (runMaintenance && child) {
    try {
      await maintenance();
    } catch (e) {
      maintenanceError = e.message;
    }
  }
  const m = await makeBackup(data, root, {reason, version});
  settings.lastBackup = {id: m.id, createdAt: m.createdAt, folder: root};
  settings.lastBackupError = maintenanceError;
  await saveSettings();
  return {backup: m, warning: maintenanceError};
}
async function shutDown() {
  if (closing) return;
  closing = true;
  clearInterval(scheduledTimer);
  await stopApp();
  if (control) control.close();
  await unlink(statePath).catch(() => {});
  await unlink(lockPath).catch(() => {});
}
process.once('SIGTERM', () => shutDown().then(() => process.exit(0)));
process.once('SIGINT', () => shutDown().then(() => process.exit(0)));
try {
  if (mode === '--stop' || mode === '--before-update') {
    if (mode === '--before-update' && configured()) await backupNow('before-update', false);
    await shutDown();
    process.exit(0);
  }
  const html = await readFile(join(install, 'desktop', 'control.html'));
  const send = (res, status, obj) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(obj));
  };
  control = createServer(async (req, res) => {
    try {
      const host = '127.0.0.1:' + control.address().port;
      if (req.headers.host !== host) throw new Error('Invalid local host.');
      if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
        });
        res.end(html);
        return;
      }
      authorize(req, {host, token}, req.method !== 'GET');
      if (req.url === '/status' && req.method === 'GET') {
        send(res, 200, {
          instance,
          version,
          configured: configured(),
          appOrigin,
          running: !!child,
          busy,
          dataFolder: data,
          backupFolder: settings.backupFolder,
          dailyBackups: settings.dailyBackups,
          lastBackup: settings.lastBackup || null,
          lastError: lastError || settings.lastBackupError || '',
          backups: await listBackups(settings.backupFolder),
        });
        return;
      }
      if (req.method !== 'POST') {
        send(res, 404, {error: 'Not found'});
        return;
      }
      if (busy) {
        send(res, 409, {error: 'Another desktop operation is running. Wait for it to finish.'});
        return;
      }
      const body = await readJson(req);
      busy = true;
      try {
        if (req.url === '/setup') {
          if (configured()) throw new Error('Setup is already complete.');
          if (body.password !== body.confirm) throw new Error('Passwords do not match.');
          await new Promise((ok, no) => {
            const p = spawn(process.execPath, [join(install, 'desktop', 'bootstrap.mjs')], {
              cwd: app,
              env: env(),
              stdio: ['pipe', 'pipe', 'pipe'],
              windowsHide: true,
            });
            let result = '';
            p.stdout.on('data', (b) => (result += b));
            p.stderr.resume();
            p.on('error', no);
            p.on('close', (code) => {
              let d;
              try {
                d = JSON.parse(result);
              } catch {
                return no(new Error('Setup could not complete.'));
              }
              code === 0 ? ok() : no(new Error(d.error));
            });
            p.stdin.end(
              JSON.stringify({
                name: body.name,
                email: body.email,
                business: body.business,
                password: body.password,
              }),
            );
          });
          await startApp();
          await writeState();
          send(res, 200, {ok: true, url: appOrigin});
        } else if (req.url === '/backup') {
          if (!configured()) throw new Error('Complete setup first.');
          const result = await backupNow();
          lastError = '';
          send(res, 200, {ok: true, ...result});
        } else if (req.url === '/settings') {
          const root = await checkBackupRoot(String(body.backupFolder || ''), data, install);
          settings.backupFolder = root;
          settings.dailyBackups = body.dailyBackups === true;
          await saveSettings();
          send(res, 200, {ok: true});
        } else if (req.url === '/restore') {
          if (body.confirm !== 'RESTORE') throw new Error('Type RESTORE to confirm.');
          if (!/^[\dTZ-]+-[a-f0-9]{8}$/.test(body.id || ''))
            throw new Error('Choose a saved backup.');
          const folder = join(settings.backupFolder, body.id);
          await verifyBackup(folder);
          await stopApp();
          try {
            if (configured()) await backupNow('before-restore', false);
            const result = await restoreBackup(data, folder);
            settings.lastRestore = {...result, at: new Date().toISOString()};
            await saveSettings();
            await startApp();
            send(res, 200, {ok: true, ...result});
          } catch (e) {
            await startApp().catch(() => {});
            throw e;
          }
        } else if (req.url === '/restart') {
          await stopApp();
          await startApp();
          lastError = '';
          send(res, 200, {ok: true, url: appOrigin});
        } else if (req.url === '/quit') {
          send(res, 200, {ok: true});
          setTimeout(() => shutDown().then(() => process.exit(0)), 200);
        } else send(res, 404, {error: 'Not found'});
      } finally {
        busy = false;
      }
    } catch (e) {
      lastError = e.message;
      log('Desktop action failed: ' + e.message);
      if (!res.headersSent) send(res, 400, {error: e.message});
      else res.end();
    }
  });
  await new Promise((ok, no) => {
    control.once('error', no);
    control.listen(0, '127.0.0.1', ok);
  });
  const controlsUrl = 'http://127.0.0.1:' + control.address().port + '/#' + token;
  async function writeState() {
    await writeFile(
      statePath,
      JSON.stringify({
        pid: process.pid,
        port: control.address().port,
        token,
        instance,
        openUrl: configured() ? appOrigin : controlsUrl,
      }),
      {mode: 0o600},
    );
  }
  if (configured()) await startApp();
  await writeState();
  await saveSettings();
  if (mode !== '--startup')
    openBrowser(mode === '--controls' || !configured() ? controlsUrl : appOrigin);
  async function automatic() {
    if (closing || busy || !configured() || !settings.dailyBackups) return;
    if (
      settings.lastBackup &&
      Date.now() - Date.parse(settings.lastBackup.createdAt) < 24 * 3600000
    )
      return;
    busy = true;
    try {
      await backupNow('automatic');
      lastError = '';
    } catch (e) {
      settings.lastBackupError = e.message;
      lastError = e.message;
      await saveSettings();
      log('Automatic backup failed: ' + e.message);
    } finally {
      busy = false;
    }
  }
  const first = setTimeout(automatic, 60000);
  first.unref();
  scheduledTimer = setInterval(automatic, 15 * 60000);
  log('Desktop service started, version ' + version);
} catch (e) {
  log('Startup failed: ' + e.message);
  await shutDown().catch(() => {});
  if (process.platform === 'win32' && !['--before-update', '--stop', '--startup'].includes(mode)) {
    const message =
      'OpenBooks could not start. Open ' + logPath + ' for details. ' + e.message;
    spawn(
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'msg.exe'),
      [process.env.USERNAME || '*', message],
      {windowsHide: true, stdio: 'ignore'},
    ).on('error', () => {});
  }
  console.error(e.message);
  process.exitCode = 1;
}
