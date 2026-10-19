const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { api, keys } = require('./video-local-edit.test.cjs');

test('bundled browser WASM core executes local edit filters and keeps timing/audio',async()=>{
  // Execute the same WASM binary in Node, without opening or automating a browser.
  global.self={location:{href:'file:///canvas-video-test/'}};
  const createCore=require('../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js');
  const core=await createCore({wasmBinary:fs.readFileSync(path.join(__dirname,'../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm'))});
  const logs=[];
  core.setLogger(({message})=>{logs.push(message);if(logs.length>12)logs.shift();});
  const exec=args=>{core.exec(...args);const code=core.ret;core.reset();assert.equal(code,0,logs.join('\n'));};
  const probe=name=>{try{core.FS.unlink('probe.json')}catch{};core.ffprobe('-v','error','-count_frames','-show_streams','-show_format','-of','json',name,'-o','probe.json');assert.ok([0,-1].includes(core.ret),logs.join('\n'));core.reset();return api.readVideoEditProbe(JSON.parse(core.FS.readFile('probe.json',{encoding:'utf8'})));};
  exec(['-f','lavfi','-i','testsrc2=size=64x48:rate=30:duration=5.25','-f','lavfi','-i','sine=frequency=440:duration=5.25','-c:v','libx264','-crf','0','-c:a','aac','original.mp4']);
  const original=probe('original.mp4');
  const selection={start:1.3,end:3.8,keyframes:keys};
  const prepared=api.buildVideoEditPrepareArgs(selection,original);
  exec(prepared.args);
  assert.equal(probe('input.mp4').frames,72);
  exec(['-f','lavfi','-i','color=red:s=64x48:r=24','-frames:v','73','-c:v','libx264','-crf','0','generated.mp4']);
  const generated=probe('generated.mp4');
  exec(api.buildVideoEditComposeArgs({selection,range:prepared.range,original},generated));
  const result=probe('output.mp4');
  assert.equal(result.frames,original.frames);
  assert.ok(Math.abs(result.duration-original.duration)<=1/original.fps);
  assert.equal(result.hasAudio,true);
  // Fractional last second is padded for the model, but only pasted to the source endpoint.
  const tail={...selection,start:4.8,end:original.duration,keyframes:keys.map(k=>({...k,time:4+(k.time-1)*(original.duration-4)/3}))};
  const tailPrepared=api.buildVideoEditPrepareArgs(tail,original);
  exec(tailPrepared.args);
  assert.equal(probe('input.mp4').frames,72);
  exec(api.buildVideoEditComposeArgs({selection:tail,range:tailPrepared.range,original},generated));
  assert.equal(probe('output.mp4').frames,original.frames);
  // 1.3s at 24fps lies between source frames: the first edited frame is 32, with no valid AI frame skipped.
  exec(['-f','lavfi','-i','testsrc2=size=64x48:rate=24:duration=6','-c:v','libx264','-crf','0','original.mp4']);
  const source24=probe('original.mp4'), exact={...selection,end:4.3};
  const exactPrepared=api.buildVideoEditPrepareArgs(exact,source24);
  exec(exactPrepared.args);assert.equal(probe('input.mp4').frames,72);
  exec(['-f','lavfi','-i','color=red:s=64x48:r=24','-vf',"drawbox=color=blue:t=fill:enable='eq(n,0)',drawbox=color=lime:t=fill:enable='eq(n,1)'",'-frames:v','73','-c:v','libx264','-crf','0','generated.mp4']);
  exec(api.buildVideoEditComposeArgs({selection:exact,range:exactPrepared.range,original:source24},probe('generated.mp4')));
  assert.equal(probe('output.mp4').frames,source24.frames);
  exec(['-i','output.mp4','-vf',"select='eq(n,32)'",'-frames:v','1','-f','rawvideo','-pix_fmt','yuv420p','entry.yuv']);
  const entry=core.FS.readFile('entry.yuv'), rect=api.interpolateVideoEditRect(keys,32/24);
  assert.ok(Math.abs(entry[Math.floor((rect.y+rect.height/2)*48)*64+Math.floor((rect.x+rect.width/2)*64)]-145)<=2,'fractional entry keeps first valid lime frame');
});
