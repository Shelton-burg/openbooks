import {withWorkspace} from '@/server/auth';
import {headers} from '@/server/auth';
import {env} from '@/server/storage';
import {db} from '@/db';
import {state} from '@/server/books-state';
import {emailDraft, emailHtml} from '@/lib/invoicing';
export const dynamic = 'force-dynamic';
const json = (x: unknown, status = 200) =>
  Response.json(x, {status, headers: {'Cache-Control': 'private, no-store'}});
const cfg = () => env as unknown as {RESEND_API_KEY?: string; EMAIL_FROM?: string};
async function owner() {
  const id = (await headers()).get('oai-authenticated-user-id');
  if (!id) throw new Error('SIGN_IN');
  return id;
}
const event = (uid: string, key: string, kind: string, payload: unknown) =>
  db()
    .prepare(
      'INSERT INTO book_events(id,owner,event_key,kind,payload,created_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(crypto.randomUUID(), uid, key, kind, JSON.stringify(payload), new Date().toISOString());
async function GETImpl() {
  try {
    await owner();
    return json({configured: !!(cfg().RESEND_API_KEY && cfg().EMAIL_FROM)});
  } catch {
    return json({error: 'Please sign in.'}, 401);
  }
}
async function POSTImpl(request: Request) {
  try {
    const uid = await owner();
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (request.headers.get('origin') &&
        request.headers.get('origin') !== new URL(process.env.APP_ORIGIN || request.url).origin)
    )
      return json({error: 'Invalid origin.'}, 403);
    const raw = await request.text();
    if (raw.length > 10000) return json({error: 'Request too large.'}, 413);
    const b = JSON.parse(raw),
      s = await state(uid),
      c = cfg();
    if (b.action === 'prepare') {
      const draft = emailDraft(s, b);
      await db().batch([event(uid, 'email:' + draft.id, 'email_prepared', draft)]);
      return json({draft, state: await state(uid)});
    }
    const e = s.events.find((e) => e.kind === 'email_prepared' && e.payload.id === b.id);
    if (!e) throw new Error('Prepare the email first.');
    const p = e.payload,
      last = s.events
        .filter((e) => e.kind === 'email_status' && e.payload.id === p.id)
        .at(-1)?.payload;
    if (b.action === 'status') {
      if (!last?.providerId || !c.RESEND_API_KEY)
        throw new Error('No provider delivery record is available yet.');
      const r = await fetch(
        'https://api.resend.com/emails/' + encodeURIComponent(last.providerId),
        {
          headers: {Authorization: 'Bearer ' + c.RESEND_API_KEY},
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!r.ok) throw new Error('Could not check delivery status.');
      const data: any = await r.json();
      await db().batch([
        event(uid, 'email-status:' + crypto.randomUUID(), 'email_status', {
          id: p.id,
          providerId: last.providerId,
          status: data.last_event || 'accepted',
        }),
      ]);
      return json({state: await state(uid)});
    }
    if (b.action !== 'send' || b.confirmed !== true)
      throw new Error('Review and confirm the recipient and email before sending.');
    if (last?.providerId) return json({state: s});
    if (!c.RESEND_API_KEY || !c.EMAIL_FROM)
      return json(
        {error: 'Email delivery needs a configured Resend account and verified sender.'},
        503,
      );
    if (Date.now() - Date.parse(p.preparedAt) > 23 * 3600000)
      throw new Error(
        'This prepared email expired. Check the delivery provider before preparing another copy.',
      );
    if (emailDraft(s, p).signature !== p.signature)
      throw new Error('The invoice, statement or recipient changed. Prepare a fresh email.');
    // Durable snapshot plus stable provider idempotency key makes retries safe within its 24-hour window.
    await db().batch([
      event(uid, 'email-attempt:' + crypto.randomUUID(), 'email_status', {
        id: p.id,
        status: 'sending',
      }),
    ]);
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + c.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'tradedesk-' + uid + '-' + p.id,
        },
        body: JSON.stringify({
          from: c.EMAIL_FROM,
          to: [p.to],
          subject: p.subject,
          text: p.text,
          html: emailHtml(p.text),
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        await db().batch([
          event(uid, 'email-status:' + crypto.randomUUID(), 'email_status', {
            id: p.id,
            status: 'failed',
            detail: 'Provider rejected request (' + r.status + ').',
          }),
        ]);
        return json(
          {
            error: 'Email provider rejected the message. Check sender configuration and retry.',
            state: await state(uid),
          },
          502,
        );
      }
      const result: any = await r.json();
      if (!result.id) throw new Error('Missing provider ID');
      await db().batch([
        event(uid, 'email-status:' + crypto.randomUUID(), 'email_status', {
          id: p.id,
          status: 'accepted',
          providerId: result.id,
        }),
      ]);
      return json({state: await state(uid)});
    } catch {
      await db().batch([
        event(uid, 'email-status:' + crypto.randomUUID(), 'email_status', {
          id: p.id,
          status: 'delivery_unknown',
          detail:
            'Connection interrupted. Retry this same prepared message within 23 hours; do not create a duplicate.',
        }),
      ]);
      return json(
        {
          error: 'Delivery could not be confirmed. Retry this same message.',
          state: await state(uid),
        },
        502,
      );
    }
  } catch (e) {
    return json(
      {error: (e as Error).message === 'SIGN_IN' ? 'Please sign in.' : (e as Error).message},
      (e as Error).message === 'SIGN_IN' ? 401 : 400,
    );
  }
}

export const GET = withWorkspace(GETImpl, false);

export const POST = withWorkspace(POSTImpl, true);
