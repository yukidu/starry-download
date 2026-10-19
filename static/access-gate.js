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

  // One renderer for checking, denied and login_required. Do not duplicate
  // CSS/status strings here; change static/starry-access.css or -ui.js.
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
    const mask=window.StarryAccessUI.make(status,{
      closable:!serverPage,
      onClose:hide,
      onIdentityAction:({slot})=>{
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
      }
    });
    if(overlay)overlay.replaceWith(mask);
    else document.body.appendChild(mask);
    overlay=mask;
  }

  async function check(){
    if(checking||switching||approved)return;
    checking=true;
    // Synchronous render BEFORE the first awaited login/D1 request:
    // no 2-second blank period, and no unverified "denied" accusation.
    show('checking');
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