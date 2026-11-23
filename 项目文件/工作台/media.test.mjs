import test from 'node:test';
import assert from 'node:assert/strict';

test('600 clips use only visible decoders, fall back on error and sample original frames when paused',async t=>{
  const clips=Array.from({length:600},(_,index)=>({id:`clip-${index}`,start:index*2,duration:1,sourceIn:0,sourceOut:1}));
  const videos=clips.map(({id})=>({id,duration:1,fps:60,count:60,preview:`${id}.mp4`,playback:`${id}-proxy.mp4`}));
  const live=new Set(),requests=[];
  let rejectImages=false,rejectVideos=false;
  const replace=(key,value)=>{
    const before=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>{if(before)Object.defineProperty(globalThis,key,before);else delete globalThis[key];});
  };
  class Video extends EventTarget {
    dataset={};style={};paused=true;currentTime=0;duration=1;
    set src(url){
      requests.push(url);
      const fail=rejectVideos||url==='clip-0-proxy.mp4';
      queueMicrotask(()=>this.dispatchEvent(new Event(fail?'error':'loadeddata')));
    }
    pause(){this.paused=true;}
    play(){this.paused=false;return Promise.resolve();}
    removeAttribute(){} load(){} remove(){live.delete(this);}
  }
  replace('location',{search:`?draft=${'a'.repeat(64)}`});
  replace('fetch',async()=>({ok:true,json:async()=>({videos,clips})}));
  replace('Image',class {async decode(){if(rejectImages)throw Error('frame missing');}});
  replace('document',{createElement:()=>new Video(),body:{append:video=>live.add(video)}});
  const {createMediaSampler}=await import('./media.js');
  const sampler=createMediaSampler([],true,{workbench:true});
  await sampler.ready;
  const exact=await sampler.at(0,{exact:true});
  assert.equal(live.size,0);
  assert.equal(exact[0].src,'assets/frames/clip-0/00000.jpg');
  await sampler.at(0,{realtime:true});
  assert.equal(live.size,4);
  assert.deepEqual(requests,['clip-0-proxy.mp4','clip-1-proxy.mp4','clip-2-proxy.mp4','clip-3-proxy.mp4','clip-0.mp4']);
  await sampler.at(2,{realtime:true});
  assert.equal(live.size,4);
  assert.equal(requests.length,6);
  await sampler.at(3);
  assert.equal(live.size,0);
  rejectVideos=true;
  await assert.rejects(sampler.at(4),/加载失败/);
  rejectVideos=false;
  await sampler.at(4);
  assert.equal(live.size,4);
  rejectImages=true;
  await assert.rejects(sampler.at(4.5,{exact:true}),/frame missing/);
  rejectImages=false;
  assert.equal((await sampler.at(4.5,{exact:true}))[2].src,'assets/frames/clip-2/00030.jpg');
});
