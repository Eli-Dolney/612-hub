import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// Bundle the real scanner with memory-only DB and image/tag adapters. No user files.
const result = await build({entryPoints:['src/lib/fs.ts'],bundle:true,write:false,format:'esm',plugins:[{
 name:'scanner-fixtures',setup(b){
  b.onResolve({filter:/^\.\/(db|tags|color)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='./db'?
   'export const getAll=async()=>[]; export const putOne=async()=>{}; export const putMany=async(k,v)=>{globalThis.rows[k]=(globalThis.rows[k]||[]).concat(v)}':a.path==='./tags'?
   'export const readTags=async()=>({})':
   'export const shrinkCover=async(blob)=>{if(await blob.text()==="corrupt")throw Error("bad image");return blob}'}));
 }}]});
const {scanDirectory}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function file(name,content='audio'){return {kind:'file',name,getFile:async()=>Object.assign(new Blob([content]),{name})}}
function dir(name,entries){return {kind:'directory',name,async *values(){yield* entries}}}

test('per-track sidecars resolve by exact relative stem, with folder fallback and missing-art support',async()=>{
 globalThis.rows={};
 await scanDirectory(dir('fixture',[
   file('one.wav'),file('one.cover.png','one-art'),file('two.wav'),file('two.cover.png','corrupt'),
   file('cover.jpg','folder-art'),dir('sub',[file('one.wav'),file('one.cover.png','nested-art'),file('missing.wav')])
 ]));
 const tracks=globalThis.rows.tracks,arts=globalThis.rows.arts;
 const art=async(path)=>{let t=tracks.find(t=>t.relativePath===path);return arts.find(a=>a.id===t.id)?.blob.text()};
 assert.equal(await art('one.wav'),'one-art');
 assert.equal(await art('two.wav'),'folder-art');
 assert.equal(await art('sub/one.wav'),'nested-art');
 assert.equal(tracks.find(t=>t.relativePath==='sub/missing.wav').hasArt,false);
 assert.equal(tracks.length,4);
});
