(() => {
  'use strict';
  if(window.StarryDownloadIdentity)return;
  const CENTRAL='https://id.starry.phd';
  const CLIENT_ID='661055525630-ndcq5gtr16h7rqqprlqqkkvineea87lc.apps.googleusercontent.com';
  // Original fetch is captured BEFORE the legacy SSO wrapper. Internal
  // session replacement must never log out the shared central identity.
  const request=window.fetch.bind(window);
  const json=async response=>response.json().catch(()=>({}));
  const text=value=>String(value??'').trim();

  async function local(){
    try{
      const response=await request('/api/download-access/status',{
        credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
      const data=await json(response);
      return ['allowed','guest_allowed','denied','login_required','unavailable'].includes(data.status)
        ? data:{status:'unavailable'};
    }catch{return {status:'unavailable'};}
  }

  async function central(){
    try{
      const response=await request(CENTRAL+'/api/ecosystem/session',{
        credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});
      const data=await json(response);
      if(response.ok && data.authenticated && data.user?.id)
        return {authenticated:true,userId:text(data.user.id)};
      if(response.ok || response.status===401)return {authenticated:false};
      return null;
    }catch{return null;}
  }

  async function logoutLocal(){
    const response=await request('/api/auth/starry/logout',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json','X-Starry-Local-Only':'1'},body:'{}'});
    if(!response.ok)throw new Error('暫時無法安全切換身分，請稍後再試');
  }

  async function ticket(){
    const response=await request(CENTRAL+'/api/apps/downloadstarry/ticket',{
      method:'POST',credentials:'include',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await json(response);
    return {ok:response.ok,code:text(data.code),denied:response.status===403};
  }

  async function useCentralIdentity(){
    const t=await ticket();
    if(t.ok&&t.code){
      window.location.replace('/auth/callback?code='+encodeURIComponent(t.code));
      return 'redirecting';
    }
    return t.denied?'denied':'unavailable';
  }

  async function check(){
    const [app,shared]=await Promise.all([local(),central()]);
    if(app.status==='unavailable')return 'unavailable';
    if(shared?.authenticated){
      if(app.status==='allowed'&&app.userId===shared.userId)return 'allowed';
      if(app.status==='allowed'||app.status==='denied')await logoutLocal();
      return useCentralIdentity();
    }
    // A guest policy can unlock ONLY harmless homepage UI interactions.
    // Logged-in members never inherit guest privileges to override a denial.
    if(shared?.authenticated===false && app.status==='guest_allowed')return 'allowed';
    if(shared===null && app.status==='allowed')return 'allowed';
    if(shared?.authenticated===false && app.status==='allowed')await logoutLocal();
    if(shared===null && app.status==='denied')return 'denied';
    return 'login_required';
  }

  async function switchGlobal(credential){
    if(!credential)return 'login_required';
    // Every account change explicitly updates the central Starry ID identity.
    // Using appId=downloadstarry here would reject a denied member BEFORE
    // changing the shared identity, leaving other Apps on the old account.
    await logoutLocal();
    const response=await request(CENTRAL+'/api/google-sync',{
      method:'POST',credentials:'include',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({credential,appId:'starry-id'})});
    const data=await json(response);
    if(!response.ok||!data.success)
      throw new Error(data.error||'無法切換 Starry ID 共用身分');
    return useCentralIdentity();
  }

  function loadGoogle(){
    if(window.google?.accounts?.id||document.querySelector('script[data-starry-gate-google]'))return;
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;script.defer=true;script.dataset.starryGateGoogle='1';
    document.head.appendChild(script);
  }

  function accountChooser(slot,callback){
    loadGoogle();
    const begin=Date.now();
    function ready(){
      if(!slot.isConnected)return;
      if(!window.google?.accounts?.id){
        if(Date.now()-begin<7000)window.setTimeout(ready,140);
        return;
      }
      try{
        window.google.accounts.id.initialize({
          client_id:CLIENT_ID,
          callback:result=>callback(text(result?.credential)),
          ux_mode:'popup',auto_select:false,cancel_on_tap_outside:true,itp_support:true
        });
        slot.hidden=false;
        slot.replaceChildren();
        window.google.accounts.id.renderButton(slot,{
          theme:'filled_black',size:'large',shape:'pill',
          text:'continue_with',locale:'zh_TW',width:250
        });
      }catch{}
    }
    ready();
  }

  window.StarryDownloadIdentity=Object.freeze({
    check,switchGlobal,accountChooser,central
  });
})();