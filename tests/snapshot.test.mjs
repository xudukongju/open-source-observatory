import test from 'node:test';
import assert from 'node:assert/strict';
import {readSnapshot,onRequestGet} from '../functions/api/snapshot.js';
const data={schema:1,generated_at:'2026-11-11T08:12:57Z',projects:[],releases:[],history:[],followups:[]};
test('public snapshot retains original observation time and caches for 60 seconds',async()=>{
 const r=await readSnapshot(async(url)=>{assert.equal(url,'https://raw.githubusercontent.com/xudukongju/open-source-observatory/main/data/snapshot.json');return Response.json(data)});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),data);assert.equal(r.headers.get('Cache-Control'),'public, max-age=60');
});
test('failed source is a non-cached error, not invented empty data',async()=>{
 for(const fetcher of [async()=>new Response('',{status:404}),async()=>Response.json({error:true}),async()=>{throw Error('offline')}]){
  const r=await readSnapshot(fetcher);assert.equal(r.status,503);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.ok((await r.json()).error);
 }
});
test('cache lookup strips visitor parameters; cache hits do not refetch',async()=>{
 const before=globalThis.caches;
 globalThis.caches={default:{match:async key=>{assert.equal(key.url,'https://example.com/api/snapshot');return Response.json(data)},put:()=>{throw Error('unexpected')}}};
 try{const r=await onRequestGet({request:new Request('https://example.com/api/snapshot?url=https://private.example'),waitUntil:()=>{throw Error('unexpected')}});assert.deepEqual(await r.json(),data)}finally{globalThis.caches=before}
});
test('KV and GitHub select newest actual observation; outages retain original time',async()=>{
 const fresh={...data,generated_at:'2026-11-12T04:00:00Z'};
 for(const [cloud,git,expected] of [[fresh,data,fresh],[data,fresh,fresh],[fresh,null,fresh],[null,data,data]]){
  const r=await readSnapshot(async()=>{if(!git)throw Error('offline');return Response.json(git)},{get:async()=>cloud});
  assert.deepEqual(await r.json(),expected);
 }
});
