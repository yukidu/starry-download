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
test('no public download: all App pages and APIs now require central member access',()=>{
 const s=readFileSync(new URL('../cloudflare/worker.js',import.meta.url),'utf8');
 const gate=readFileSync(new URL('../cloudflare/download-access-gate.js',import.meta.url),'utf8');
 assert.match(s,/shouldCheckDownloadAccess\(url,method\)/);
 assert.match(s,/resolveDownloadAccess\(request,env\)/);
 assert.match(s,/accessDeniedResponse\(request,access\)/);
 assert.match(gate,/APP_ID = 'downloadstarry'/);
 assert.doesNotMatch(s,/const memberOnlyPath/);
});
