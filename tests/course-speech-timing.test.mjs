import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitSpeechScenes,maxSpeechTempo} from '../scripts/ai/speech-timing.mjs';

test('comfortable speech retains the original scene durations without stretching',()=>{
 assert.deepEqual(fitSpeechScenes([{seconds:10},{seconds:10},{seconds:10}],[8,7,6],30),[10,10,10]);
});
test('one longer sentence gets time from quieter scenes while keeping the selected duration',()=>{
 const result=fitSpeechScenes([{seconds:10},{seconds:10},{seconds:10}],[12,4,5],30);
 assert.equal(result.reduce((a,b)=>a+b,0),30);
 assert.ok(result[0]>=13);
 assert.ok(result.every(n=>Number.isInteger(n)&&n>=3&&n<=40));
});
test('small compression stays within the natural speech ceiling',()=>{
 const result=fitSpeechScenes([{seconds:10},{seconds:10},{seconds:10}],[10,10,10],30);
 assert.equal(result.reduce((a,b)=>a+b,0),30);
 assert.ok(result.every((n,i)=>10/(n-.5)<=maxSpeechTempo));
});
test('excessive narration is refused instead of producing rushed mechanical speech',()=>{
 assert.throws(()=>fitSpeechScenes([{seconds:10},{seconds:10},{seconds:10}],[20,20,20],30),/自然语速/);
});
test('invalid speech measurements cannot allocate scene time',()=>{
 assert.throws(()=>fitSpeechScenes([{seconds:10}],[NaN],10));
 assert.throws(()=>fitSpeechScenes([{seconds:10}],[],10));
});
