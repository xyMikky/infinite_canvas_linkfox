// Actual video pixels, timing and original audio, with no browser or paid AI calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { api, keys } = require('./video-local-edit.test.cjs');
function run(dir,args) { return execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{cwd:dir,windowsHide:true,maxBuffer:16*1024*1024}); }
function probe(dir,name) { return api.readVideoEditProbe(JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',name],{cwd:dir,windowsHide:true,encoding:'utf8'}))); }
function cleanup(dir) {
  const absolute=path.resolve(dir), relative=path.relative(path.resolve(os.tmpdir()),absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(absolute).startsWith('canvas-video-edit-')) throw new Error('Unexpected fixture directory');
  fs.rmSync(absolute,{recursive:true,force:true});
}
const cases=['24','30','30000/1001'].flatMap(rate=>[{rate,start:1.3,end:3.8},{rate,start:1.3,end:4.3}]);
cases.push({rate:'30',start:1.301,end:4.301});
for (const {rate,start,end} of cases) test(`real ${rate}fps ${start}–${end}s: first valid frame, region, original pictures/audio`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-video-edit-'));
  try {
    run(dir,['-f','lavfi','-i',`testsrc2=size=64x48:rate=${rate}:duration=6`,'-f','lavfi','-i','sine=frequency=440:duration=6','-c:v','libx264','-crf','0','-c:a','aac','original.mp4']);
    const original=probe(dir,'original.mp4');
    const selection={start,end,keyframes:keys};
    const prepared=api.buildVideoEditPrepareArgs(selection,original);
    run(dir,prepared.args);
    const input=probe(dir,'input.mp4');
    assert.equal(input.frames,72); assert.equal(input.fps,24); assert.ok(Math.abs(input.duration-3)<.001);
    run(dir,['-f','lavfi','-i',`color=red:s=${rate==='24'?'128x96':'32x24'}:r=24`,'-vf',"drawbox=color=blue:t=fill:enable='eq(n,0)',drawbox=color=lime:t=fill:enable='eq(n,1)'",'-frames:v','73','-c:v','libx264','-crf','0','generated.mp4']);
    const generated=probe(dir,'generated.mp4');
    assert.equal(generated.frames,73);
    const plan={selection,range:prepared.range,original};
    run(dir,api.buildVideoEditComposeArgs(plan,generated));
    const result=probe(dir,'output.mp4');
    assert.equal(result.frames,original.frames);
    assert.equal(result.width,original.width);assert.equal(result.height,original.height);
    assert.ok(Math.abs(result.duration-original.duration)<=1/original.fps);
    const raw = name=>run(dir,['-i',name,'-map','0:v','-f','rawvideo','-pix_fmt','yuv420p','pipe:1']);
    const before=raw('original.mp4'), after=raw('output.mp4'), frameSize=64*48*1.5;
    for(let frame=0;frame<original.frames;frame++) {
      const time=frame/original.fps, offset=frame*frameSize;
      if(time<prepared.range.start || time>=prepared.range.end) assert.deepEqual(after.subarray(offset,offset+frameSize),before.subarray(offset,offset+frameSize),`untouched frame ${frame}`);
      else {
        assert.equal(after[offset],before[offset],`outside rectangle ${frame}`);
        const rect=api.interpolateVideoEditRect(keys,time), x=Math.floor((rect.x+rect.width/2)*64), y=Math.floor((rect.y+rect.height/2)*48);
        if(frame===Math.ceil(prepared.range.start*original.fps-1e-8)) assert.ok(Math.abs(after[offset+y*64+x]-145)<=2,`first valid frame ${frame} must be lime, got ${after[offset+y*64+x]}`);
        else if(time>=prepared.range.start+.1) assert.ok(Math.abs(after[offset+y*64+x]-81)<=2,`edited red at frame ${frame}, got ${after[offset+y*64+x]}`);
      }
    }
    const audio=name=>run(dir,['-i',name,'-map','0:a','-c','copy','-f','adts','pipe:1']);
    assert.deepEqual(audio('output.mp4'),audio('original.mp4'));
  } finally { cleanup(dir); }
});

test('portrait rotation survives preparation and compositing without rotating twice',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-video-edit-'));
 try {
  run(dir,['-f','lavfi','-i','testsrc2=size=64x48:rate=30:duration=4','-c:v','libx264','-crf','0','unrotated.mp4']);
  run(dir,['-display_rotation','90','-i','unrotated.mp4','-c','copy','original.mp4']);
  const original=probe(dir,'original.mp4');assert.equal(original.width,48);assert.equal(original.height,64);
  const selection={start:1.3,end:2.8,keyframes:keys.filter(k=>k.time<=4)};
  const prepared=api.buildVideoEditPrepareArgs(selection,original);run(dir,prepared.args);
  run(dir,['-f','lavfi','-i','color=red:s=64x48:r=24','-frames:v','73','-c:v','libx264','generated.mp4']);
  run(dir,api.buildVideoEditComposeArgs({selection,range:prepared.range,original},probe(dir,'generated.mp4')));
  const output=probe(dir,'output.mp4');assert.equal(output.width,48);assert.equal(output.height,64);assert.equal(output.frames,original.frames);
  const raw=name=>run(dir,['-i',name,'-frames:v','1','-f','rawvideo','-pix_fmt','yuv420p','pipe:1']);
  assert.deepEqual(raw('output.mp4'),raw('original.mp4'));
 } finally { cleanup(dir); }
});

