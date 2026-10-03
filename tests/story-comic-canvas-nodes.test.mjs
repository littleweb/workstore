import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';import vm from 'node:vm';
import {adoptUserNodes,nodeHasDimensions} from '@xyflow/system';
const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:['src/story-comic/canvasNodes.ts'],bundle:true,write:false,format:'cjs'}).outputFiles[0].text,{module});
const {comicNodes}=module.exports;
test('CSS-only nodes reproduce hidden state without size callbacks, while fixed nodes are initialized immediately',()=>{
 const nodes=new Map(),parents=new Map();
 const old={id:'0',position:{x:0,y:0},data:{},style:{width:420,height:640}};
 adoptUserNodes([old],nodes,parents);
 assert.equal(nodeHasDimensions(nodes.get('0')),false);
 for(let tick=0;tick<100;tick++){
  const result=adoptUserNodes(comicNodes(Array.from({length:6},(_,i)=>`page${i}-status${tick}`)),nodes,parents);
  assert.equal(result.nodesInitialized,true);
  for(const node of nodes.values()){
   assert.equal(nodeHasDimensions(node),true);
   assert.equal(node.measured.width,420);
   assert.equal(node.measured.height,640);
  }
 }
});
