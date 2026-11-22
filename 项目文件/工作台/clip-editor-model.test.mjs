import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyClips,splitClip,editClip,insertClip,resolveClip} from './clip-editor-model.mjs';
let sequence=0;const id=()=>`clip-${++sequence}`;
const fixture=()=>legacyClips({cues:[10,20],backgrounds:[{assetId:'a',start:1,end:8,focus:.5,zoom:1},{assetId:'b',start:0,end:6,focus:.5,zoom:1}]},30,id);

test('legacy expansion preserves repeated independent clips and global source phase',()=>{
  const clips=fixture();assert.deepEqual(clips.map(c=>c.assetId),['a','b','a']);
  assert.equal(new Set(clips.map(c=>c.id)).size,3);
  assert.equal(resolveClip(clips,12).sourceTime,0);
  const edited=editClip(clips,clips[0].id,{focus:.2});assert.equal(edited[2].focus,.5);
});
test('split preserves frame time, and delete leaves a gap without moving later content',()=>{
  const clips=fixture();const before=resolveClip(clips,7).sourceTime;
  const split=splitClip(clips,clips[0].id,5,id);
  assert.equal(resolveClip(split,7).sourceTime,before);
  const deleted=split.filter(c=>c.id!==split[1].id);assert.equal(resolveClip(deleted,7),null);assert.equal(deleted[1].start,10);
});
test('insert fills a deleted gap, and move or trim cannot silently overwrite another clip',()=>{
  const clips=fixture().filter((_,i)=>i!==1);
  const next=insertClip(clips,{id:'new',duration:3},10,10,id);
  assert.equal(resolveClip(next.clips,15).clip.assetId,'new');
  assert.throws(()=>editClip(next.clips,next.clip.id,{start:9}),/已有背景/);
  assert.throws(()=>editClip(next.clips,next.clip.id,{duration:11}),/已有背景/);
  assert.throws(()=>editClip(next.clips,next.clip.id,{duration:0}),/一帧/);
});
