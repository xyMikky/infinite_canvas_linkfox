const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');

// Exercise the actual component hooks and media callbacks without a browser or JSX renderer.
const file=fs.readFileSync(path.join(__dirname,'../src/components/canvas/canvas-video-local-edit-dialog.tsx'),'utf8').replace(/\r\n/g,'\n');
const body=file.slice(0,file.indexOf('\n    return (\n        <><Modal'))+'\nreturn {chooseRatio,confirm,busy,src,meta,selection,frameReady,seeking,time,error,videoRef,setViewport,setRetry,close,seek,beginDrag,moveDrag,selectedFrame,changeRectValue:typeof changeRectValue === "function" ? changeRectValue : undefined};\n}';
const code=stripTypeScriptTypes(body).replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const loadHelpers=(name,exports)=>vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../src/lib/canvas/',name),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+';({'+exports+'})');
const videoHelpers=loadHelpers('video-local-edit.ts','expandVideoEditRange,normalizeVideoEditKeyframes,interpolateVideoEditRect');
const cropHelpers=loadHelpers('local-edit-selection.ts','resizeCrop,fitCropToRatio');

class Media extends EventTarget {
 constructor(ready=4){super();this.readyState=ready;this.duration=6;this.videoWidth=640;this.videoHeight=480;this._time=0;this.timeWrites=0;this.seeking=false;this.paused=true;this.loads=0;this.pauses=0;}
 get currentTime(){return this._time;}
 set currentTime(value){this.timeWrites++;this._time=value;}
 pause(){this.pauses++;this.paused=true;}
 load(){this.loads++;this.readyState=1;this.dispatchEvent(new Event('loadedmetadata'));this.readyState=4;this.dispatchEvent(new Event('loadeddata'));}
}

function fixture(video=new Media(),selection,extra={}) {
 let cursor=0,dirty=true,view,reads=0,closed=false;
 const slots=[],pending=[],timers=new Map();let timerId=0;
 const useState=initial=>{const i=cursor++;if(!slots[i])slots[i]={value:initial};return[slots[i].value,value=>{const next=typeof value==='function'?value(slots[i].value):value;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}];};
 const useRef=initial=>{const i=cursor++;if(!slots[i])slots[i]={current:initial};return slots[i];};
 const useEffect=(fn,deps)=>{const i=cursor++;const old=slots[i];if(!old||deps.some((dep,j)=>!Object.is(dep,old.deps[j])))pending.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});};
 const imports={...videoHelpers,...cropHelpers,useState,useRef,useEffect,AbortController,Event,console,canvasThemes:{dark:{node:{text:'text',placeholder:'muted'},toolbar:{border:'border'}}},useThemeStore:fn=>fn({theme:'dark'}),resolveMediaUrl:async()=>{reads++;return 'blob:shared-video';},ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),...extra};
 const Component=vm.runInNewContext(code+';CanvasVideoLocalEditDialog',imports);
 const viewport={clientWidth:800,clientHeight:500};
 const props={node:{id:'v1',metadata:{storageKey:'video:1',content:'blob:shared-video',videoLocalEdit:selection?{selection}:undefined}},open:true,onClose(){closed=true;},onConfirm:async()=>{}};
 async function flush(){for(let turn=0;turn<30;turn++){if(dirty){dirty=false;cursor=0;view=Component(props);if(view.src){view.videoRef.current=video;view.setViewport(viewport);}else view.videoRef.current=null;while(pending.length)pending.shift()();}await Promise.resolve();if(!dirty)break;}assert.equal(dirty,false,'hooks should settle');return view;}
 return {video,flush,get view(){return view},get reads(){return reads},get closed(){return closed},retry(){view.setRetry(n=>n+1);},expire(){for(const fn of [...timers.values()])fn();},dispose(){for(const slot of slots)slot?.cleanup?.();}};
}

test('already decoded cached video initializes without another metadata event',async()=>{
 const f=fixture();const view=await f.flush();assert.ok(view.meta,'metadata must be read from readyState');assert.equal(view.meta.duration,6);assert.equal(view.selection.keyframes.length,2);assert.equal(view.frameReady,true);assert.equal(f.video.loads,0);f.expire();assert.equal((await f.flush()).error,'');f.dispose();
});

