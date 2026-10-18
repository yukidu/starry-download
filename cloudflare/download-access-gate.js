import {evaluateCentralAppEntitlementRow} from './central-app-access.js';

const APP_ID = 'downloadstarry';
const PAGE_ROUTES = new Set(['/', '/account', '/history', '/install', '/report']);

/**
 * The entire Download App requires a valid member session and central grant.
 * Only authentication handoffs, health and inert static files bypass the gate.
 * This is a server-side access decision, not a cosmetic browser overlay.
 */
export function shouldCheckDownloadAccess(url, method) {
  const path = url.pathname;
  if (['GET', 'HEAD'].includes(method) && (
    path.startsWith('/static/') || path === '/favicon.ico' || path === '/api/health'
  )) return false;
  if (path === '/auth/callback' && method === 'GET') return false;
  if (path === '/api/auth/starry/login' && method === 'GET') return false;
  if (path === '/api/auth/starry/logout' && method === 'POST') return false;
  return true;
}

export function isDownloadPageRequest(url, method) {
  return ['GET', 'HEAD'].includes(method) && PAGE_ROUTES.has(url.pathname);
}

function sessionCookieToken(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [name,...rest] = part.trim().split('=');
    if (name==='downloadstarry_session') return rest.join('=').trim();
  }
  return '';
}
async function sessionHash(token) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function resolveDownloadAccess(request, env) {
  if (!env.STARRY_ID_DB) return {status:'unavailable'};
  const token=sessionCookieToken(request);
  if (token.length<30) return {status:'login_required'};
  // One central D1 read is sufficient: verify a live Download session and
  // the authoritative App decision at once. This matters for frequent
  // progress/file polling and remains immediately revocable by an admin.
  const row=await env.STARRY_ID_DB.prepare(`SELECT s.userId,s.expiresAt,
      u.status,u.createdAt,m.status AS membershipStatus,a.decision
    FROM downloadstarry_sessions s
    JOIN users u ON u.id=s.userId
    LEFT JOIN app_memberships m ON m.userId=u.id AND m.appId=?
    LEFT JOIN starry_app_access_decisions a ON a.userId=u.id AND a.appId=?
    WHERE s.tokenHash=? LIMIT 1`)
    .bind(APP_ID,APP_ID,await sessionHash(token)).first();
  if (!row || Number(row.expiresAt||0)<=Date.now()) return {status:'login_required'};
  const access=evaluateCentralAppEntitlementRow(row);
  return access.allowed
    ? {status:'allowed',userId:String(row.userId)}
    : {status:'denied',code:access.code};
}

function gateHtml(status) {
  const login = status === 'login_required';
  const unavailable = status === 'unavailable';
  const title = unavailable ? '權限驗證暫時無法使用' : '您沒有使用權限';
  const sub = login ? '<p class="sub">請先登入</p>' : '';
  const action = login
    ? '<div class="sign-in"><a id="fallback-login" class="login-button" href="/api/auth/starry/login?choose=1">登入</a><div id="google-login" aria-label="Google 登入"></div></div><p id="login-status" role="status" hidden></p>'
    : '';
  const script = login
    ? '<script src="https://accounts.google.com/gsi/client" async defer></script><script src="/static/access-gate.js" defer></script>'
    : '';
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>繁星下載｜使用權限</title>
<style>
html,body{min-height:100%;margin:0}
body{font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;color:#fff;background:radial-gradient(ellipse at 30% 20%,#344864 0%,#121923 58%,#090b0d 100%)}
.access-mask{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;
  background:rgba(0,0,0,.86);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:24px;box-sizing:border-box}
.access-content{width:min(440px,100%);text-align:center}
.access-lock{width:46px;height:46px;margin:0 auto 18px;color:#e9a9b0}
h1{font-size:clamp(23px,5vw,31px);line-height:1.35;letter-spacing:.03em;margin:0;font-weight:800}
.sub{font-size:18px;line-height:1.55;margin:16px 0 0}
.sign-in{display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:26px;min-height:42px}
.login-button{display:inline-flex;align-items:center;justify-content:center;min-width:185px;
  padding:12px 22px;border-radius:12px;background:#f3f6ff;color:#101827;font-weight:750;text-decoration:none}
#login-status{font-size:13px;line-height:1.5;color:#efc7cc;margin-top:16px}
[hidden]{display:none!important}
</style></head><body><div class="access-mask" role="main">
<main class="access-content">
<svg class="access-lock" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
<h1>${title}</h1>${sub}${action}</main></div>${script}</body></html>`;
}

/**
 * Browser pages receive only the gate HTML: the real App, its auto-sync script
 * and its container never start. APIs fail closed with readable JSON.
 */
export function accessDeniedResponse(request, result) {
  const url = new URL(request.url);
  const status = result.status === 'login_required' ? 401 : result.status === 'unavailable' ? 503 : 403;
  const headers = {
    'Cache-Control':'private, no-store, max-age=0',
    'Pragma':'no-cache',
    'Vary':'Cookie',
    'X-Robots-Tag':'noindex, nofollow',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
  };
  if (!isDownloadPageRequest(url, request.method.toUpperCase())) {
    const error=result.status==='login_required'?'請先登入':
      result.status==='unavailable'?'權限驗證暫時無法使用':'您沒有使用權限';
    return Response.json({error,code:result.status==='login_required'?'AUTH_REQUIRED':
      result.status==='unavailable'?'ACCESS_UNAVAILABLE':'APP_ACCESS_DENIED'},
    {status,headers});
  }
  const responseStatus=status===401?200:status;
  return new Response(request.method==='HEAD'?null:gateHtml(result.status),{
    status:responseStatus,
    headers:{...headers,'Content-Type':'text/html; charset=utf-8',
      'Content-Security-Policy':"default-src 'none'; script-src 'self' https://accounts.google.com; style-src 'unsafe-inline'; img-src 'self' https://accounts.google.com data:; frame-src https://accounts.google.com; connect-src https://id.starry.phd; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}
  });
}
