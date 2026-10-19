import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

function sharedHarness({ticketAllowed=false,local='login_required',central='u-new'}={}){
  const calls=[],navigations=[];
  const browser={
    fetch:async (path,options={})=>{
      const url=String(path),method=options.method||'GET';
      calls.push({url,method,body:options.body||''});
      let code=200,data={};
      if(url.includes('/api/download-access/status')) {
        code=local==='allowed'?200:local==='denied'?403:401;
        data={status:local,...(local==='allowed'?{userId:'u-new'}:{})};
      } else if(url.includes('/api/ecosystem/session')) {
        code=central?200:401;
        data=central?{authenticated:true,user:{id:central}}:{authenticated:false};
      } else if(url.includes('/api/auth/starry/logout')) {
        data={success:true};
      } else if(url.includes('/api/google-sync')) {
        assert.equal(JSON.parse(options.body).appId,'starry-id');
        data={success:true};
      } else if(url.includes('/api/apps/downloadstarry/ticket')){
        code=ticketAllowed?200:403;
        data=ticketAllowed?{code:'long-one-time-auth-code'}:{error:'您尚未開通本服務'};
      } else throw new Error('Unexpected request '+url);
      return {ok:code>=200&&code<300,status:code,json:async()=>data};
    },
    location:{replace:path=>navigations.push(path)}
  };
  const doc={
    querySelector:()=>null,
    createElement:()=>({setAttribute(){},appendChild(){},dataset:{}}),
    head:{appendChild(){}}
  };
  vm.runInNewContext(source('static/starry-account-switch.js'),{
    window:browser,document:doc,Date,JSON,TextEncoder,Promise,URL,encodeURIComponent,
    setTimeout
  });
  return {identity:browser.StarryDownloadIdentity,calls,navigations};
}

test('Changing Google account establishes Starry ID global identity, not App-only login',async()=>{
  const env=sharedHarness({ticketAllowed:true});
  const result=await env.identity.switchGlobal('verified-google-id-token');
  assert.equal(result,'redirecting');
  assert.deepEqual(env.calls.map(c=>c.url),[
    '/api/auth/starry/logout',
    'https://id.starry.phd/api/google-sync',
    'https://id.starry.phd/api/apps/downloadstarry/ticket'
  ]);
  assert.equal(JSON.parse(env.calls[1].body).appId,'starry-id');
  assert.equal(env.navigations.length,1);
  assert.match(env.navigations[0],/^\/auth\/callback\?code=/);
  assert.ok(!env.calls.some(c=>c.url.includes('/api/logout')));
});

test('A globally switched but forbidden identity remains selected centrally without local access',async()=>{
  const env=sharedHarness({ticketAllowed:false});
  const result=await env.identity.switchGlobal('another-google-account');
  assert.equal(result,'denied');
  assert.deepEqual(env.calls.map(c=>c.url),[
    '/api/auth/starry/logout',
    'https://id.starry.phd/api/google-sync',
    'https://id.starry.phd/api/apps/downloadstarry/ticket'
  ]);
  assert.deepEqual(env.navigations,[]);
});

test('Approved anonymous visitor may interact with the homepage, but never gets a member session',async()=>{
  const guest=sharedHarness({local:'guest_allowed',central:null});
  assert.equal(await guest.identity.check(),'allowed');
  assert.deepEqual(guest.calls.map(x=>x.url),[
    '/api/download-access/status','https://id.starry.phd/api/ecosystem/session'
  ]);
  assert.equal(guest.navigations.length,0);
  const signed=sharedHarness({local:'guest_allowed',central:'member-not-granted'});
  assert.equal(await signed.identity.check(),'denied',
    'Logged-in account denied member rights must not bypass by acting as guest');
  assert.ok(signed.calls.some(x=>x.url.includes('/ticket')));
});

test('Already synchronized central/local authorized identity requires no extra ticket or logout',async()=>{
  const env=sharedHarness({ticketAllowed:true,local:'allowed',central:'u-new'});
  assert.equal(await env.identity.check(),'allowed');
  assert.equal(env.calls.length,2);
  assert.ok(!env.calls.some(c=>c.url.includes('ticket')||c.url.includes('logout')));
});