test('cold player subscribes before explicitly starting its first-frame load',async()=>{
 const f=fixture(new Media(0));const view=await f.flush();assert.equal(f.video.loads,1);assert.equal(view.frameReady,true);assert.ok(view.meta);f.dispose();
});

test('metadata alone cannot enable editing before a decoded frame arrives',async()=>{
 const f=fixture(new Media(1));let view=await f.flush();assert.ok(view.meta);assert.equal(view.frameReady,false);f.video.readyState=4;f.video.dispatchEvent(new Event('loadeddata'));view=await f.flush();assert.equal(view.frameReady,true);f.dispose();
});

test('retry with the same cached URL reinitializes and closing removes late event handlers',async()=>{
 const f=fixture();await f.flush();f.retry();const view=await f.flush();assert.equal(f.reads,2);assert.ok(view.meta);assert.equal(view.frameReady,true);view.close();f.dispose();f.video.duration=99;f.video.dispatchEvent(new Event('loadedmetadata'));assert.equal((await f.flush()).meta.duration,6);assert.equal(f.closed,true);
});

function offsetVideo() {
 const video=new Media();video._time=.1;
 Object.defineProperty(video,'currentTime',{get(){return this._time;},set(value){this.timeWrites++;this._time=Math.max(.1,value);this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.readyState=4;this.dispatchEvent(new Event('seeked'));});}});
 return video;
}

test('the zero-second keyframe stays selected when the browser clamps to the first frame at 0.100',async()=>{
 const f=fixture(offsetVideo()),view=await f.flush();assert.equal(view.frameReady,true);assert.equal(view.seeking,false);assert.equal(view.time,0);assert.equal(view.selectedFrame,0);
 for(const event of ['loadeddata','canplay','timeupdate']) f.video.dispatchEvent(new Event(event));
 f.expire();const settled=await f.flush();assert.equal(settled.time,0);assert.equal(settled.src,'blob:shared-video');f.dispose();
});

test('opening at the current timestamp waits for data without starting a redundant seek',async()=>{
 const f=fixture(new Media(1));await f.flush();assert.equal(f.video.timeWrites,0);assert.equal(f.view.seeking,false);
 f.video.readyState=4;f.video.dispatchEvent(new Event('loadeddata'));assert.equal((await f.flush()).frameReady,true);f.dispose();
});

test('native frame alignment leaves the requested edit time intact and ignores a late seeking event',async()=>{
 const f=fixture();await f.flush();f.view.seek(2.017);f.video._time=2.033333;f.video.seeking=false;f.video.dispatchEvent(new Event('seeked'));
 let view=await f.flush();assert.equal(view.frameReady,true);assert.equal(view.time,2.017);
 f.video.dispatchEvent(new Event('seeking'));view=await f.flush();assert.equal(view.seeking,false);assert.equal(view.frameReady,true);f.dispose();
});

test('drawing on the first frame updates the zero-second rectangle without adding a 0.100 keyframe',async()=>{
 const f=fixture(offsetVideo());await f.flush();
 f.view.beginDrag({button:0,pointerId:1,clientX:10,clientY:20,preventDefault(){},stopPropagation(){},target:{closest(){return null;}},currentTarget:{getBoundingClientRect(){return {left:0,top:0,width:100,height:100};},setPointerCapture(){}}});
 const view=await f.flush();assert.equal(view.selection.keyframes.length,2);assert.equal(view.selection.keyframes[0].time,0);assert.equal(view.selection.keyframes[0].x,.1);assert.equal(view.selection.keyframes[0].y,.2);assert.equal(view.time,0);f.dispose();
});

test('playback advances the editing clock and seeking back to zero selects the first keyframe again',async()=>{
 const f=fixture(offsetVideo());await f.flush();f.video.paused=false;f.video._time=1.5;f.video.dispatchEvent(new Event('timeupdate'));
 assert.equal((await f.flush()).time,1.5);f.view.seek(0);assert.equal((await f.flush()).time,0);assert.equal(f.view.selectedFrame,0);f.dispose();
});

