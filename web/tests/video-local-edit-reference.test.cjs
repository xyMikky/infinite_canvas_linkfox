const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const text=fs.readFileSync(require('node:path').join(__dirname,'../src/components/canvas/canvas-node-generation.ts'),'utf8');
const read=vm.runInNewContext(stripTypeScriptTypes(text.slice(text.indexOf('function readReferenceVideo('),text.indexOf('function readReferenceAudio(')))+';readReferenceVideo',{CanvasNodeType:{Video:'video'}});
const node={id:'v1',type:'video',title:'原视频',metadata:{content:'blob:original',storageKey:'original',durationMs:20000,clipStartMs:1000,includeAudio:true,videoLocalEdit:{inputStorageKey:'crop',inputWidth:720,inputHeight:900,range:{generationSeconds:3}}}};
test('local workbench reference uses only prepared media and excludes original trim/audio',()=>{
 const ref=read(node,true);
 assert.equal(ref.storageKey,'crop');assert.equal(ref.url,'');assert.match(ref.name,/局部预处理/);
 assert.equal(ref.durationMs,3000);assert.equal(ref.width,720);assert.equal(ref.includeAudio,false);assert.equal(ref.clipStartMs,undefined);
});
test('ordinary workbench keeps original video even when local preprocessing exists',()=>{
 const ref=read(node,false);assert.equal(ref.storageKey,'original');assert.equal(ref.durationMs,20000);assert.equal(ref.includeAudio,true);
});
