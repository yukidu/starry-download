(() => {
  'use strict';

  const CLIENT_ID = '661055525630-ndcq5gtr16h7rqqprlqqkkvineea87lc.apps.googleusercontent.com';
  const CENTRAL = 'https://id.starry.phd';
  const CENTRAL_SESSION = `${CENTRAL}/api/ecosystem/session`;
  const TICKET = `${CENTRAL}/api/apps/downloadstarry/ticket`;
  const LOCAL_SESSION = '/api/auth/starry/session';
  const LOCAL_LOGOUT = '/api/auth/starry/logout';
  const LOCAL_LOGIN = '/api/auth/starry/login';
  const CALLBACK = '/auth/callback';
  const MIN_SYNC_MS = 2500;

  let overlay = null;
  let syncing = false;
  let lastSync = 0;
  let reloading = false;
  const originalFetch = window.fetch.bind(window);

  const text = value => String(value ?? '').trim();

  function normalizeBrand() {
    if (document.title.includes('繁星下載')) {
      document.title = document.title.replaceAll('繁星下載', '繁星捕手');
    }
    document.querySelectorAll('.site-brand-text').forEach(node => {
      if (node.textContent?.includes('繁星下載')) node.textContent = node.textContent.replaceAll('繁星下載', '繁星捕手');
    });
  }

  function watchBrand() {
    normalizeBrand();
    const title = document.querySelector('title');
    if (title) new MutationObserver(normalizeBrand).observe(title, {childList: true, characterData: true, subtree: true});
    window.setTimeout(normalizeBrand, 200);
    window.setTimeout(normalizeBrand, 1000);
  }

  function reloadOnce() {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  }

  async function readJson(response) {
    return response.json().catch(() => ({}));
  }

  async function localState() {
    try {
      const response = await originalFetch(LOCAL_SESSION, {
        credentials: 'include',
        cache: 'no-store',
        headers: {Accept: 'application/json'}
      });
      const data = await readJson(response);
      if (response.status === 403 && data?.code === 'APP_ACCESS_DENIED') return {authenticated: false, denied: true};
      return response.ok && data?.authenticated ? data : {authenticated: false};
    } catch {
      return null;
    }
  }

  async function centralState() {
    try {
      const response = await originalFetch(CENTRAL_SESSION, {
        credentials: 'include',
        cache: 'no-store',
        headers: {Accept: 'application/json'}
      });
      const data = await readJson(response);
      return response.ok ? data : {authenticated: false};
    } catch {
      return null;
    }
  }

  async function localLogout() {
    try {
      const response = await originalFetch(LOCAL_LOGOUT, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {'Content-Type': 'application/json'},
        body: '{}'
      });
      return response.ok;
    } catch { return false; }
  }

  async function centralLogout() {
    try {
      await originalFetch(`${CENTRAL}/api/logout`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {'Content-Type': 'application/json'},
        body: '{}'
      });
    } catch {}
  }

  async function issueTicket() {
    const response = await originalFetch(TICKET, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {'Content-Type': 'application/json'},
      body: '{}'
    });
    const data = await readJson(response);
    if (!response.ok || !data?.code) {
      if (response.status === 403) showDeniedMask();
      throw new Error(data?.error || '無法建立繁星通行證登入票證');
    }
    return text(data.code);
  }

  function showDeniedMask() {
    if (window.StarryDownloadInteractionGate) {
      window.StarryDownloadInteractionGate.showDenied();
      return;
    }
    if (document.getElementById('starry-access-denied')) return;
    const mask = document.createElement('div');
    mask.id = 'starry-access-denied';
    mask.setAttribute('role','alert');
    mask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.60);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:white;text-align:center';
    const title = document.createElement('h1');
    title.textContent = '您尚未開通本服務';
    title.style.cssText = 'font:800 clamp(23px,5vw,31px)/1.4 system-ui,sans-serif';
    mask.appendChild(title);
    document.body.appendChild(mask);
  }

  async function sync(force = false) {
    const now = Date.now();
    if (syncing || (!force && now - lastSync < MIN_SYNC_MS)) return;
    syncing = true;
    lastSync = now;
    try {
      const [local, central] = await Promise.all([localState(), centralState()]);
      if (local?.denied) { showDeniedMask(); return; }
      if (central === null || local === null) return;

      if (!central?.authenticated || !central?.user?.id) {
        if (local?.authenticated) {
          if (await localLogout()) reloadOnce();
        }
        return;
      }

      const centralId = text(central.user.id);
      const localId = text(local?.user?.id);
      if (local?.authenticated && localId && localId === centralId) return;

      if (local?.authenticated) await localLogout();
      const code = await issueTicket();
      window.location.replace(`${CALLBACK}?code=${encodeURIComponent(code)}`);
    } catch (error) {
      console.warn('繁星捕手：生態系登入同步暫時略過', error);
    } finally {
      syncing = false;
    }
  }

  function installStyles() {
    if (document.getElementById('starry-catcher-sso-style')) return;
    const style = document.createElement('style');
    style.id = 'starry-catcher-sso-style';
    style.textContent = `
      .starry-sso-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(3,8,22,.68);backdrop-filter:blur(6px)}
      .starry-sso-card{width:min(390px,100%);border:1px solid rgba(121,229,255,.34);border-radius:22px;padding:24px 18px 20px;background:#081225;color:#fff;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.5)}
      .starry-sso-close{float:right;border:0;background:transparent;color:#fff;font-size:26px;line-height:1;cursor:pointer}
      .starry-sso-title{margin:4px 0 8px;font:800 21px/1.3 system-ui,sans-serif}
      .starry-sso-copy{margin:0 auto;color:#bdd8e8;font:500 13px/1.65 system-ui,sans-serif}
      .starry-sso-google{display:flex;justify-content:center;min-height:44px;margin-top:18px}
      .starry-sso-status{min-height:18px;margin-top:12px;color:#bfeaff;font:500 12px/1.5 system-ui,sans-serif}
    `;
    document.head.appendChild(style);
  }

  function closeOverlay() {
    overlay?.remove();
    overlay = null;
  }

  function setStatus(message) {
    const node = overlay?.querySelector('[data-starry-sso-status]');
    if (node) node.textContent = message;
  }

  async function completeGoogleLogin(credential) {
    if (!credential) return setStatus('沒有取得 Google 登入資料，請再試一次。');
    setStatus('正在切換 Starry ID 共用身分…');
    try {
      const status=await window.StarryDownloadIdentity.switchGlobal(credential);
      if(status==='redirecting')return;
      closeOverlay();
      if(status==='denied')showDeniedMask();
      else setStatus('登入服務暫時無法使用');
    }catch(error){
      setStatus(error?.message||'登入失敗，請再試一次。');
    }
  }

  function renderGoogle() {
    if (!overlay) return;
    if (!window.google?.accounts?.id) {
      window.setTimeout(renderGoogle, 80);
      return;
    }
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: result => void completeGoogleLogin(text(result?.credential)),
      ux_mode: 'popup',
      auto_select: false,
      itp_support: true
    });
    const slot = overlay.querySelector('[data-starry-google]');
    if (slot && !slot.childElementCount) {
      window.google.accounts.id.renderButton(slot, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        locale: 'zh_TW',
        width: 300
      });
    }
    setStatus('請選擇 Google 帳號');
  }

  function showLogin() {
    if (window.StarryDownloadInteractionGate) {
      window.StarryDownloadInteractionGate.showLogin();
      return;
    }
    if (overlay) return;
    installStyles();
    overlay = document.createElement('div');
    overlay.className = 'starry-sso-overlay';
    overlay.innerHTML = `
      <div class="starry-sso-card" role="dialog" aria-modal="true" aria-label="登入繁星通行證">
        <button class="starry-sso-close" type="button" data-starry-close aria-label="關閉">×</button>
        <div class="starry-sso-title">登入繁星通行證</div>
        <p class="starry-sso-copy">選擇 Google 帳號，完成後會留在繁星捕手。</p>
        <div class="starry-sso-google" data-starry-google></div>
        <div class="starry-sso-status" data-starry-sso-status>正在準備登入…</div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-starry-close]')?.addEventListener('click', closeOverlay);
    renderGoogle();
  }

  function loadGoogle() {
    if (window.google?.accounts?.id || document.querySelector('script[data-starry-google-gsi]')) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.starryGoogleGsi = '1';
    document.head.appendChild(script);
  }

  // Keep the existing local logout behavior, then propagate it to Starry ID.
  window.fetch = (async (input, init) => {
    const response = await originalFetch(input, init);
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.href);
      const method = text(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.origin === window.location.origin && url.pathname === LOCAL_LOGOUT && method === 'POST' && response.ok) {
        void centralLogout();
        try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch {}
      }
    } catch {}
    return response;
  });

  // Capture old login controls before any redirect fallback can leave this app.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const login = target.closest(`#dsr-login,a[href^="${LOCAL_LOGIN}"],button[data-starry-login],button[data-member-login]`);
    if (!login) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showLogin();
  }, true);

  watchBrand();
  loadGoogle();
  // Public landing pages never auto-redirect on load, focus, online or
  // visibility changes. Only a deliberate user interaction can check access.
  window.addEventListener('focus', normalizeBrand);

  window.StarryCatcherAuth = Object.freeze({
    login: showLogin,
    sync: () => window.StarryDownloadInteractionGate?.check(),
    logoutAll: async () => {
      await Promise.allSettled([localLogout(), centralLogout()]);
      reloadOnce();
    }
  });
})();
