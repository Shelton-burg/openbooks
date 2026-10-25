import {timingSafeEqual} from 'node:crypto';
import {rawDatabase} from '@/server/storage.mjs';
import {withWorkspace, context} from '@/server/auth';
import {workspaceContext} from '@/server/context.mjs';
import {state} from '@/server/books-state';
import {maintain} from '@/server/maintenance';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) =>
  Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
function service(request: Request) {
  const key = process.env.MAINTENANCE_TOKEN;
  if (!key || key.length < 32) return false;
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  return token.length === key.length && timingSafeEqual(Buffer.from(token), Buffer.from(key));
}
export async function GET(request: Request) {
  if (service(request)) {
    const rows = rawDatabase().prepare('SELECT id,name FROM workspaces ORDER BY id').all();
    const results = [];
    for (const row of rows) {
      const s = await state(String(row.id));
      results.push({
        workspaceId: row.id,
        name: row.name,
        latest: s.events.filter((e) => e.kind === 'maintenance_result').at(-1)?.payload || null,
      });
    }
    return json({results});
  }
  return withWorkspace(async () => {
    const s = await state(context()!.workspaceId);
    return json({
      enabled: !!process.env.MAINTENANCE_TOKEN,
      latest: s.events.filter((e) => e.kind === 'maintenance_result').at(-1)?.payload || null,
    });
  })(request);
}
export async function POST(request: Request) {
  if (service(request)) {
    const workspaces = rawDatabase().prepare('SELECT id FROM workspaces ORDER BY id').all(),
      results = [];
    for (const row of workspaces)
      results.push(
        await workspaceContext.run(
          {workspaceId: row.id, userId: 'system', name: 'Scheduled maintenance', role: 'owner'},
          () => maintain(String(row.id)),
        ),
      );
    return json({results}, results.some((r) => r.status === 'failed') ? 207 : 200);
  }
  return withWorkspace(async () => {
    const ctx = context()!;
    if (ctx.role !== 'owner') return json({error: 'Only an owner can run maintenance.'}, 403);
    const result = await maintain(ctx.workspaceId);
    return json(result, result.status === 'failed' ? 500 : 200);
  }, true)(request);
}
