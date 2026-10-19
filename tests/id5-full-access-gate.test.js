import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  shouldCheckDownloadAccess,
  isDownloadPageRequest,
  resolveDownloadAccess,
  accessDeniedResponse,
  downloadAccessStatusResponse
} from '../cloudflare/download-access-gate.js';
import {STARRY_APP_GRANT_CUTOFF} from '../cloudflare/central-app-access.js';

function source(path) {
  return readFileSync(new URL('../'+path,import.meta.url),'utf8');
}

const COOKIE='downloadstarry_session='+('a'.repeat(38));
function dbFor(decision, options={}) {
  const readQueries=[];
  const db={
    prepare(sql) {
      readQueries.push(sql);
      assert.match(sql,/SELECT/i,'access decisions must only read membership, never change it');
      assert.match(sql,/JOIN users u ON u.id=s.userId/);
      assert.match(sql,/FROM downloadstarry_sessions s/);
      assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|DROP/i);
      return {bind(...params) {
        assert.deepEqual(params.slice(0,2),['downloadstarry','downloadstarry']);
        assert.match(params[2],/^[a-f0-9]{64}$/);
        return {async first(){
          return {userId:'starry-person',expiresAt:options.expiresAt||Date.now()+600000,
            status:options.accountStatus||'active',
            createdAt:options.createdAt||STARRY_APP_GRANT_CUTOFF-20000,
            membershipStatus:options.membershipStatus===undefined?'active':options.membershipStatus,
            decision};
        }};
      }};
    }
  };
  return {db,readQueries};
}

function request(path='/',cookie=COOKIE,method='GET') {
  return new Request('https://download.starry.phd'+path,{method,headers:cookie?{Cookie:cookie}:{}});
}

test('homepage is public, but account, history and every App API remain protected',()=>{
  for(const path of ['/account','/history','/report','/install','/api/info','/api/download',
    '/api/reports','/api/favorites','/api/download-history','/api/advanced/download',
    '/api/download/'+'a'.repeat(32)+'/file','/api/push/subscribe',
    '/api/auth/starry/session']) {
    assert.equal(shouldCheckDownloadAccess(new URL('https://download.starry.phd'+path),'GET'),true,path);
  }
  for(const path of ['/','/static/access-gate.js','/static/starry-account-switch.js','/static/service-worker.js','/api/health','/favicon.ico']) {
    assert.equal(shouldCheckDownloadAccess(new URL('https://download.starry.phd'+path),'GET'),false,path);
  }
  assert.equal(shouldCheckDownloadAccess(new URL('https://download.starry.phd/static/access-gate.js'),'POST'),true);
  assert.equal(shouldCheckDownloadAccess(new URL('https://download.starry.phd/api/auth/starry/login'),'GET'),false);
  assert.equal(shouldCheckDownloadAccess(new URL('https://download.starry.phd/api/auth/starry/logout'),'POST'),false);
  assert.equal(shouldCheckDownloadAccess(new URL('https://download.starry.phd/auth/callback'),'GET'),false);
  assert.equal(isDownloadPageRequest(new URL('https://download.starry.phd/'),'GET'),true);
});

test('anonymous guest is blocked before any central database requests',async()=>{
  const db={prepare(){throw new Error('anonymous requests must not hit D1');}};
  const result=await resolveDownloadAccess(request('/',null),{STARRY_ID_DB:db});
  assert.equal(result.status,'login_required');
  const page=accessDeniedResponse(request('/',null),result);
  assert.equal(page.status,200);
  assert.match(page.headers.get('Content-Type'),/text\/html/);
  assert.match(page.headers.get('Cache-Control'),/no-store/);
  const html=await page.text();
  assert.match(html,/您尚未開通本服務/);
  assert.match(html,/id="access-action"/);
  assert.match(html,/登入/);
  assert.match(html,/static\/starry-account-switch\.js/);
  assert.match(html,/background:rgba\(0,0,0,\.80\)/);
  assert.doesNotMatch(html,/請聯絡管理員|請聯絡繁星管理員/);
  assert.doesNotMatch(html,/ecosystem-sso\.js|brand-sync\.js|location\.reload/);
});

test('denied signed-in member gets 80-percent gate and a global switch-account control',async()=>{
  const {db,readQueries}=dbFor('deny');
  const result=await resolveDownloadAccess(request('/'),{STARRY_ID_DB:db});
  assert.deepEqual(result,{status:'denied',code:'APP_ACCESS_DENIED'});
  assert.equal(readQueries.length,1);
  const response=accessDeniedResponse(request('/'),result);
  assert.equal(response.status,403);
  const html=await response.text();
  assert.match(html,/<h1>您尚未開通本服務<\/h1>/);
  assert.match(html,/切換身分/);
  assert.match(html,/static\/starry-account-switch\.js/);
  assert.doesNotMatch(html,/請先登入|請聯絡|ecosystem-sso\.js/);
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');
  const privateGate=accessDeniedResponse(request('/account'),result);
  assert.match(privateGate.headers.get('Content-Security-Policy'),/connect-src 'self' https:\/\/id\.starry\.phd/);
});

