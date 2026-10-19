/* Starry Access Overlay v1 — status and DOM renderer, App-agnostic.
   App-specific authentication lives in a separate identity bridge. In
   particular, this file NEVER performs fetch, redirects or writes storage.
   IDs are for the visual surface only and never authorize backend APIs.
 */
(() => {
  'use strict';
  if (window.StarryAccessUI) return;

  const COPY=Object.freeze({
    checking:'正在確認權限…',
    denied:'您尚未開通本服務',
    login_required:'您尚未開通本服務',
    unavailable:'權限驗證暫時無法使用'
  });
  const validStatus=status=>Object.prototype.hasOwnProperty.call(COPY,status)?status:'unavailable';

  function make(status,options={}) {
    const state=validStatus(status);
    const mask=document.createElement('div');
    mask.id='starry-access-gate';
    mask.className='starry-access-overlay';
    mask.setAttribute('role','dialog');
    mask.setAttribute('aria-modal','true');
    mask.setAttribute('aria-label',COPY[state]);
    if(state==='checking') mask.setAttribute('aria-busy','true');

    const panel=document.createElement('div');
    panel.className='starry-access-panel';
    if(options.closable!==false && state!=='checking'){
      const close=document.createElement('button');
      close.type='button';close.className='starry-access-close';
      close.setAttribute('aria-label','關閉');
      close.textContent='×';
      close.addEventListener('click',event=>{
        event.stopPropagation();
        options.onClose?.();
      });
      panel.appendChild(close);
    }
    const lock=document.createElement('div');
    lock.className='starry-access-lock';
    lock.textContent='🔒';
    lock.setAttribute('aria-hidden','true');
    panel.appendChild(lock);
    const title=document.createElement('h1');
    title.textContent=COPY[state];
    panel.appendChild(title);

    if(state==='denied'||state==='login_required'){
      const action=document.createElement('button');
      action.type='button';
      action.className='starry-access-primary';
      action.textContent=state==='denied'?'切換身分':'登入';
      panel.appendChild(action);
      const slot=document.createElement('div');
      slot.className='starry-access-google';
      slot.hidden=true;
      panel.appendChild(slot);
      const fallback=document.createElement('a');
      fallback.className='starry-access-fallback';
      fallback.href=options.centralUrl||'https://id.starry.phd/';
      fallback.textContent='前往 Starry ID 切換身分';
      fallback.hidden=true;
      panel.appendChild(fallback);
      action.addEventListener('click',event=>{
        event.stopPropagation();
        fallback.hidden=false;
        options.onIdentityAction?.({slot,status:state});
      });
    }

    const message=document.createElement('p');
    message.setAttribute('role','status');
    message.dataset.accessError='1';
    message.className='starry-access-status';
    message.hidden=true;
    panel.appendChild(message);
    mask.appendChild(panel);
    return mask;
  }

  window.StarryAccessUI=Object.freeze({COPY,make,version:'1.0.0'});
})();