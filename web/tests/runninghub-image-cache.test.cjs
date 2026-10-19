const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/services/api/runninghub-client.ts'),'utf8');
const slice=source.slice(source.indexOf('const runninghubImageUploadCache'),source.indexOf('export async function resolveRunninghubAudioUrls'));
function fixture(){
 const uploads=[];
 const api=vm.runInNewContext(stripTypeScriptTypes(slice).replace(/export /g,'')+';({resolveRunninghubImageUrls})',{
  normalizeRunninghubBase:x=>x,apiText:x=>x,isReusablePublicHttpUrl:()=>false,
  getImageBlob:async key=>key==='saved'?{size:4,type:'image/png',content:'saved'}:null,
  imageToDataUrl:async ref=>ref.dataUrl,
  dataUrlToBlob:async content=>({size:4,type:'image/png',content}),
  uploadRunninghubBinary:async(config,blob)=>{uploads.push(blob.content);return 'upload-'+uploads.length;},
 });return{uploads,resolve:refs=>api.resolveRunninghubImageUrls({baseUrl:'channel',apiKey:'fixture'},refs)};
}
test('reused rh-0 identifier and equal byte length must not reuse an earlier image',async()=>{
 const f=fixture();const a=await f.resolve([{id:'rh-0',dataUrl:'AAAA'}]);const b=await f.resolve([{id:'rh-0',dataUrl:'BBBB'}]);
 assert.notEqual(a[0],b[0]);assert.deepEqual(f.uploads,['AAAA','BBBB']);
});
test('a resolved immutable storage key can reuse its upload',async()=>{
 const f=fixture();await f.resolve([{id:'a',storageKey:'saved'}]);await f.resolve([{id:'b',storageKey:'saved'}]);assert.equal(f.uploads.length,1);
});
test('missing storage blob does not cache changing fallback under its old key',async()=>{
 const f=fixture();await f.resolve([{id:'rh-0',storageKey:'missing',dataUrl:'AAAA'}]);await f.resolve([{id:'rh-0',storageKey:'missing',dataUrl:'BBBB'}]);assert.deepEqual(f.uploads,['AAAA','BBBB']);
});