test('a seek timeout keeps the video and draft rectangles and another seek can recover',async()=>{
 const f=fixture();await f.flush();const draft=f.view.selection;f.video.seeking=true;f.video.readyState=1;f.view.seek(3);await f.flush();f.expire();
 let view=await f.flush();assert.equal(view.src,'blob:shared-video');assert.equal(view.selection,draft);assert.ok(view.meta);assert.equal(view.seeking,false);assert.match(view.error,/定位/);
 f.video.seeking=false;f.video.readyState=4;view.seek(2);f.video.dispatchEvent(new Event('seeked'));view=await f.flush();assert.equal(view.frameReady,true);assert.equal(view.error,'');f.dispose();
});

function pointer(x,y,handle) {
 return {button:0,pointerId:1,clientX:x*100,clientY:y*100,preventDefault(){},stopPropagation(){},target:{closest(selector){return handle&&selector==='[data-video-edit-handle]'?{dataset:{videoEditHandle:handle}}:null;}},currentTarget:{getBoundingClientRect(){return {left:0,top:0,width:100,height:100};},setPointerCapture(){}}};
}
function equalAspect(keys,ratio) {
 for(const key of keys){assert.ok(Math.abs(key.width/key.height-ratio)<1e-8,`ratio ${key.width/key.height} should stay ${ratio}`);assert.ok(key.x>=0&&key.y>=0&&key.x+key.width<=1.000001&&key.y+key.height<=1.000001);}
}

test('every corner scales with the same ratio as the earlier and later keyframes',async()=>{
 for(const [handle,x,y,px,py] of [['se',.75,.75,.95,.85],['ne',.75,.25,.95,.15],['nw',.25,.25,.05,.15],['sw',.25,.75,.05,.85]]){
  const f=fixture();await f.flush();f.view.seek(3);f.video.dispatchEvent(new Event('seeked'));await f.flush();
  f.view.beginDrag(pointer(x,y,handle));f.view.moveDrag(pointer(px,py));let view=await f.flush();equalAspect(view.selection.keyframes,1);
  assert.notEqual(view.selection.keyframes[1].width,.5);assert.equal(view.selection.keyframes[0].width,.5);assert.equal(view.selection.keyframes[2].width,.5);
  equalAspect([videoHelpers.interpolateVideoEditRect(view.selection.keyframes,1.5),videoHelpers.interpolateVideoEditRect(view.selection.keyframes,4.5)],1);f.dispose();
 }
});

test('drawing another keyframe and dragging beyond the image keep the shared ratio',async()=>{
 const f=fixture();await f.flush();f.view.seek(2);f.video.dispatchEvent(new Event('seeked'));await f.flush();
 f.view.beginDrag(pointer(.4,.5));f.view.moveDrag(pointer(.9,.7));let view=await f.flush();equalAspect(view.selection.keyframes,1);assert.equal(view.selection.keyframes.length,3);
 f.view.moveDrag(pointer(1.2,1.5));view=await f.flush();equalAspect(view.selection.keyframes,1);f.dispose();
});

test('opening mixed rectangles fits later frames to the first ratio without rewriting the stored selection',async()=>{
 const selection={start:0,end:6,keyframes:[{time:0,x:.2,y:.2,width:.4,height:.2},{time:3,x:.6,y:.6,width:.4,height:.4},{time:6,x:.3,y:.3,width:.2,height:.3}]};
 const before=JSON.stringify(selection),f=fixture(new Media(),selection),view=await f.flush();equalAspect(view.selection.keyframes,2);
 assert.ok(Math.abs(view.selection.keyframes[1].y+view.selection.keyframes[1].height/2-.8)<1e-8);assert.equal(JSON.stringify(selection),before);f.dispose();
});

test('later keyframe width and height entry resize together and remain inside the image at the limits',async()=>{
 const f=fixture();await f.flush();assert.equal(typeof f.view.changeRectValue,'function');
 f.view.seek(3);f.video.dispatchEvent(new Event('seeked'));await f.flush();
 f.view.changeRectValue('width',.4);let view=await f.flush();assert.ok(Math.abs(view.selection.keyframes[1].height-.4)<1e-8);
 view.changeRectValue('height',.3);view=await f.flush();assert.ok(Math.abs(view.selection.keyframes[1].width-.3)<1e-8);
 view.changeRectValue('width',2);view=await f.flush();equalAspect(view.selection.keyframes,1);
 view.changeRectValue('height',0);view=await f.flush();equalAspect(view.selection.keyframes,1);assert.ok(view.selection.keyframes[1].width>=.009999);f.dispose();
});

