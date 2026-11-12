import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {collect, discussion, githubClient, pages, scheduledRun, source, ROOT} from '../worker/collector.js';
const checked='2026-11-12T04:00:00.000Z';
const registry={account:'xudukongju',timezone:'Asia/Shanghai',projects:[{id:'test',repo:'xudukongju/test',discussions:[{repo:'someone/public',number:1,channel:'test'}]}],followups:[]};
const ledger={entries:[]};
const empty={schema:1,generated_at:'2026-11-12T03:00:00.000Z',projects:[],releases:[],followups:[],history:[{at:'2026-11-12T03:00:00.000Z',project:'test',stars:1,forks:0}]};
const end={hasNextPage:false,endCursor:null};
const node={title:'Discussion',url:'https://github.com/someone/public/discussions/1',updatedAt:checked,upvoteCount:1,comments:{nodes:[],pageInfo:end}};
async function api(path){
 if(path==='graphql') return {data:{repository:{isPrivate:false,discussion:node}}};
 if(path==='repos/xudukongju/test') return {private:false,stargazers_count:2,forks_count:0,subscribers_count:1,archived:false,pushed_at:checked};
 return [];
}
function kv(initial={}){const m=new Map(Object.entries(initial));return {get:async k=>m.get(k)??null,put:async(k,v)=>m.set(k,JSON.parse(v))};}
function fakeFetch(url){
 if(url.startsWith(ROOT)) return Promise.resolve(Response.json({'registry.json':registry,'releases.json':ledger,'snapshot.json':empty}[url.slice(ROOT.length)]));
 return api(url.slice('https://api.github.com/'.length)).then(Response.json);
}
test('full collection preserves history and original contracts',async()=>{
 const r=await collect(registry,ledger,empty,api,checked);
 assert.equal(r.collector,'cloudflare-cron');assert.equal(r.history.length,2);assert.equal(r.projects[0].metrics.value.stargazers_count,2);
 assert.equal(r.projects[0].promotions[0].value.comment_count,0);assert.equal(r.projects[0].issues.ok,true);
});
test('source failure retains old observation, never exposes arbitrary errors',async()=>{
 const r=await source({observed_at:'old',value:7},()=>{throw Error('secret')},checked);
 assert.equal(r.value,7);assert.equal(r.observed_at,'old');assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes('secret'));
});
test('private repositories are never enumerated',async()=>{
 const paths=[];const r=await collect({...registry,projects:[{id:'test',repo:'xudukongju/test'}]},ledger,empty,async p=>{paths.push(p);return {private:true}},checked);
 assert.deepEqual(paths,['repos/xudukongju/test']);assert.equal(r.projects[0].issues.value,null);assert.equal(r.projects[0].releases.ok,false);
});
test('REST pagination reads next page',async()=>assert.equal((await pages(async p=>p.endsWith('page=1')?Array(100).fill(1):[2],'repos/a/b/issues')).length,101));
test('GraphQL repeated cursor fails rather than truncating',async()=>{
 await assert.rejects(()=>discussion(async()=>({data:{repository:{isPrivate:false,discussion:{...node,comments:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'same'}}}}}}),registry.projects[0].discussions[0],'xudukongju'),/cursor/);
});
test('GraphQL reads paginated replies and marks new external reply',async()=>{
 let calls=0;
 const c={id:'id',url:'https://github.com/comment',bodyText:'help',createdAt:'2026-11-11',author:{login:'visitor'},replies:{nodes:[{author:{login:'xudukongju'},createdAt:'2026-11-12'}],pageInfo:{hasNextPage:true,endCursor:'next'}}};
 const result=await discussion(async(_p,q)=>{calls++;return q.includes('node(id:')?{data:{node:{replies:{nodes:[{author:{login:'visitor'},createdAt:'2026-11-13'}],pageInfo:end}}}}:{data:{repository:{isPrivate:false,discussion:{...node,comments:{nodes:[c],pageInfo:end}}}}}},registry.projects[0].discussions[0],'xudukongju');
 assert.equal(calls,2);assert.equal(result.comment_count,3);assert.equal(result.comments[0].state,'needs_reply');
});
test('credentials stay in fixed official API headers',async()=>{
 let calls=0;const client=githubClient('test-secret',async(url,opts)=>{calls++;assert.equal(url,'https://api.github.com/graphql');assert.equal(opts.headers.Authorization,'Bearer test-secret');assert.equal(opts.redirect,'error');return Response.json({data:{}})});
 await client('graphql','query{viewer{login}}');await assert.rejects(()=>client('https://evil.test'),/path/);assert.equal(calls,1);
});
test('scheduled run publishes snapshot and health; no token exposed',async()=>{
 const env={OBSERVATORY:kv(),GITHUB_READ_TOKEN:'test-secret'};
 await scheduledRun({scheduledTime:Date.parse(checked)},env,fakeFetch);
 assert.equal((await env.OBSERVATORY.get('health')).status,'ok');assert.equal((await env.OBSERVATORY.get('snapshot')).history.length,2);
 assert.ok(!JSON.stringify(await env.OBSERVATORY.get('snapshot')).includes('test-secret'));
});
test('missing authorization retains snapshot, and normal handler ignores execution context',async()=>{
 const env={OBSERVATORY:kv({snapshot:empty})};
 await assert.rejects(()=>handler.scheduled({scheduledTime:Date.now()},env,{waitUntil(){}}));
 assert.equal((await env.OBSERVATORY.get('health')).status,'awaiting_authorization');assert.deepEqual(await env.OBSERVATORY.get('snapshot'),empty);
});
test('partial failure is visible and preserves source values',async()=>{
 const old=await collect(registry,ledger,empty,api,checked);const env={OBSERVATORY:kv({snapshot:old}),GITHUB_READ_TOKEN:'test-secret'};
 await assert.rejects(()=>scheduledRun({scheduledTime:Date.now()},env,async(url)=>url.endsWith('/graphql')?new Response('',{status:403}):fakeFetch(url)));
 assert.equal((await env.OBSERVATORY.get('health')).status,'partial_failure');
 const p=(await env.OBSERVATORY.get('snapshot')).projects[0].promotions[0];assert.equal(p.ok,false);assert.equal(p.observed_at,checked);assert.equal(p.value.comment_count,0);
});
test('public handler offers no remote trigger or secret endpoint',async()=>{
 const env={OBSERVATORY:kv({snapshot:empty})};
 assert.equal((await handler.fetch(new Request('https://x/snapshot',{method:'POST'}),env)).status,405);
 assert.equal((await handler.fetch(new Request('https://x/trigger'),env)).status,404);
 assert.deepEqual(await (await handler.fetch(new Request('https://x/snapshot'),env)).json(),empty);
});
test('real scheduled handler accepts Cloudflare ExecutionContext',async()=>{
 const original=globalThis.fetch;globalThis.fetch=fakeFetch;
 const env={OBSERVATORY:kv(),GITHUB_READ_TOKEN:'test-secret'};
 try{await handler.scheduled({scheduledTime:Date.now()},env,{waitUntil(){}});assert.equal((await env.OBSERVATORY.get('health')).status,'ok')}finally{globalThis.fetch=original}
});