function gestureHarness(){
  const calls=[],events={},docEvents={};
  let pending=null;

  function el(tagName){
    return {
      tagName,children:[],parent:null,id:'',textContent:'',dataset:{},attrs:{},listeners:{},
      hidden:false,style:{},isConnected:true,
      setAttribute(name,value){this.attrs[name]=value;},
      addEventListener(type,handler){this.listeners[type]=handler;},
      appendChild(child){child.parent=this;this.children.push(child);return child;},
      remove(){
        if(this.parent){
          const i=this.parent.children.indexOf(this);
          if(i>=0)this.parent.children.splice(i,1);
        }
        this.parent=null;this.isConnected=false;
      },
      replaceWith(next){
        if(!this.parent)throw Error('detached');
        const i=this.parent.children.indexOf(this);
        this.parent.children[i]=next;
        next.parent=this.parent;
        this.parent=null;this.isConnected=false;
      },
      contains(target){
        return this===target||this.children.some(node=>node.contains(target));
      },
      querySelector(selector){
        if(selector==='[data-access-error]')
          return this.children.find(node=>node.dataset?.accessError)||this.children
            .map(node=>node.querySelector(selector)).find(Boolean)||null;
        return null;
      }
    };
  }
  const head=el('head'),body=el('body');
  function walk(node,id){
    if(node.id===id)return node;
    for(const child of node.children){const found=walk(child,id);if(found)return found;}
    return null;
  }
  const document={
    head,body,activeElement:null,
    getElementById:id=>walk(head,id)||walk(body,id),
    createElement:el,
    addEventListener:(event,callback)=>{docEvents[event]=callback;}
  };
  const window={
    StarryDownloadIdentity:{
      check(){
        calls.push('check');
        return new Promise((resolve,reject)=>{pending={resolve,reject};});
      },
      accountChooser(){},
      switchGlobal:async()=> 'denied'
    },
    addEventListener:(name,handler)=>{events[name]=handler;}
  };
  const vmContext=vm.createContext({window,document,Date,Promise});
  vm.runInContext(source('static/starry-access-ui.js'),vmContext);
  vm.runInContext(source('static/access-gate.js'),vmContext);
  const mask=()=>document.getElementById('starry-access-gate');
  const children=()=>mask()?.children?.[0]?.children||[];
  const heading=()=>children().find(node=>node.tagName==='h1')?.textContent;
  const button=()=>children().find(node=>node.tagName==='button'&&node.textContent!=='×')?.textContent;
  const click=()=>{
    const event={
      isTrusted:true,target:el('a'),
      preventDefault(){},stopImmediatePropagation(){}
    };
    events.click(event);
  };
  return {window,document,calls,events,docEvents,mask,children,heading,button,
    click,settle:value=>pending.resolve(value),reject:error=>pending.reject(error)};
}

const finish=()=>new Promise(done=>setImmediate(done));

test('Click paints the 60-percent checking overlay synchronously before any auth request settles',async()=>{
  const screen=gestureHarness();
  assert.equal(screen.mask(),null,'No overlay or rights check on page load');
  assert.deepEqual(screen.calls,[]);
  const css=source('static/starry-access.css');
  assert.match(css,/--starry-access-black-opacity: \.60/);
  screen.click();
  assert.equal(screen.heading(),'正在確認權限…','Pending screen must appear within the click handler');
  assert.equal(screen.button(),undefined,'Pending auth cannot falsely show login/switch actions');
  assert.equal(screen.mask().attrs['aria-busy'],'true');
  assert.equal(screen.mask().attrs['aria-label'],'正在確認權限…');
  assert.equal(screen.calls.length,1,'Exactly one login check started');
  screen.click();
  assert.equal(screen.calls.length,1,'Repeated click while pending cannot spawn duplicate API requests');
  screen.settle('denied');
  await finish();
  assert.equal(screen.heading(),'您尚未開通本服務');
  assert.equal(screen.button(),'切換身分');
});

test('A permitted member sees the immediate pending overlay removed after authorization',async()=>{
  const screen=gestureHarness();
  screen.click();
  assert.equal(screen.heading(),'正在確認權限…');
  screen.settle('allowed');
  await finish();
  assert.equal(screen.mask(),null,'Approved member must not remain blocked');
  screen.click();
  assert.equal(screen.calls.length,1,'Verified session avoids unnecessary D1 lookups');
  screen.events.focus();
  screen.click();
  assert.equal(screen.heading(),'正在確認權限…','Focus never checks until another click');
  assert.equal(screen.calls.length,2);
  screen.settle('allowed');
  await finish();
  assert.equal(screen.mask(),null);
});

test('Guest, outage, and denied member have the correct final screen only after verification',async()=>{
  for(const [status,heading,button] of [
    ['login_required','您尚未開通本服務','登入'],
    ['unavailable','權限驗證暫時無法使用',undefined],
    ['denied','您尚未開通本服務','切換身分']
  ]){
    const screen=gestureHarness();
    screen.click();
    assert.equal(screen.heading(),'正在確認權限…');
    screen.settle(status);
    await finish();
    assert.equal(screen.heading(),heading);
    assert.equal(screen.button(),button);
  }
  const error=gestureHarness();
  error.click();
  error.reject(new Error('network-failure'));
  await finish();
  assert.equal(error.heading(),'權限驗證暫時無法使用');
});

test('Keyboard activation checks immediately and cannot bypass pending permissions',async()=>{
  const screen=gestureHarness();
  screen.document.activeElement={matches:()=>true};
  const event={
    key:'Enter',isTrusted:true,
    preventDefault(){},stopImmediatePropagation(){}
  };
  assert.equal(screen.mask(),null);
  screen.events.keydown(event);
  assert.equal(screen.heading(),'正在確認權限…');
  screen.settle('allowed');
  await finish();
  assert.equal(screen.mask(),null);
});
