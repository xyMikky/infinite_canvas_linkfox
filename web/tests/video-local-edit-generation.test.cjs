const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const read=name=>stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,`../src/lib/canvas/${name}.ts`),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const commit=vm.runInNewContext(read('video-local-edit-commit')+';applyVideoLocalEditResult');
const restore=(...args)=>vm.runInNewContext(read('video-local-edit-commit')+';applyVideoLocalEditRestore')(...args);
const plan={id:'p1',baseStorageKey:'base:s0',originalStorageKey:'original:s0',currentStorageKey:'base:s0',inputStorageKey:'input:24fps',inputWidth:960,inputHeight:720,range:{generationSeconds:3},original:{width:64,height:48,duration:6}};
const target=()=>({id:'video',type:'video',position:{x:0,y:0},width:64,height:48,metadata:{storageKey:'base:s0',content:'url:s0',videoLocalEdit:{...plan}}});
const bench=()=>({id:'bench',type:'config',position:{x:200,y:0},width:100,height:100,metadata:{videoLocalEditTargetId:'video'}});
const result={storageKey:'result:s1',url:'url:s1',mimeType:'video/mp4',bytes:99};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};

test('commit fills only the result placeholder and preserves the source',()=>{
 const source=target(), workbench=bench();workbench.metadata.videoLocalEditRunId='r1';
 const output={id:'output',metadata:{videoLocalEditRunId:'r1',status:'loading'}};
 const apply=nodes=>commit(nodes,'bench','video',plan,result,'r1','output');
 const next=apply([source,workbench,output]);
 assert.equal(next[0],source);assert.equal(next[2].metadata.storageKey,'result:s1');assert.equal(next[2].metadata.videoLocalEdit,undefined);
 const changed=target();changed.metadata.storageKey='replacement';
 assert.equal(apply([changed,workbench,output])[2].metadata.status,'error');
 assert.equal(apply([source,workbench]).length,2);
 assert.equal(apply([source,output])[0],source);
});

test('restore checks current video before touching either it or its workbench',()=>{
 const snapshot=target();snapshot.metadata.videoLocalEdit.restoreOriginal={width:128,height:96,duration:8};
 const workbench=bench();workbench.metadata.videoLocalEditRunId='old-run';
 const restored=restore([snapshot,workbench],snapshot,{...result,storageKey:'original:s0'});
 assert.equal(restored[0].metadata.storageKey,'original:s0');
 assert.equal(restored[0].metadata.naturalWidth,128);
 assert.equal(restored[0].metadata.videoLocalEdit,undefined);
 assert.equal(restored[1].metadata.videoLocalEditRunId,undefined);
 const changed=target();changed.metadata.storageKey='replacement:s2';
 const current=[changed,workbench];assert.equal(restore(current,snapshot,result),current);
});

function fixture() {
 let nodes=[target(),bench()],running=null,sequence=0;
 const requests=new Map(),received=[],hydrations=[];
 const scope={setConnections(update){this.connectionsRef.current=update(this.connectionsRef.current)},nodesRef:{current:nodes},connectionsRef:{current:[]},setNodes(update){nodes=update(nodes);this.nodesRef.current=nodes},setRunningNodeId(update){running=typeof update==='function'?update(running):update},startGenerationRequest(id,originNodeId,runningNodeId,controller=new AbortController()){requests.set(id,{targetNodeId:id,originNodeId,runningNodeId,controller,projectId:'original-project'});return controller},finishGenerationRequest(id,controller){if(requests.get(id)?.controller===controller)requests.delete(id)}};
 const imports={CanvasNodeType:{Video:"video"},createCanvasNode:(type,position)=>({id:`output-${++sequence}`,type,position}),AbortController,DOMException,nanoid:()=>`run-${++sequence}`,listCanvasGenerationRequests:()=>[...requests.values()],buildNodeGenerationContext:()=>({prompt:'只将区域改为红色',referenceImages:[],referenceVideos:[{id:'video',url:'',storageKey:'input:24fps',durationMs:3000}],referenceAudios:[]}),hydrateNodeGenerationContext:context=>{const job=deferred();hydrations.push({context,...job});return job.promise.then(()=>context)},resolveVideoLocalEditConfig:config=>config,resolveMediaUrl:async key=>key==='input:24fps'?'prepared-url':'bad-url',requestVideoGeneration:async(...args)=>{received.push(args);return {url:'generated'}},composeVideoLocalEdit:async()=>result,applyVideoLocalEditResult:commit};
 const run=vm.runInNewContext(read('video-local-edit-generation')+';generateVideoLocalEdit',imports);
 return{scope,received,hydrations,requests,get nodes(){return nodes},get running(){return running},run:()=>run(scope,'original-project',bench(),{},'change'),stop(){for(const r of requests.values())r.controller.abort();requests.clear()}};
}
test('workbench sends the preprocessed video and writes only through its captured scope',async()=>{
 const f=fixture(),done=f.run();assert.equal(f.nodes.length,3);assert.equal(f.nodes[2].metadata.status,'loading');f.hydrations[0].resolve();await done;
 assert.equal(f.received[0][3][0].storageKey,'input:24fps');
 assert.equal(f.received[0][3][0].durationMs,3000);
 assert.equal(f.hydrations[0].context.referenceVideos.length,0);
 assert.equal(f.nodes[0].metadata.storageKey,'base:s0');
 assert.equal(f.nodes[2].metadata.storageKey,'result:s1');
 assert.equal(f.scope.connectionsRef.current[0].toNodeId,f.nodes[2].id);
 assert.equal(f.nodes[1].metadata.status,'success');assert.equal(f.requests.size,0);
});
test('cancelled old hydration cannot clear a newly started workbench run',async()=>{
 const f=fixture(); const old=f.run();f.stop();const newer=f.run();
 f.hydrations[0].resolve();await old;
 assert.equal(f.nodes[1].metadata.status,'loading');assert.equal(f.running,'bench');
 assert.notEqual(f.nodes[1].metadata.videoLocalEditRunId,'run-1');assert.equal(f.received.length,0);
 f.hydrations[1].resolve();await newer;assert.equal(f.received.length,1);assert.equal(f.nodes[1].metadata.status,'success');
});
test('concurrent generation targeting the same video is rejected before dispatch',async()=>{
 const f=fixture();const first=f.run();await assert.rejects(f.run(),/正在局部编辑/);
 assert.equal(f.hydrations.length,1);f.stop();f.hydrations[0].resolve();await first;
 assert.equal(f.nodes[0].metadata.storageKey,'base:s0');assert.equal(f.received.length,0);
});


test('a second run adds a separate placeholder without replacing the previous output',async()=>{
 const f=fixture();const first=f.run();f.hydrations[0].resolve();await first;
 const prior=f.nodes[2];const second=f.run();assert.equal(f.nodes.length,4);assert.equal(f.nodes[2],prior);
 assert.ok(f.nodes[3].position.y>=prior.position.y+prior.height);
 f.hydrations[1].resolve();await second;assert.equal(f.nodes[0].metadata.storageKey,'base:s0');assert.equal(f.nodes[2],prior);
});
