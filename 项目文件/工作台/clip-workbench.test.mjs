import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openWorkbench} from './workbench-store.mjs';
import {removeManaged} from './workbench-storage.mjs';
import {legacyClips,splitClip,resolveClipScene,clipSourceTime} from './clip-editor-model.mjs';

function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'clip-workbench-')),root=path.join(base,'中文工作台');fs.mkdirSync(root);
  t.after(()=>{removeManaged(base,root);fs.rmdirSync(base);});
  const store=openWorkbench(root,{},{});return {root,store};
}
const snapshot=(root,key)=>JSON.parse(fs.readFileSync(path.join(root,'workspace/scenes',`${key}.json`),'utf8'));

test('legacy swaps and split continuity survive independent clips; deleted gaps stay empty',()=>{
  let count=0;const clips=legacyClips({cues:[10,20],backgrounds:[{assetId:'a',start:1,end:8,focus:.5,zoom:1},{assetId:'b',start:0,end:6,focus:.5,zoom:1}]},30,()=>`c${count++}`);
  for(const time of [9.16,9.5,10,10.3]){
    const state=resolveClipScene(clips,time);assert.equal(state.from,0);assert.equal(state.to,1);
    assert.ok(Math.abs(state.raw-(time-9.16)/1.2)<1e-9);
  }
  const split=splitClip(clips,clips[0].id,5,()=>`c${count++}`);
  assert.equal(split[1].transition,0);assert.equal(split[2].transitionFrom,split[1].id);
  assert.equal(clipSourceTime(split[1],7),clipSourceTime(clips[0],7));
  const deleted=split.filter(c=>c.id!==split[1].id);assert.equal(resolveClipScene(deleted,9.7),null);
  assert.equal(resolveClipScene([],0),null);
});

test('save, reopen and export share clips; shorter audio preserves edits and lyrics',t=>{
  const {root,store}=fixture(t);let view=store.view();
  let sequence=0;view.draft.clips=legacyClips(view.draft,view.duration,()=>`c${sequence++}`);
  view.draft.lyrics=[{time:50,end:55,text:'保留歌词',translation:'',kind:'lyric'}];
  view=store.update({action:'save',draft:view.draft});
  assert.ok(fs.existsSync(path.join(root,'workspace/before-clip-editor.json')));
  assert.deepEqual(snapshot(root,view.key).clips,view.draft.clips);
  assert.deepEqual(openWorkbench(root,{},{}).view().draft.clips,view.draft.clips);
  const exportKey=store.exportDraft(view.draft.id).project.snapshot;assert.equal(exportKey,view.key);
  store.addAssets([{id:'short',kind:'audio',name:'短歌曲',duration:10,sourceDuration:10,audio:'short.wav',features:'short.json'}]);
  const before=structuredClone(view.draft.clips);view.draft.audioId='short';view=store.update({action:'save',draft:view.draft});
  assert.deepEqual(view.draft.clips,before);assert.equal(view.draft.lyrics[0].time,50);assert.equal(view.duration,10);
  assert.ok(!snapshot(root,view.key).lyrics.some(line=>line.time===50));
});

test('empty timeline persists and assets referenced by clips or templates cannot be removed',t=>{
  const {root,store}=fixture(t);store.addAssets([{id:'imported',kind:'video',name:'独立素材',duration:3,fps:60,count:180}]);
  let view=store.view();view.draft.clips=[{id:'one',assetId:'imported',start:0,duration:3,sourceIn:0,sourceOut:3,phase:0,focus:.5,zoom:1,cardX:0,cardY:0,cardScale:1}];
  view=store.update({action:'save',draft:view.draft});assert.throws(()=>store.update({action:'asset-remove',assetId:'imported'}),/草稿/);
  view=store.update({action:'template-save',name:'片段模板',includeBackgrounds:true});
  view.draft.clips=[];view=store.update({action:'save',draft:view.draft});
  assert.deepEqual(snapshot(root,view.key).clips,[]);assert.deepEqual(snapshot(root,view.key).videos,[]);
  assert.throws(()=>store.update({action:'asset-remove',assetId:'imported'}),/模板/);
  const template=view.templates.find(t=>t.name==='片段模板');
  view=store.update({action:'template-apply',templateId:template.id});assert.equal(view.draft.clips[0].assetId,'imported');
  const bad=structuredClone(view.draft);bad.clips.push({...bad.clips[0],id:'overlap'});
  assert.throws(()=>store.update({action:'save',draft:bad}),/已有背景/);
  assert.equal(store.view().draft.clips.length,1);
});
