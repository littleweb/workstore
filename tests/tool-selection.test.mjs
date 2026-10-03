import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const module={exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/toolSelection.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module,setTimeout,clearTimeout});
const event=(overrides={})=>({pointerType:'mouse',isPrimary:true,button:0,detail:1,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,preventDefault(){this.prevented=true},...overrides});
function setup(){const target=new EventTarget(),calls=[];return {target,calls,s:module.exports.createToolSelection(target,id=>calls.push(id))};}
const tick=()=>new Promise(r=>setTimeout(r,10));
test('down-only mouse selects once and trailing click is deduplicated',()=>{const {s,calls}=setup();const e=event();s.pointerDown(e,'notes');assert.equal(e.prevented,true);assert.deepEqual(calls,['notes']);s.click(event(),'notes');assert.deepEqual(calls,['notes']);s.pointerDown(event(),'board');assert.deepEqual(calls,['notes','board']);s.dispose();});
test('touch and pen scroll do not select on press, normal click and keyboard still work',()=>{const {s,calls}=setup();for(const type of ['touch','pen']){s.pointerDown(event({pointerType:type}),'a');assert.equal(calls.length,0);}s.click(event(),'a');s.pointerDown(event(),'b');s.click(event({detail:0}),'c');assert.deepEqual(calls,['a','b','c']);s.dispose();});
test('secondary buttons and modified presses are ignored',()=>{const {s,calls}=setup();for(const e of [event({button:1}),event({button:2}),event({ctrlKey:true}),event({isPrimary:false})])s.pointerDown(e,'a');s.click(event({button:2}),'a');assert.deepEqual(calls,[]);s.dispose();});
test('composition queues latest tool until final input is staged',async()=>{const {s,calls,target}=setup();target.dispatchEvent(new Event('compositionstart'));const e=event();s.pointerDown(e,'a');assert.equal(e.prevented,undefined);s.click(event(),'a');s.pointerDown(event(),'b');target.dispatchEvent(new Event('compositionend'));assert.deepEqual(calls,[]);calls.push('final input');await tick();assert.deepEqual(calls,['final input','b']);s.dispose();});
test('new composition and disposal cancel stale queued selection',async()=>{const {s,calls,target}=setup();target.dispatchEvent(new Event('compositionstart'));s.pointerDown(event(),'a');target.dispatchEvent(new Event('compositionend'));target.dispatchEvent(new Event('compositionstart'));await tick();assert.deepEqual(calls,[]);s.pointerDown(event(),'b');target.dispatchEvent(new Event('compositionend'));s.dispose();await tick();assert.deepEqual(calls,[]);});

test('failed save is not retried by trailing mouse click', async()=>{const target=new EventTarget();let saves=0,active='notes';const tasks=[];const s=module.exports.createToolSelection(target,id=>{tasks.push((async()=>{saves++;throw Error('disk failed');})().then(()=>{active=id},()=>{}));});s.pointerDown(event(),'board');await Promise.all(tasks);s.click(event(),'board');await Promise.all(tasks);assert.equal(saves,1);assert.equal(active,'notes');s.dispose();});