test('denied, anonymous and interrupted API operations fail closed with clear statuses',async()=>{
  const denied={status:'denied'};
  const blocked=accessDeniedResponse(request('/api/download',COOKIE,'POST'),denied);
  assert.equal(blocked.status,403);
  assert.equal((await blocked.json()).code,'APP_ACCESS_DENIED');
  assert.equal((await accessDeniedResponse(request('/api/info',null,'POST'),{status:'login_required'}).json()).code,'AUTH_REQUIRED');
  const unavailable=accessDeniedResponse(request('/api/download',COOKIE,'POST'),{status:'unavailable'});
  assert.equal(unavailable.status,503);
  const unavailableJson=await unavailable.json();
  assert.equal(unavailableJson.code,'ACCESS_UNAVAILABLE');
  assert.equal(accessDeniedResponse(request('/history',COOKIE,'HEAD'),denied).status,403);
});

test('valid central grants and pre-cutoff existing members are admitted without writes',async()=>{
  for(const [decision,createdAt] of [
    ['allow',STARRY_APP_GRANT_CUTOFF+2000],
    [null,STARRY_APP_GRANT_CUTOFF-2000]
  ]) {
    const {db,readQueries}=dbFor(decision,{createdAt});
    const result=await resolveDownloadAccess(request('/'),{STARRY_ID_DB:db});
    assert.equal(result.status,'allowed');
    assert.equal(result.userId,'starry-person');
    assert.equal(readQueries.length,1);
  }
  const {db}=dbFor(null,{createdAt:STARRY_APP_GRANT_CUTOFF+2000});
  assert.equal((await resolveDownloadAccess(request('/'),{STARRY_ID_DB:db})).status,'denied');
});

test('inactive membership and inactive member are denied even when access is allow',async()=>{
  const m=dbFor('allow',{membershipStatus:'suspended'});
  assert.equal((await resolveDownloadAccess(request('/'),{STARRY_ID_DB:m.db})).status,'denied');
  const u=dbFor('allow',{accountStatus:'blocked'});
  assert.equal((await resolveDownloadAccess(request('/'),{STARRY_ID_DB:u.db})).status,'denied');
});

test('unavailable D1 fails closed for protected routes and cannot expose data',async()=>{
  assert.equal((await resolveDownloadAccess(request('/'),{})).status,'unavailable');
  const page=accessDeniedResponse(request('/'),{status:'unavailable'});
  assert.equal(page.status,503);
  assert.doesNotMatch(await page.text(),/請先登入|Google 登入/);
});

test('Worker gates HTML/API before downloader, background sync and reports',()=>{
  const worker=source('cloudflare/worker.js');
  const access=worker.indexOf('shouldCheckDownloadAccess(url,method)');
  const report=worker.indexOf('const reportManagementRequest');
  const container=worker.indexOf('return enhanceProductionPage');
  assert.ok(access>0 && report>access && container>report);
  assert.match(worker,/resolveDownloadAccess\(request,env\)/);
  assert.match(worker,/url\.searchParams\.get\('starry'\)==='denied'/);
  assert.doesNotMatch(worker,/const memberOnlyPath=/);
  assert.match(source('cloudflare/central-sso.js'),/function deniedRedirect\(origin\)/);
  assert.match(source('cloudflare/central-sso.js'),/Set-Cookie':SESSION_COOKIE\+'=;/);
});

test('Public page never starts automatic SSO loops and central switch is ecosystem-wide',()=>{
  const worker=source('cloudflare/worker.js');
  const legacy=source('static/ecosystem-sso.js');
  const gate=source('static/access-gate.js');
  const shared=source('static/starry-account-switch.js');
  assert.doesNotThrow(()=>new Function(legacy));
  assert.doesNotThrow(()=>new Function(gate));
  assert.doesNotThrow(()=>new Function(shared));
  assert.match(worker,/starry-account-switch\.js/);
  assert.match(worker,/\/api\/download-access\/status/);
  assert.match(gate,/window\.addEventListener\('click',clickGuard,true\)/);
  assert.match(gate,/function markStale\(\)/);
  assert.match(gate,/textContent=status==='denied'\?'切換身分':'登入'/);
  assert.doesNotMatch(legacy,/window\.setTimeout\(\(\) => void sync\(true\), 0\)/);
  assert.match(shared,/appId:'starry-id'/);
  assert.match(shared,/const \[app,shared\]=await Promise\.all\(\[local\(\),central\(\)\]\)/);
  assert.match(shared,/await logoutLocal\(\);/);
  assert.doesNotMatch(gate,/location\.reload\(/);
  assert.doesNotMatch(shared,/location\.reload\(/);
});

test('Central status API does not expose denied identities and is always uncached',()=>{
  const allowed=downloadAccessStatusResponse({status:'allowed',userId:'u-123'});
  assert.equal(allowed.status,200);
  assert.equal(allowed.headers.get('Cache-Control'),'private, no-store, max-age=0');
  const denied=downloadAccessStatusResponse({status:'denied',userId:'u-123'});
  assert.equal(denied.status,403);
  return Promise.all([allowed.json(),denied.json()]).then(([ok,no])=>{
    assert.equal(ok.userId,'u-123');
    assert.ok(!('userId' in no));
  });
});