test('a longer original audio tail survives full-range preparation and compositing',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-video-edit-'));
 try {
  run(dir,['-f','lavfi','-i','testsrc2=size=64x48:rate=30:duration=3','-f','lavfi','-i','sine=frequency=440:duration=3.25','-c:v','libx264','-crf','0','-c:a','aac','original.mp4']);
  const original=probe(dir,'original.mp4');assert.ok(Math.abs(original.duration-3.25)<.001);
  const selection={start:0,end:3.25,keyframes:[0,1.625,3.25].map(time=>({time,x:.25,y:.25,width:.5,height:.5}))};
  const prepared=api.buildVideoEditPrepareArgs(selection,original);run(dir,prepared.args);assert.equal(probe(dir,'input.mp4').frames,96);
  run(dir,['-f','lavfi','-i','color=red:s=64x48:r=24','-frames:v','97','-c:v','libx264','generated.mp4']);
  run(dir,api.buildVideoEditComposeArgs({selection,range:prepared.range,original},probe(dir,'generated.mp4')));
  const output=probe(dir,'output.mp4');assert.equal(output.frames,90);assert.ok(Math.abs(output.duration-3.25)<=1/30);
  const audio=name=>run(dir,['-i',name,'-map','0:a','-c','copy','-f','adts','pipe:1']);assert.deepEqual(audio('output.mp4'),audio('original.mp4'));
 } finally {cleanup(dir);}
});


test('paint layer is included in the exported 24fps reference video',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-video-edit-'));
 try {
  run(dir,['-f','lavfi','-i','color=blue:s=64x48:r=24:d=3','-c:v','libx264','original.mp4']);
  run(dir,['-f','lavfi','-i','color=red:s=64x48','-frames:v','1','paint.png']);
  const source=probe(dir,'original.mp4');
  const selection={start:0,end:3,keyframes:[{time:0,x:.25,y:.25,width:.5,height:.5}],paintLayer:'fixture'};
  run(dir,api.buildVideoEditPrepareArgs(selection,source).args);
  const output=probe(dir,'input.mp4');assert.equal(output.frames,72);assert.equal(output.fps,24);
  const raw=run(dir,['-i','input.mp4','-frames:v','1','-f','rawvideo','-pix_fmt','yuv420p','pipe:1']);
  assert.ok(Math.abs(raw[0]-81)<3,'painted reference must be red, not the blue source');
 } finally {cleanup(dir);}
});
