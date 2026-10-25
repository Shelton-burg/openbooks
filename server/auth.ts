import {headers as requestHeaders} from 'next/headers';
import {workspaceContext} from './context.mjs';
import {session, tokenFromCookie} from './auth-core.mjs';
export type Access = {
  userId: string;
  workspaceId: string;
  name: string;
  email: string;
  role: 'owner' | 'bookkeeper' | 'viewer';
  businessName: string;
};
export function context() {
  return workspaceContext.getStore() as Access | undefined;
}
export async function signedIn() {
  const h = await requestHeaders();
  return session(tokenFromCookie(h.get('cookie') || '')) as Access | null;
}
export async function headers() {
  const ctx = context();
  const h = new Headers();
  if (ctx) {
    h.set('oai-authenticated-user-id', ctx.workspaceId);
    h.set('oai-authenticated-user-email', ctx.email);
  }
  return h;
}
export function checkOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new Error('APP_ORIGIN is not configured.');
  if (
    request.headers.get('origin') !== new URL(expected).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new Error('Invalid request origin.');
}
export function withWorkspace(fn: Function, write = false) {
  return async (request: Request) => {
    try {
      if (context()) return await fn(request);
      const h = request?.headers || (await requestHeaders());
      const ctx = session(tokenFromCookie(h.get('cookie') || '')) as Access | null;
      if (!ctx) return Response.json({error: 'Please sign in.'}, {status: 401});
      if (write) {
        if (!request) throw new Error('Request required.');
        checkOrigin(request);
        if (ctx.role === 'viewer')
          return Response.json({error: 'Your access is read-only.'}, {status: 403});
      }
      return await workspaceContext.run(ctx, () => fn(request));
    } catch (e) {
      return Response.json(
        {error: (e as Error).message},
        {status: 403, headers: {'Cache-Control': 'no-store'}},
      );
    }
  };
}
