(() => {
  'use strict';
  // Only runs on the server-generated anonymous access screen. A denied
  // member receives no login script, so access denial can never auto-retry.
  const slot = document.getElementById('google-login');
  if (!slot) return;
  const fallback = document.getElementById('fallback-login');
  const status = document.getElementById('login-status');
  const CENTRAL = 'https://id.starry.phd';
  const CLIENT_ID = '661055525630-ndcq5gtr16h7rqqprlqqkkvineea87lc.apps.googleusercontent.com';
  let loggingIn = false;

  function setStatus(message) {
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
  }

  function showDenied() {
    // Deliberately ONLY the requested line, no login button, no retry, no
    // "contact administrator" copy and no automatic navigation.
    const title = document.querySelector('.access-content h1');
    if (title) title.textContent = '您沒有使用權限';
    document.querySelector('.access-content .sub')?.remove();
    document.querySelector('.sign-in')?.remove();
    status?.remove();
  }

  async function json(response) {
    return response.json().catch(() => ({}));
  }

  async function onGoogleCredential(credential) {
    if (!credential || loggingIn) return;
    loggingIn = true;
    setStatus('正在驗證登入權限…');
    try {
      const auth = await fetch(CENTRAL + '/api/google-sync', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({credential, appId:'downloadstarry'})
      });
      const identity = await json(auth);
      if (!auth.ok || !identity.success) {
        if (auth.status === 403 || identity.code === 'ACCOUNT_RESTRICTED') return showDenied();
        throw new Error(identity.error || '登入失敗，請重新選擇 Google 帳號');
      }
      const ticketResponse = await fetch(CENTRAL + '/api/apps/downloadstarry/ticket', {
        method:'POST',
        credentials:'include',
        cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:'{}'
      });
      const ticket = await json(ticketResponse);
      if (!ticketResponse.ok || !ticket.code) {
        if (ticketResponse.status === 403) return showDenied();
        throw new Error(ticket.error || '無法建立登入票證，請稍後重試');
      }
      // Exactly one navigation, directly from a user-triggered Google login.
      window.location.replace('/auth/callback?code=' + encodeURIComponent(ticket.code));
    } catch (error) {
      setStatus(error?.message || '登入服務暫時無法使用，請稍後重試');
    } finally {
      loggingIn = false;
    }
  }

  const loadedAt = Date.now();
  function render() {
    if (!document.body.contains(slot)) return;
    if (!window.google?.accounts?.id) {
      if (Date.now() - loadedAt < 8000) window.setTimeout(render, 130);
      // Keep an ordinary login link as fallback when Google is unavailable.
      return;
    }
    try {
      window.google.accounts.id.initialize({
        client_id:CLIENT_ID,
        callback:({credential}) => void onGoogleCredential(credential),
        ux_mode:'popup',
        auto_select:false,
        cancel_on_tap_outside:true,
        itp_support:true
      });
      window.google.accounts.id.renderButton(slot,{
        theme:'filled_black',size:'large',shape:'pill',
        text:'signin_with',locale:'zh_TW',width:250
      });
      // The Google button is the visible sign-in control; no extra tap needed.
      if (fallback) fallback.hidden = true;
    } catch {
      // Keep the fallback button, never reload the page.
    }
  }
  render();
})();
