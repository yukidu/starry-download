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

test('Already synchronized central/local authorized identity requires no extra ticket or logout',async()=>{
  const env=sharedHarness({ticketAllowed:true,local:'allowed',central:'u-new'});
  assert.equal(await env.identity.check(),'allowed');
  assert.equal(env.calls.length,2);
  assert.ok(!env.calls.some(c=>c.url.includes('ticket')||c.url.includes('logout')));
});

test('First interaction triggers checks without background navigation, then caches approval',async()=>{
  const calls=[],events={},docEvents={};
  const document={
    getElementById:()=>null,
    createElement:()=>({id:'',textContent:'',dataset:{}}),
    head:{appendChild(){}},
    addEventListener:(event,fn)=>{docEvents[event]=fn},
    activeElement:null
  };
  const window={
    StarryDownloadIdentity:{
      check:async()=>{calls.push('check');return 'allowed';},
      accountChooser(){},
      switchGlobal:async()=> 'denied'
    },
    addEventListener:(event,fn)=>{events[event]=fn}
  };
  vm.runInNewContext(source('static/access-gate.js'),{
    window,document,Date,Promise
  });
  assert.deepEqual(calls,[],'No automatic access checks at page load');
  assert.equal(typeof events.click,'function');
  const event={isTrusted:true,target:{},preventDefault(){},stopImmediatePropagation(){}};
  events.click(event);
  await new Promise(done=>setTimeout(done,0));
  assert.deepEqual(calls,['check']);
  events.click(event);
  await new Promise(done=>setTimeout(done,0));
  assert.deepEqual(calls,['check'],'Approved interactions should not cause repeated D1 reads');
  events.focus();
  events.click(event);
  await new Promise(done=>setTimeout(done,0));
  assert.deepEqual(calls,['check','check'],'After focus, a new click verifies common Starry identity');
});
