import test from 'node:test';
import assert from 'node:assert/strict';
import {total,downloads,freshness,feedback,safeUrl,escapeHtml,validate} from '../dist/model.js';
const p={metrics:{ok:true,value:{stargazers_count:0}},releases:{ok:true,value:[]},issues:{ok:true,value:[]},promotions:[]};
test('zero is data; absent metrics are unknown',()=>{assert.equal(total([p],'stargazers_count'),0);assert.equal(total([p,{}],'stargazers_count'),null);assert.equal(downloads(p),0);assert.equal(downloads({}),null)});
test('stale and partial failures remain visible',()=>{let d={generated_at:'2026-01-01T00:00:00Z',projects:[p]};assert.equal(freshness(d,Date.parse('2026-01-01T00:46:00Z')).stale,true);assert.equal(freshness(d,Date.parse('2026-01-01T00:30:00Z')).stale,false);d.projects=[{...p,issues:{ok:false,value:[]}}];assert.equal(freshness(d).failed.length,1)});
test('public untrusted content cannot become markup or executable URLs',()=>{assert.equal(safeUrl('javascript:alert(1)'),'#');assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');assert.equal(safeUrl('https://github.com/x'),'https://github.com/x')});
test('feedback merges issue and promotion comments',()=>{assert.equal(feedback({...p,id:'x',issues:{value:[{id:1}]},promotions:[{value:{comments:[{id:2}]}}]}).length,2)});
test('malformed snapshot rejected',()=>{assert.throws(()=>validate({projects:[]}));assert.throws(()=>validate(null))});
