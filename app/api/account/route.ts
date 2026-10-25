import {z} from 'zod';
import {checkOrigin, type Access} from '@/server/auth';
import {rawDatabase} from '@/server/storage.mjs';
import {
  cookieName,
  signIn,
  session,
  tokenFromCookie,
  logout,
  changeWorkspace,
  createWorkspace,
  invite,
  acceptInvitation,
  changeRole,
  revokeInvitation,
  changePassword,
  consumeLimit,
} from '@/server/auth-core.mjs';
export const dynamic = 'force-dynamic';
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(v, {status, headers: {'Cache-Control': 'no-store', ...headers}});
function cookie(token: string) {
  return (
    cookieName +
    '=' +
    token +
    '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' +
    (token ? 604800 : 0) +
    (process.env.APP_ORIGIN?.startsWith('https://') ? '; Secure' : '')
  );
}
export async function GET(request: Request) {
  const token = tokenFromCookie(request.headers.get('cookie') || ''),
    ctx = session(token) as Access | null;
  if (!ctx) return json({error: 'Please sign in.'}, 401);
  const db = rawDatabase();
  return json({
    user: ctx,
    workspaces: db
      .prepare(
        'SELECT w.id,w.name,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.name',
      )
      .all(ctx.userId),
    members:
      ctx.role === 'owner'
        ? db
            .prepare(
              'SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?',
            )
            .all(ctx.workspaceId)
        : [],
    invitations:
      ctx.role === 'owner'
        ? db
            .prepare(
              'SELECT hash,email,role,expires_at FROM invitations WHERE workspace_id=? AND expires_at>?',
            )
            .all(ctx.workspaceId, Date.now())
        : [],
    audit:
      ctx.role === 'owner'
        ? db
            .prepare(
              'SELECT action,detail,created_at FROM access_audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30',
            )
            .all(ctx.workspaceId)
        : [],
  });
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json'))
      return json({error: 'JSON required.'}, 415);
    const raw = await request.text();
    if (raw.length > 5000) return json({error: 'Request too large.'}, 413);
    const b = JSON.parse(raw),
      token = tokenFromCookie(request.headers.get('cookie') || '');
    if (b.action === 'login' || b.action === 'accept') {
      consumeLimit('authentication-global', 200, 15);
      const input = z
        .object({email: z.string().max(200), password: z.string().min(1).max(128)})
        .parse(b);
      if (b.action === 'accept')
        acceptInvitation({
          ...input,
          token: z.string().length(43).parse(b.token),
          name: z.string().min(1).max(100).parse(b.name),
        });
      const next = signIn(input.email, input.password);
      return json({ok: true}, 200, {'Set-Cookie': cookie(next)});
    }
    const ctx = session(token) as Access | null;
    if (!ctx) return json({error: 'Please sign in.'}, 401);
    if (b.action === 'logout') {
      logout(token);
      return json({ok: true}, 200, {'Set-Cookie': cookie('')});
    }
    if (b.action === 'switch') {
      changeWorkspace(token, z.string().uuid().parse(b.id));
      return json({ok: true});
    }
    if (b.action === 'create') {
      const id = createWorkspace(ctx, z.string().trim().min(1).max(160).parse(b.name));
      changeWorkspace(token, id);
      return json({ok: true});
    }
    if (b.action === 'invite') {
      consumeLimit('invite-create:' + ctx.workspaceId, 20, 60);
      const invitation = invite(
        ctx,
        z.object({email: z.string(), role: z.enum(['bookkeeper', 'viewer'])}).parse(b),
      );
      return json({url: process.env.APP_ORIGIN + '/login#invite=' + invitation});
    }
    if (b.action === 'role') {
      changeRole(
        ctx,
        z.string().uuid().parse(b.id),
        z.enum(['bookkeeper', 'viewer', 'remove']).parse(b.role),
      );
      return json({ok: true});
    }
    if (b.action === 'revoke') {
      revokeInvitation(
        ctx,
        z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(b.hash),
      );
      return json({ok: true});
    }
    if (b.action === 'password') {
      consumeLimit('password:' + ctx.userId, 10, 15);
      changePassword(
        ctx,
        z.string().max(128).parse(b.current),
        z.string().max(128).parse(b.password),
      );
      return json({ok: true}, 200, {'Set-Cookie': cookie('')});
    }
    return json({error: 'Unknown account action.'}, 400);
  } catch (e) {
    return json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues.map((x) => x.message).join('. ')
            : (e as Error).message,
      },
      400,
    );
  }
}
