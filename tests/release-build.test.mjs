import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPlan} from '../scripts/release/plan.mjs';
test('default local desktop build needs no signing secret or GitHub publishing',()=>{
 const pkg=JSON.parse(readFileSync('package.json'));assert.equal(pkg.scripts['desktop:build'],'node scripts/build-release.mjs --local');
 const plan=buildPlan(['--local','--ci','--target','aarch64-apple-darwin'],{});
 assert.equal(plan.publishPreviews,false);assert.equal(plan.createUpdaterArtifacts,false);assert.deepEqual(plan.cliArgs,['--ci','--target','aarch64-apple-darwin']);
});
test('updater and release builds require the original key and publish verified assets',()=>{
 assert.throws(()=>buildPlan(['--ci'],{}),/签名私钥/);const plan=buildPlan(['--ci'],{TAURI_SIGNING_PRIVATE_KEY:'test-only-key-placeholder'});
 assert.equal(plan.publishPreviews,true);assert.equal(plan.createUpdaterArtifacts,true);
 const pkg=JSON.parse(readFileSync('package.json'));assert.equal(pkg.scripts['desktop:update:build'],pkg.scripts['desktop:release:build']);assert.equal(pkg.scripts['desktop:experimental:build'],'tauri build');
});
