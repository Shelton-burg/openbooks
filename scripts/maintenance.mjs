const origin = process.env.APP_ORIGIN,
  token = process.env.MAINTENANCE_TOKEN;
if (!origin || !token || token.length < 32)
  throw new Error('Set APP_ORIGIN and a MAINTENANCE_TOKEN of at least 32 characters.');
const url = new URL('/api/maintenance', origin);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('Use HTTPS for remote maintenance.');
const headers = {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};
const run = await fetch(url, {
  method: 'POST',
  headers,
  body: '{}',
  redirect: 'error',
  signal: AbortSignal.timeout(240000),
});
const result = await run.json();
console.log(JSON.stringify({step: 'run', status: run.status, ...result}));
const check = await fetch(url, {headers, redirect: 'error', signal: AbortSignal.timeout(30000)}),
  saved = await check.json(),
  today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
console.log(JSON.stringify({step: 'readback', ...saved}));
if (
  !run.ok ||
  !check.ok ||
  !saved.results ||
  saved.results.some((r) => r.latest?.date !== today || r.latest?.status !== 'succeeded')
)
  process.exitCode = 1;
