import {checkCentralAppEntitlement} from './central-app-access.js';
const encoder = new TextEncoder();
const STARRY_ID_ORIGIN = 'https://id.starry.phd';
const APP_ID = 'downloadstarry';
const SESSION_COOKIE = 'downloadstarry_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const schemaReady = new WeakMap();

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

async function hash(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Priority=High`;
}

async function ensureSchema(env) {
  if (!env.STARRY_ID_DB) throw new Error('STARRY_ID_DB not bound');
  const db = env.STARRY_ID_DB;
  if (!schemaReady.has(db)) {
    const task = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS starry_app_auth_codes (
        codeHash TEXT PRIMARY KEY,
        appId TEXT NOT NULL,
        userId TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL
      )`),
      db.prepare('CREATE INDEX IF NOT EXISTS starry_app_auth_codes_expiry ON starry_app_auth_codes(expiresAt)'),
      db.prepare(`CREATE TABLE IF NOT EXISTS downloadstarry_sessions (
        tokenHash TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL
      )`),
      db.prepare('CREATE INDEX IF NOT EXISTS downloadstarry_sessions_user ON downloadstarry_sessions(userId)'),
      db.prepare('CREATE INDEX IF NOT EXISTS downloadstarry_sessions_expiry ON downloadstarry_sessions(expiresAt)')
    ]).catch(error => {
      schemaReady.delete(db);
      throw error;
    });
    schemaReady.set(db, task);
  }
  await schemaReady.get(db);
}

async function consumeCode(env, code) {
  await ensureSchema(env);
  const db = env.STARRY_ID_DB;
  const codeHash = await hash(code);
  return db.prepare(`
    DELETE FROM starry_app_auth_codes
    WHERE codeHash = ? AND appId = ? AND expiresAt > ?
    RETURNING userId
  `).bind(codeHash, APP_ID, Date.now()).first();
}

async function activeMember(env, userId) {
  return env.STARRY_ID_DB.prepare(`
    SELECT u.id, u.status, am.status AS membershipStatus
    FROM users u
    JOIN app_memberships am ON am.userId = u.id AND am.appId = ?
    WHERE u.id = ?
    LIMIT 1
  `).bind(APP_ID, userId).first();
}

async function createSession(env, userId) {
  const db = env.STARRY_ID_DB;
  const token = randomToken();
  const tokenHash = await hash(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db.batch([
    db.prepare('DELETE FROM downloadstarry_sessions WHERE expiresAt <= ?').bind(now),
    db.prepare('INSERT INTO downloadstarry_sessions (tokenHash,userId,expiresAt,createdAt) VALUES (?,?,?,?)')
      .bind(tokenHash, userId, expiresAt, now)
  ]);
  return token;
}

async function callback(request, env) {
  const ownOrigin = new URL(request.url).origin;
  const code = new URL(request.url).searchParams.get('code')?.trim() || '';
  if (!code || !/^[A-Za-z0-9_-]{30,}$/.test(code)) {
    return Response.redirect(`${ownOrigin}/account?starry=error`, 302);
  }
  try {
    const ticket = await consumeCode(env, code);
    if (!ticket?.userId) return Response.redirect(`${ownOrigin}/account?starry=error`, 302);
    const member = await activeMember(env, String(ticket.userId));
    if (!member || String(member.status) !== 'active' || String(member.membershipStatus) !== 'active') {
      return Response.redirect(`${ownOrigin}/account?starry=error`, 302);
    }
    const access=await checkCentralAppEntitlement(env.STARRY_ID_DB,String(ticket.userId),APP_ID);
    if(!access.allowed)return Response.redirect(`${ownOrigin}/account?starry=denied`,302);
    const token = await createSession(env, String(ticket.userId));
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${ownOrigin}/account?starry=login`,
        'Set-Cookie': sessionCookie(token),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer'
      }
    });
  } catch {
    return Response.redirect(`${ownOrigin}/account?starry=unavailable`, 302);
  }
}

export async function handleCentralSso(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (url.pathname === '/api/auth/starry/login' && method === 'GET') {
    const chooseAccount = url.searchParams.get('choose') === '1';
    const suffix = chooseAccount ? '?choose=1' : '';
    return Response.redirect(`${STARRY_ID_ORIGIN}/auth/downloadstarry${suffix}`, 302);
  }
  if (url.pathname === '/auth/callback' && method === 'GET') {
    if (!env.STARRY_ID_DB) return json({error: 'Starry ID 中央會員服務尚未連線'}, 503);
    return callback(request, env);
  }
  return null;
}