test('the first keyframe width and height are independent and later frames follow its new ratio',async()=>{
 const f=fixture();await f.flush();f.view.changeRectValue('width',.4);let view=await f.flush();
 assert.ok(Math.abs(view.selection.keyframes[0].height-.5)<1e-8);equalAspect(view.selection.keyframes,.8);
 view.changeRectValue('height',.25);view=await f.flush();assert.ok(Math.abs(view.selection.keyframes[0].width-.4)<1e-8);equalAspect(view.selection.keyframes,1.6);
 for(const key of view.selection.keyframes.slice(1)){assert.ok(Math.abs(key.x+key.width/2-.5)<1e-8);assert.ok(Math.abs(key.y+key.height/2-.5)<1e-8);}
 view.seek(3);f.video.dispatchEvent(new Event('seeked'));await f.flush();f.view.changeRectValue('width',.32);view=await f.flush();
 equalAspect(view.selection.keyframes,1.6);assert.ok(Math.abs(view.selection.keyframes[1].height-.2)<1e-8);assert.ok(Math.abs(view.selection.keyframes[0].width-.4)<1e-8);f.dispose();
});

test('all first-frame corners freely change the ratio and update every later frame',async()=>{
 for(const [handle,x,y,px,py] of [['se',.75,.75,.95,.85],['ne',.75,.25,.95,.15],['nw',.25,.25,.05,.15],['sw',.25,.75,.05,.85]]){
  const f=fixture();await f.flush();f.view.beginDrag(pointer(x,y,handle));f.view.moveDrag(pointer(px,py));const view=await f.flush();
  assert.ok(Math.abs(view.selection.keyframes[0].width-.7)<1e-8);assert.ok(Math.abs(view.selection.keyframes[0].height-.6)<1e-8);equalAspect(view.selection.keyframes,7/6);f.dispose();
 }
});

test('redrawing the first frame can change ratio repeatedly without cumulatively shrinking the other frames',async()=>{
 const f=fixture();await f.flush();f.view.beginDrag(pointer(.1,.1));await f.flush();
 f.view.moveDrag(pointer(1,.11));await f.flush();f.view.moveDrag(pointer(.7,.4));const view=await f.flush();
 equalAspect(view.selection.keyframes,2);assert.ok(Math.abs(view.selection.keyframes[0].width-.6)<1e-8);assert.ok(Math.abs(view.selection.keyframes[0].height-.3)<1e-8);
 for(const key of view.selection.keyframes.slice(1)){assert.ok(Math.abs(key.width*key.height-.25)<1e-8);assert.ok(Math.abs(key.x+key.width/2-.5)<1e-8);}
 equalAspect([videoHelpers.interpolateVideoEditRect(view.selection.keyframes,1.5)],2);f.dispose();
});


test('export renders the current selection and downloads without closing or changing its keyframes',async()=>{
 let received,download;
 const f=fixture(new Media(),undefined,{
  renderVideoLocalEdit:async(node,selection,signal,progress)=>{received=selection;progress('正在导出');return {inputBlob:'rendered-clip',prepared:{range:{start:0,end:6}}};},
  saveAs:(blob,name)=>{download={blob,name};},
 });
 const view=await f.flush();await view.confirm(true);const after=await f.flush();
 assert.equal(received.keyframes.length,2);assert.equal(download.blob,'rendered-clip');assert.match(download.name,/局部区域.*24fps\.mp4$/);
 assert.equal(f.closed,false);assert.equal(after.busy,false);assert.deepEqual(after.selection,view.selection);f.dispose();
});

test('closing during export prevents a late download',async()=>{
 let finish,downloads=0;
 const f=fixture(new Media(),undefined,{renderVideoLocalEdit:()=>new Promise(resolve=>{finish=resolve;}),saveAs:()=>downloads++});
 const view=await f.flush();const job=view.confirm(true);view.close();
 finish({inputBlob:'late',prepared:{range:{start:0,end:6}}});await job;
 assert.equal(downloads,0);f.dispose();
});


test('choosing 16:9 updates every keyframe using real video dimensions',async()=>{
 const f=fixture();let view=await f.flush();view.chooseRatio('16:9');view=await f.flush();
 for(const frame of view.selection.keyframes) assert.ok(Math.abs(frame.width*640/(frame.height*480)-16/9)<1e-8);
 f.dispose();
});
