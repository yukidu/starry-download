(() => {
  'use strict';
  if(window.StarryDownloadInteractionGate)return;
  const identity=window.StarryDownloadIdentity;
  if(!identity)return;
  const initiallyBlocked=document.getElementById('starry-access-gate');
  const serverPage=Boolean(initiallyBlocked);
  const startStatus=initiallyBlocked?.dataset?.status||'login_required';
  let overlay=initiallyBlocked;
  let approved=false;
  let checking=false;
  let switching=false;
  let lastDeniedAt=0;

  function installCss(){
    if(document.getElementById('starry-download-access-css'))return;
    const style=document.createElement('style');
    style.id='starry-download-access-css';
    style.textContent=[
      '.starry-access-overlay{position:fixed;inset:0;z-index:2147483647;',
      'display:grid;place-items:center;box-sizing:border-box;padding:24px;',
      'background:rgba(0,0,0,.80);color:#fff;text-align:center;',
      'font-family:system-ui,-apple-system,sans-serif}',
      '.starry-access-panel{position:relative;width:min(430px,100%);padding:16px}',
      '.starry-access-panel h1{font-size:clamp(23px,5vw,31px);',
      'line-height:1.4;font-weight:800;margin:14px 0 24px}',
      '.starry-access-primary{border:0;border-radius:12px;background:#f3f6ff;',
      'color:#101827;padding:12px 24px;min-width:168px;',
      'font:bold 16px system-ui,sans-serif;cursor:pointer}',
      '.starry-access-close{position:absolute;top:0;right:0;border:0;',
      'background:transparent;color:white;font-size:30px;cursor:pointer;',
      'width:44px;height:44px}',
      '.starry-access-google{display:flex;justify-content:center;margin-top:16px}',
      '.starry-access-fallback{display:block;color:#fff;margin-top:12px;',
      'font-size:14px}',
      '.starry-access-status{font-size:13px;color:#ffdee0;margin:14px 0}',
      '.starry-access-overlay [hidden]{display:none!important}'
    ].join('');
    document.head.appendChild(style);
  }

  function showError(message){
    const node=overlay?.querySelector('[data-access-error]');
    if(node){node.hidden=!message;node.textContent=message||'';}
  }

  function hide(){
    if(serverPage)return;
    overlay?.remove();
    overlay=null;
  }

  function show(status){
    installCss();
    const mask=document.createElement('div');
    mask.id='starry-access-gate';
    mask.className='starry-access-overlay';
    mask.setAttribute('role','dialog');
    mask.setAttribute('aria-modal','true');
    mask.setAttribute('aria-label',status==='unavailable'
      ?'權限驗證暫時無法使用':'您尚未開通本服務');
    const panel=document.createElement('div');
    panel.className='starry-access-panel';
    if(!serverPage){
      const close=document.createElement('button');
      close.type='button';close.className='starry-access-close';
      close.setAttribute('aria-label','關閉');
      close.textContent='×';
      close.addEventListener('click',event=>{
        event.stopPropagation();
        hide();
      });
      panel.appendChild(close);
    }
    const lock=document.createElement('div');
    lock.textContent='🔒';
    lock.style.fontSize='38px';
    lock.setAttribute('aria-hidden','true');
    panel.appendChild(lock);
    const title=document.createElement('h1');
    title.textContent=status==='unavailable'
      ?'權限驗證暫時無法使用':'您尚未開通本服務';
    panel.appendChild(title);
    if(status!=='unavailable'){
      const action=document.createElement('button');
      action.type='button';
      action.className='starry-access-primary';
      action.textContent=status==='denied'?'切換身分':'登入';
      panel.appendChild(action);
      const slot=document.createElement('div');
      slot.className='starry-access-google';slot.hidden=true;
      panel.appendChild(slot);
      const fallback=document.createElement('a');
      fallback.className='starry-access-fallback';
      fallback.href='https://id.starry.phd/';
      fallback.textContent='前往 Starry ID 切換身分';
      fallback.hidden=true;
      panel.appendChild(fallback);
      action.addEventListener('click',event=>{
        event.stopPropagation();
        fallback.hidden=false;
        identity.accountChooser(slot,async credential=>{
          if(switching)return;
          switching=true;
          showError('正在切換 Starry ID 共用身分…');
          try{
            const outcome=await identity.switchGlobal(credential);
            if(outcome==='redirecting')return;
            show(outcome==='denied'?'denied':'unavailable');
            if(outcome==='denied')lastDeniedAt=Date.now();
          }catch(error){
            showError(error?.message||'切換身分暫時失敗');
          }finally{switching=false;}
        });
      });
    }
    const message=document.createElement('p');
    message.setAttribute('role','status');
    message.dataset.accessError='1';
    message.className='starry-access-status';
    message.hidden=true;
    panel.appendChild(message);
    mask.appendChild(panel);
    if(overlay)overlay.replaceWith(mask);
    else document.body.appendChild(mask);
    overlay=mask;
  }

  async function check(){
    if(checking||switching||approved)return;
    checking=true;
    try{
      const status=await identity.check();
      if(status==='allowed'){approved=true;hide();return;}
      if(status==='redirecting')return;
      if(status==='denied')lastDeniedAt=Date.now();
      show(status==='denied'?'denied':
        status==='login_required'?'login_required':'unavailable');
    }catch(error){
      show('unavailable');
      showError(error?.message||'權限驗證暫時無法使用');
    }finally{checking=false;}
  }

  function markStale(){
    // Another Starry App might have switched the central identity.
    // Never reload or redirect automatically on focus/background events.
    approved=false;
  }

  function clickGuard(event){
    if(serverPage||approved)return;
    if(!event.isTrusted)return;
    if(overlay?.contains(event.target))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(overlay||checking)return;
    if(Date.now()-lastDeniedAt<4000){show('denied');return;}
    void check();
  }

  installCss();
  window.StarryDownloadInteractionGate=Object.freeze({
    check,markStale,
    showDenied:()=>show('denied'),
    showLogin:()=>show('login_required')
  });
  if(serverPage){
    show(['denied','unavailable'].includes(startStatus)?startStatus:'login_required');
  }else{
    window.addEventListener('click',clickGuard,true);
    window.addEventListener('keydown',event=>{
      if(approved||overlay||serverPage||!event.isTrusted)return;
      if(event.key!=='Enter'&&event.key!==' ')return;
      if(!document.activeElement?.matches?.('button,a,input,select,[role="button"]'))return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void check();
    },true);
    window.addEventListener('focus',markStale);
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible')markStale();
    });
  }
})();