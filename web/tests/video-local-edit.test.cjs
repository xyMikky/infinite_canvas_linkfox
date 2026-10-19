const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const filename = path.join(__dirname, '../src/lib/canvas/video-local-edit.ts');
const code = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8')).replace(/export /g, '');
const api = vm.runInNewContext(code + ';({expandVideoEditRange,interpolateVideoEditRect,validateGeneratedEdit,buildVideoEditPrepareArgs,buildVideoEditComposeArgs,readVideoEditProbe})');
const keys = [{time:1,x:.1,y:.1,width:.2,height:.3},{time:2,x:.3,y:.2,width:.4,height:.4},{time:4,x:.5,y:.4,width:.3,height:.2}];
test('integer expansion uses 1–4 for 1.3–3.8', () => {
  const r = api.expandVideoEditRange(1.3,3.8,8);
  assert.equal(r.start,1); assert.equal(r.end,4); assert.equal(r.frameCount,72);
});

test('whole-second durations keep fractional endpoints, including floating-point roundoff',()=>{
  for(const [start,end] of [[1.3,4.3],[1.301,4.301],[1.3,16.3],[.1,3.1]]) {
    const r=api.expandVideoEditRange(start,end,20);
    assert.equal(r.start,start);assert.equal(r.end,end);
    assert.equal(r.generationSeconds,Math.round(end-start));
    assert.equal(r.frameCount,Math.round(end-start)*24);
  }
  const short=api.expandVideoEditRange(1.3,2.3,6);
  assert.equal(short.start,1.3);assert.equal(short.end,2.3);assert.equal(short.generationSeconds,3);
  const tail=api.expandVideoEditRange(2.25,5.25,5.25);
  assert.equal(tail.start,2.25);assert.equal(tail.end,5.25);
});
test('fractional tail keeps original endpoint but pads generation only', () => {
  const r = api.expandVideoEditRange(4.8,5.25,5.25);
  assert.equal(r.end,5.25); assert.equal(r.duration,1.25); assert.equal(r.generationSeconds,3);
});
test('three different keyframes interpolate all rectangle coordinates', () => {
  const a=api.interpolateVideoEditRect(keys,1.5),b=api.interpolateVideoEditRect(keys,3);
  assert.ok(Math.abs(a.x-.2)<1e-8); assert.ok(Math.abs(b.x-.4)<1e-8);
  assert.ok(Math.abs(b.height-.3)<1e-8);
  assert.equal(api.interpolateVideoEditRect(keys,0).x,.1);
});
test('extra first frame is alignment only, exact length clips retain first frame', () => {
  assert.equal(api.validateGeneratedEdit({fps:24,frames:121},5),1);
  assert.equal(api.validateGeneratedEdit({fps:24,frames:120},5),0);
  assert.throws(()=>api.validateGeneratedEdit({fps:30,frames:151},5),/24/);
  assert.throws(()=>api.validateGeneratedEdit({fps:24,frames:118},5),/帧/);
});
test('invalid ranges and damaged media are rejected', () => {
  assert.throws(()=>api.expandVideoEditRange(4,1,5));
  assert.throws(()=>api.expandVideoEditRange(0,1,NaN));
  assert.throws(()=>api.readVideoEditProbe({streams:[]}));
});
test('rotated source uses displayed dimensions and unsafe colour or pixel geometry is rejected',()=>{
  const stream={codec_type:'video',width:1920,height:1080,avg_frame_rate:'30/1',nb_read_frames:180,nb_frames:180,duration:6,pix_fmt:'yuv420p',sample_aspect_ratio:'1:1',side_data_list:[{rotation:90}]};
  const source=api.readVideoEditProbe({streams:[stream]});
  assert.equal(source.width,1080);assert.equal(source.height,1920);
  const selection={start:1.3,end:3.8,keyframes:keys};
  const prepared=api.buildVideoEditPrepareArgs(selection,source);
  assert.ok(prepared.width>=720 && prepared.height>=720);
  for(const patch of [{pixelFormat:'yuv444p'},{pixelFormat:'yuv420p10le'},{colorTransfer:'smpte2084'},{sampleAspectRatio:'4:3'}]) assert.throws(()=>api.buildVideoEditPrepareArgs(selection,{...source,...patch}),/原片画质|方形像素/);
  assert.throws(()=>api.readVideoEditProbe({streams:[{...stream,side_data_list:[{rotation:45}]}]}),/旋转/);
});
module.exports = { api, keys };

test('the full media duration accepts a last keyframe after the video track ends',()=>{
 const original=api.readVideoEditProbe({streams:[{codec_type:'video',width:700,height:880,avg_frame_rate:'30/1',nb_frames:441,duration:'14.700000',start_time:'0.100000'},{codec_type:'audio',duration:'14.953651'}],format:{duration:'14.953651'}});
 assert.equal(original.duration,14.953651);
 const selection={start:0,end:14.953651,keyframes:[0,7.4768255,14.953651].map(time=>({time,x:.25,y:.25,width:.5,height:.5}))};
 const prepared=api.buildVideoEditPrepareArgs(selection,original);assert.equal(prepared.range.end,14.953651);assert.equal(prepared.range.frameCount,360);
});

test('a missing or unusable container duration falls back to the valid video duration',()=>{
 const stream={codec_type:'video',width:640,height:480,avg_frame_rate:'30/1',nb_frames:90,duration:'3'};
 for(const duration of [undefined,'N/A','0','-1'])assert.equal(api.readVideoEditProbe({streams:[stream],format:{duration}}).duration,3);
});

test('WASM MP4 duration includes the start offset but the editing timeline is elapsed time',()=>{
 const video={codec_type:'video',width:700,height:880,avg_frame_rate:'30/1',nb_frames:441,duration:'14.700000',start_time:'0.100000',sample_aspect_ratio:'4095:4096',pix_fmt:'yuv420p'};
 const original=api.readVideoEditProbe({streams:[video,{codec_type:'audio',start_time:'0.100000',duration:'14.953651'}],format:{start_time:'0.100000',duration:'15.054000'}});
 assert.ok(Math.abs(original.duration-14.953651)<1e-8);
 const selection={start:0,end:14.953651,keyframes:[0,7.4768255,14.953651].map(time=>({time,x:.25,y:.25,width:.5,height:.5}))};
 assert.equal(api.buildVideoEditPrepareArgs(selection,original).range.frameCount,360);
 const delayed=api.readVideoEditProbe({streams:[{...video,start_time:0,duration:3},{codec_type:'audio',start_time:.5,duration:3}],format:{start_time:0,duration:3.5}});
 assert.equal(delayed.duration,3.5);
});

test('subpixel SAR rounding is accepted but an actual display-width change stays rejected',()=>{
 const stream={codec_type:'video',width:700,height:880,avg_frame_rate:'30/1',nb_frames:90,duration:3,sample_aspect_ratio:'4095:4096'};
 const source=api.readVideoEditProbe({streams:[stream]});assert.equal(source.sampleAspectRatio,'1:1');
 const selection={start:0,end:3,keyframes:[{time:0,x:.25,y:.25,width:.5,height:.5}]};
 for(const sample_aspect_ratio of ['4:3','100:99'])assert.throws(()=>api.buildVideoEditPrepareArgs(selection,api.readVideoEditProbe({streams:[{...stream,sample_aspect_ratio}]})),/方形像素/);
});
