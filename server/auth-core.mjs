import {scryptSync, randomBytes, randomUUID, createHash, timingSafeEqual} from 'node:crypto';
import {rawDatabase} from './storage.mjs';
export const digest = (v) => createHash('sha256').update(v).digest('hex');
export const cookieName = 'td_session';
export const hashPassword = (password) => {
  if (typeof password !== 'string' || password.length < 14 || password.length > 128)
    throw new Error('Use a password with 14–128 characters.');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
};
const dummy =
  '00000000000000000000000000000000:' +
  scryptSync('dummy authentication comparison', '00000000000000000000000000000000', 64).toString(
    'hex',
  );
export function verifyPassword(password, encoded = dummy) {
  if (typeof password !== 'string' || password.length > 128) return false;
  try {
    const [salt, hash] = encoded.split(':'),
      actual = scryptSync(password, salt, 64),
      expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
export function emailAddress(v) {
  if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200)
    throw new Error('Enter a valid email.');
  return v.trim().toLowerCase();
}
const text = (v, max = 100) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw new Error('A name is required (maximum ' + max + ' characters).');
  return v.trim();
};
export function transaction(fn) {
  const db = rawDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function accessAudit(ctx, action, detail = '') {
  rawDatabase()
    .prepare('INSERT INTO access_audit VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), ctx.workspaceId, ctx.userId, action, detail, new Date().toISOString());
}
function newWorkspace(db, userId, name) {
  const id = randomUUID();
  db.prepare('INSERT INTO workspaces VALUES (?,?,?)').run(
    id,
    text(name, 160),
    new Date().toISOString(),
  );
  db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(id, userId, 'owner');
  return id;
}
export function bootstrap({email, name, password, business}) {
  const address = emailAddress(email),
    display = text(name),
    hash = hashPassword(password);
  return transaction((db) => {
    if (db.prepare('SELECT id FROM users LIMIT 1').get())
      throw new Error('Setup is already complete. Use an invitation to join.');
    const id = randomUUID();
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(
      id,
      address,
      display,
      hash,
      new Date().toISOString(),
    );
    return {userId: id, workspaceId: newWorkspace(db, id, business)};
  });
}
export function consumeLimit(key, max = 10, minutes = 15) {
  const db = rawDatabase(),
    now = Date.now();
  db.prepare('DELETE FROM auth_attempts WHERE until_at < ?').run(now);
  const existing = db.prepare('SELECT * FROM auth_attempts WHERE key=?').get(key);
  if (existing && existing.count >= max) throw new Error('Too many attempts. Try again later.');
  db.prepare(
    'INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
  ).run(key, now + minutes * 60000);
}
export function signIn(email, password) {
  const address = emailAddress(email);
  consumeLimit('login:' + digest(address));
  const db = rawDatabase(),
    user = db.prepare('SELECT * FROM users WHERE email=?').get(address);
  if (!verifyPassword(password, user?.password) || !user)
    throw new Error('Email or password is incorrect.');
  const membership = db
    .prepare('SELECT workspace_id FROM memberships WHERE user_id=? ORDER BY workspace_id LIMIT 1')
    .get(user.id);
  if (!membership) throw new Error('This account has no active business membership.');
  db.prepare('DELETE FROM auth_attempts WHERE key=?').run('login:' + digest(address));
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(
    digest(token),
    user.id,
    membership.workspace_id,
    Date.now() + 7 * 86400000,
  );
  return token;
}
export function session(token) {
  if (typeof token !== 'string' || token.length !== 43) return null;
  return (
    rawDatabase()
      .prepare(
        'SELECT u.id AS userId,u.name,u.email,s.workspace_id AS workspaceId,m.role,w.name AS businessName FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id AND m.workspace_id=s.workspace_id JOIN workspaces w ON w.id=s.workspace_id WHERE s.hash=? AND s.expires_at>?',
      )
      .get(digest(token), Date.now()) || null
  );
}
export function tokenFromCookie(cookie = '') {
  const found = cookie
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + '='));
  return found ? found.slice(cookieName.length + 1) : '';
}
export function logout(token) {
  rawDatabase().prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));
}
export function changeWorkspace(token, id) {
  const ctx = session(token);
  if (
    !ctx ||
    !rawDatabase()
      .prepare('SELECT role FROM memberships WHERE workspace_id=? AND user_id=?')
      .get(id, ctx.userId)
  )
    throw new Error('Business access denied.');
  rawDatabase().prepare('UPDATE sessions SET workspace_id=? WHERE hash=?').run(id, digest(token));
}
export function createWorkspace(ctx, name) {
  if (ctx.role !== 'owner') throw new Error('Only an owner can create another business.');
  const id = transaction((db) => newWorkspace(db, ctx.userId, name));
  accessAudit({...ctx, workspaceId: id}, 'business_created');
  return id;
}
export function invite(ctx, {email, role}) {
  if (ctx.role !== 'owner') throw new Error('Only an owner can invite people.');
  if (!['bookkeeper', 'viewer'].includes(role)) throw new Error('Choose bookkeeper or viewer.');
  const address = emailAddress(email),
    token = randomBytes(32).toString('base64url');
  rawDatabase()
    .prepare('DELETE FROM invitations WHERE workspace_id=? AND email=?')
    .run(ctx.workspaceId, address);
  rawDatabase()
    .prepare('INSERT INTO invitations VALUES (?,?,?,?,?,?)')
    .run(digest(token), ctx.workspaceId, address, role, Date.now() + 72 * 3600000, ctx.userId);
  accessAudit(ctx, 'invitation_created', address + ' · ' + role);
  return token;
}
export function acceptInvitation({token, email, name, password}) {
  if (typeof token !== 'string' || token.length !== 43)
    throw new Error('Invitation is invalid or expired.');
  const address = emailAddress(email),
    display = text(name);
  consumeLimit('invite:' + digest(token));
  const db = rawDatabase(),
    invitation = db
      .prepare('SELECT * FROM invitations WHERE hash=? AND expires_at>?')
      .get(digest(token), Date.now());
  if (!invitation || invitation.email !== address)
    throw new Error('Invitation is invalid or expired.');
  const existing = db.prepare('SELECT * FROM users WHERE email=?').get(address);
  let hash;
  if (existing) {
    if (!verifyPassword(password, existing.password))
      throw new Error('Use your existing account password to accept this invitation.');
  } else hash = hashPassword(password);
  return transaction((sql) => {
    const current = sql
      .prepare('SELECT * FROM invitations WHERE hash=? AND expires_at>?')
      .get(digest(token), Date.now());
    if (!current) throw new Error('Invitation was already used or revoked.');
    const id = existing?.id || randomUUID();
    if (!existing)
      sql
        .prepare('INSERT INTO users VALUES (?,?,?,?,?)')
        .run(id, address, display, hash, new Date().toISOString());
    const member = sql
      .prepare('SELECT role FROM memberships WHERE workspace_id=? AND user_id=?')
      .get(current.workspace_id, id);
    if (member)
      throw new Error('This account is already a member. Ask the owner to manage its access.');
    sql
      .prepare('INSERT INTO memberships VALUES (?,?,?)')
      .run(current.workspace_id, id, current.role);
    sql.prepare('DELETE FROM invitations WHERE hash=?').run(digest(token));
    accessAudit({workspaceId: current.workspace_id, userId: id}, 'invitation_accepted');
    return id;
  });
}
export function changeRole(ctx, id, role) {
  if (ctx.role !== 'owner') throw new Error('Only an owner can manage access.');
  if (!['bookkeeper', 'viewer', 'remove'].includes(role)) throw new Error('Invalid role.');
  const db = rawDatabase(),
    target = db
      .prepare('SELECT role FROM memberships WHERE workspace_id=? AND user_id=?')
      .get(ctx.workspaceId, id);
  if (!target || target.role === 'owner') throw new Error('The owner cannot be changed here.');
  transaction((sql) => {
    if (role === 'remove')
      sql
        .prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=?')
        .run(ctx.workspaceId, id);
    else
      sql
        .prepare('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?')
        .run(role, ctx.workspaceId, id);
    sql.prepare('DELETE FROM sessions WHERE workspace_id=? AND user_id=?').run(ctx.workspaceId, id);
    accessAudit(
      ctx,
      role === 'remove' ? 'member_removed' : 'member_role_changed',
      id + ' · ' + role,
    );
  });
}
export function revokeInvitation(ctx, hash) {
  if (ctx.role !== 'owner') throw new Error('Only an owner can revoke invitations.');
  rawDatabase()
    .prepare('DELETE FROM invitations WHERE workspace_id=? AND hash=?')
    .run(ctx.workspaceId, hash);
  accessAudit(ctx, 'invitation_revoked');
}
export function changePassword(ctx, current, newPassword) {
  const user = rawDatabase().prepare('SELECT password FROM users WHERE id=?').get(ctx.userId);
  if (!user || !verifyPassword(current, user.password))
    throw new Error('Current password is incorrect.');
  resetPassword(ctx.email, newPassword);
}
export function resetPassword(email, password) {
  const hash = hashPassword(password);
  transaction((db) => {
    const user = db.prepare('SELECT id FROM users WHERE email=?').get(emailAddress(email));
    if (!user) throw new Error('Account not found.');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  });
}
