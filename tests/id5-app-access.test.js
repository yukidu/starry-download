import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkCentralAppEntitlement,STARRY_APP_GRANT_CUTOFF} from '../cloudflare/central-app-access.js';
function db(row){return {prepare:()=>({bind:()=>({first:async()=>row})})};}
test('download grants and denies correctly without removing old memberships',async()=>{
 const old=STARRY_APP_GRANT_CUTOFF-1000,newer=STARRY_APP_GRANT_CUTOFF+1000;
 assert.equal((await checkCentralAppEntitlement(db({status:'active',createdAt:old,decision:null,membershipStatus:'active'}),'u1','downloadstarry')).allowed,true);
 assert.equal((await checkCentralAppEntitlement(db({status:'active',createdAt:old,decision:'deny',membershipStatus:'active'}),'u1','downloadstarry')).allowed,false);
 assert.equal((await checkCentralAppEntitlement(db({status:'active',createdAt:newer,decision:null,membershipStatus:null}),'u1','downloadstarry')).code,'NEEDS_APPROVAL');
 assert.equal((await checkCentralAppEntitlement(db({status:'active',createdAt:newer,decision:'allow',membershipStatus:null}),'u1','downloadstarry')).allowed,true);
 assert.equal((await checkCentralAppEntitlement(db({status:'blocked',createdAt:old,decision:'allow',membershipStatus:null}),'u1','downloadstarry')).allowed,false);
});
test('anonymous downloads stay public while member-only paths are verified',()=>{
 const s=readFileSync(new URL('../cloudflare/worker.js',import.meta.url),'utf8');
 assert.match(s,/const memberOnlyPath/);
 assert.match(s,/checkCentralAppEntitlement/);
 assert.match(s,/APP_ACCESS_DENIED/);
 assert.doesNotMatch(s,/url\.pathname==='\/api\/download'\s*\|\|/);
});
