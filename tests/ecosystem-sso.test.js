import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('繁星捕手以 Starry ID 中央 session 與一次性票證承接登入', async () => {
  const sso = await read('static/ecosystem-sso.js');
  assert.match(sso, /https:\/\/id\.starry\.phd/);
  assert.match(sso, /api\/ecosystem\/session/);
  assert.match(sso, /api\/apps\/downloadstarry\/ticket/);
  assert.match(sso, /credentials: 'include'/);
  assert.match(sso, /\/auth\/callback/);
});

test('登入或切換身分會更新整個 Starry ID 共用會員身份', async () => {
  const sso = await read('static/ecosystem-sso.js');
  const shared = await read('static/starry-account-switch.js');
  const gate = await read('static/access-gate.js');
  assert.match(shared, /accounts\.google\.com\/gsi\/client/);
  assert.match(shared, /api\/google-sync/);
  assert.match(shared, /appId:'starry-id'/);
  assert.match(shared, /api\/apps\/downloadstarry\/ticket/);
  assert.match(gate, /切換身分/);
  assert.match(sso, /StarryDownloadIdentity\.switchGlobal/);
});

test('繁星捕手不共用或直接讀取 Starry ID 敏感 Cookie', async () => {
  const files = [
    await read('static/ecosystem-sso.js'),
    await read('cloudflare/central-sso.js'),
    await read('cloudflare/worker.js')
  ].join('\n');
  assert.doesNotMatch(files, /Domain=\.starry\.phd/);
  assert.doesNotMatch(files, /starry_id_session/);
});

test('回到頁面時只標示需驗證，不會自動重新整理或換帳號', async () => {
  const sso = await read('static/ecosystem-sso.js');
  const gate = await read('static/access-gate.js');
  assert.match(gate, /window\.addEventListener\('focus',markStale\)/);
  assert.match(gate, /visibilitychange/);
  assert.match(gate, /window\.addEventListener\('click',clickGuard,true\)/);
  assert.match(sso, /centralLogout/);
  assert.doesNotMatch(sso, /window\.setTimeout\(\(\) => void sync\(true\), 0\)/);
  assert.doesNotMatch(gate, /location\.reload/);
});
