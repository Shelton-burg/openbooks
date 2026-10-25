import {timingSafeEqual} from 'node:crypto';
export function authorize(request, {host, token}, write = false) {
  if (request.headers.host !== host) throw new Error('Invalid local host.');
  const value = request.headers['x-desktop-token'];
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value) !== Buffer.byteLength(token) ||
    !timingSafeEqual(Buffer.from(value), Buffer.from(token))
  )
    throw new Error('Open Desktop controls from the Start menu.');
  if (write && request.headers.origin !== 'http://' + host)
    throw new Error('Invalid request origin.');
  if (request.headers['sec-fetch-site'] === 'cross-site')
    throw new Error('Cross-site request denied.');
}
export async function readJson(request) {
  if (!String(request.headers['content-type']).startsWith('application/json'))
    throw new Error('JSON request required.');
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 8000) throw new Error('Request too large.');
  }
  return JSON.parse(raw || '{}');
}
