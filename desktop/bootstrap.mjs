// Runs in a short-lived process so SQLite handles close before desktop restoration.
import {bootstrap} from '../server/auth-core.mjs';
let body = '';
for await (const chunk of process.stdin) {
  body += chunk;
  if (body.length > 8000) throw new Error('Setup request too large.');
}
try {
  bootstrap(JSON.parse(body));
  process.stdout.write(JSON.stringify({ok: true}));
} catch (e) {
  process.stdout.write(JSON.stringify({error: e.message}));
  process.exitCode = 1;
}
