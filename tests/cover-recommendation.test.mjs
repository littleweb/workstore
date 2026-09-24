import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import vm from "node:vm";
const code = buildSync({entryPoints: ["src/covers/recommendation.ts"], bundle:true, write:false, platform:"node", format:"cjs"}).outputFiles[0].text;
const module = {exports:{}};
vm.runInNewContext(code, {module});
const {recommendationPrompt, parseRecommendation} = module.exports;
test("complete recommendation catalog plus maximum theme fits gateway byte budget", () => {
  const prompt = recommendationPrompt("秋".repeat(4000));
  assert.ok(Buffer.byteLength(prompt) < 128000);
  for (const id of ["001", "277", "SC-001", "C-30"]) assert.ok(prompt.includes(id));
});
test("recommendation rejects arbitrary or missing identifiers while preserving original theme", () => {
  const config={style:"042",layout:"SC-001",color:"C-01",title:"秋日",subtitle:"",language:"中文",ratio:"2:3",density:"低",mood:"温暖",instruction:"图文一体"};
  assert.equal(parseRecommendation(JSON.stringify({...config,topic:"changed"}),"original").topic,"original");
  for (const patch of [{style:"999"},{layout:"auto"},{color:"invalid"},{ratio:"7:9"},{title:null}]) {
    assert.throws(() => parseRecommendation(JSON.stringify({...config,...patch}),"topic"));
  }
});
