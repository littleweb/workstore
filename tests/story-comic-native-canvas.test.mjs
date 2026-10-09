import {test,after} from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import vm from 'node:vm';import {createRequire} from 'node:module';import {JSDOM} from 'jsdom';import React,{act} from 'react';
const dom=new JSDOM('<body></body>',{url:'http://localhost'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
Object.defineProperty(dom.window.HTMLElement.prototype,'clientWidth',{get(){return 1000;}});Object.defineProperty(dom.window.HTMLElement.prototype,'clientHeight',{get(){return 700;}});
const require=createRequire(import.meta.url),{createRoot}=await import('react-dom/client');
const frames=new Map();let serial=0;
function drain(){const entries=[...frames];frames.clear();for(const [,fn]of entries)fn();}
const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:['src/story-comic/ComicCanvas.tsx'],bundle:true,write:false,format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','@ant-design/icons']}).outputFiles[0].text,{module,window:dom.window,requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){this.fn();}disconnect(){}},require:id=>id==='@ant-design/icons'?new Proxy({},{get:()=>()=>null}):require(id)});
after(()=>dom.window.close());
test('native canvas keeps twenty pages virtual while scrolling and zooming, and releases its frame on unmount',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),Canvas=module.exports.default;
 const children=Array.from({length:20},(_,i)=>React.createElement('article',{'data-test-page':i,key:i},'page'+i));
 await act(async()=>{root.render(React.createElement(Canvas,{children}));});await act(async()=>drain());
 const scroll=host.querySelector('.story-native-scroll');assert.equal(host.querySelector('.react-flow'),null);
 assert(host.querySelectorAll('[data-test-page]').length<=6);
 for(let i=1;i<=18;i++)await act(async()=>{scroll.scrollLeft=i*448;scroll.dispatchEvent(new window.Event('scroll'));drain();});
 assert(host.querySelector('[data-test-page="19"]'));assert(host.querySelectorAll('[data-test-page]').length<=6);
 await act(async()=>{host.querySelector('[aria-label="放大"]').click();drain();});
 assert(host.querySelectorAll('[data-test-page]').length<=6);
 await act(async()=>{root.unmount();});assert.equal(frames.size,0);host.remove();
});
