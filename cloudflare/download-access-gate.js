import {evaluateCentralAppEntitlementRow} from './central-app-access.js';

const APP_ID = 'downloadstarry';
const PAGE_ROUTES = new Set(['/', '/account', '/history', '/install', '/report']);

/**
 * Anyone may browse the public landing page without a member lookup.
 * Every action triggers a client-initiated access status check and every
 * protected API is independently authorized by the Worker. Presentation
 * and enforcement intentionally remain separate.
 */
export function shouldCheckDownloadAccess(url, method) {
  const path = url.pathname;
  if (['GET', 'HEAD'].includes(method) && (
    path === '/' || path.startsWith('/static/') ||
    path === '/favicon.ico' || path === '/api/health'
  )) return false;
  if (path === '/auth/callback' && method === 'GET') return false;
  if (path === '/api/auth/starry/login' && method === 'GET') return false;
  if (path === '/api/auth/starry/logout' && method === 'POST') return false;
  return true;
}

export function isDownloadPageRequest(url, method) {
  return ['GET', 'HEAD'].includes(method) && PAGE_ROUTES.has(url.pathname);
}

export function downloadAccessStatusResponse(result) {
  const status=result.status==='allowed'?200:
    result.status==='login_required'?401:result.status==='unavailable'?503:403;
  return Response.json({status:result.status, ...(result.status==='allowed' ? {userId:result.userId} : {})},{
    status,
    headers:{
      'Cache-Control':'private, no-store, max-age=0',
      'Pragma':'no-cache',
      'Vary':'Cookie',
      'X-Content-Type-Options':'nosniff'
    }
  });
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
  // The server fallback uses EXACTLY the same stylesheet and markup as the
  // hydrated overlay; there is no second copy of opacity/spacing/blur.
  // Avoid a dark standalone background that looks different from the live
  // homepage. A neutral surface behind 60% black is intentional.
  const title=status==='unavailable'?'權限驗證暫時無法使用':'您尚未開通本服務';
  const login=status==='login_required';
  const action=status==='unavailable'?'':'<button type="button" class="starry-access-primary">'+(login?'登入':'切換身分')+'</button>';
  const script=status==='unavailable'?'':'<script src="/static/starry-access-ui.js"></script><script src="/static/starry-account-switch.js"></script><script src="/static/access-gate.js"></script>';
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>繁星下載｜使用權限</title>
<link rel="stylesheet" href="/static/starry-access.css">
<style>html,body{min-height:100%;margin:0;background:#18202c;color:#fff}</style>
</head><body>
<div class="starry-access-overlay" id="starry-access-gate" data-status="${status}" role="main">
<main class="starry-access-panel">
<div class="starry-access-lock" aria-hidden="true">🔒</div>
<h1>${title}</h1>${action}
</main></div>${script}</body></html>`;
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
      'Content-Security-Policy':"default-src 'none'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' https://accounts.google.com data:; frame-src https://accounts.google.com; connect-src 'self' https://id.starry.phd; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}
  });
}
