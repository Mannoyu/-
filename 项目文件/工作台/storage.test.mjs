import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {maintainStorage,holdStorage,removeImportedFiles,removeManaged,beginImport,recoverImports} from './workbench-storage.mjs';
import {openWorkbench} from './workbench-store.mjs';

function fixture(t) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-storage-test-'));
  const root=path.join(base,'中文工作台');
  t.after(()=>{removeManaged(base,'中文工作台');fs.rmdirSync(base);});
  fs.mkdirSync(path.join(root,'workspace'),{recursive:true});
  const put=(relative,size=10)=>{
    const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.alloc(size));return file;
  };
  return {root,put};
}

test('capacity and TTL prune caches, preserve outputs and protect active exports',t=>{
  const {root,put}=fixture(t);
  const a=put(`.showreel-editor/video-cache/${'a'.repeat(64)}/picture.mp4`,60);
  const b=put(`.showreel-editor/video-cache/${'b'.repeat(64)}/picture.mp4`,60);
  const out=put('out/keep.mp4',100);
  const old=new Date(Date.now()-10*86400000);
  fs.utimesSync(path.dirname(a),old,old);
  const scene=put(`workspace/scenes/${'c'.repeat(64)}.json`);fs.utimesSync(scene,old,old);
  const release=holdStorage(root);
  assert.equal(maintainStorage(root,{clearCaches:true}).busy,true);
  assert.throws(()=>holdStorage(root),/正在导出/);
  release();
  const report=maintainStorage(root,{policy:{videoBytes:60,audioBytes:0,days:7,sceneDays:7}});
  assert.equal(report.freedBytes,70);assert.ok(!fs.existsSync(a));assert.ok(fs.existsSync(b));assert.ok(fs.existsSync(out));
  maintainStorage(root,{clearCaches:true});assert.ok(!fs.existsSync(b));
});

test('removal preserves files until permanent deletion; references and exports prevent deletion',t=>{
  const {root,put}=fixture(t);const store=openWorkbench(root,{},{});
  const id=randomUUID();const asset={id,name:'test',kind:'video',duration:3,fps:60,count:180};
  store.addAssets([asset]);
  const media=put(`workspace/media/${id}/preview.mp4`);const frame=put(`assets/frames/${id}/00000.jpg`);
  store.update({action:'asset-remove',assetId:id});assert.ok(fs.existsSync(media));
  store.update({action:'asset-restore',assetId:id});assert.equal(store.view().removedAssets.length,0);
  store.update({action:'asset-remove',assetId:id});
  const release=holdStorage(root);
  assert.throws(()=>store.update({action:'asset-delete',assetId:id}),/导出/);release();
  store.update({action:'asset-delete',assetId:id});assert.ok(!fs.existsSync(media));assert.ok(!fs.existsSync(frame));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'workspace/state.json'))).media.length,0);
  assert.throws(()=>removeImportedFiles(root,'../../out'),/无效/);
  const data=JSON.parse(fs.readFileSync(path.join(root,'workspace/state.json')));
  data.media=[{...asset,id}];data.drafts[0].backgrounds[0].assetId=id;
  fs.writeFileSync(path.join(root,'workspace/state.json'),JSON.stringify(data));
  assert.throws(()=>openWorkbench(root,{},{}).update({action:'asset-remove',assetId:id}),/草稿/);
});

test('failed state registration leaves memory unchanged and import receipt supports rollback',t=>{
  const {root,put}=fixture(t);const store=openWorkbench(root,{},{});
  const id=randomUUID();const receipt=beginImport(root);receipt.track(id);
  const file=put(`workspace/media/${id}/audio.wav`);
  const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('disk failure');};
  try {assert.throws(()=>store.addAssets([{id,kind:'audio'}]),/disk failure/);} finally {fs.renameSync=rename;}
  assert.ok(!store.view().assets.some(asset=>asset.id===id));
  receipt.rollback();assert.ok(!fs.existsSync(file));
});

test('abandoned import recovery keeps registered assets and removes only tracked unfinished assets',t=>{
  const {root,put}=fixture(t);const id=randomUUID();const kept=randomUUID();
  openWorkbench(root,{},{}).addAssets([{id:kept,kind:'audio'}]);
  const abandoned=put(`workspace/media/${id}/preview.mp4`);const registered=put(`workspace/media/${kept}/audio.wav`);
  fs.writeFileSync(path.join(root,'workspace/import-99999999.json'),JSON.stringify({pid:99999999,ids:[id,kept]}));
  recoverImports(root);assert.ok(!fs.existsSync(abandoned));assert.ok(fs.existsSync(registered));
});
