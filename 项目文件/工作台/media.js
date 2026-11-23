import {SONG} from './runtime-song.js';
import {clipSourceTime,resolveClipScene} from './clip-editor-model.mjs';
// Offline rendering samples decoded source frames, never a browser video surface.
export const MEDIA=SONG.videos;
function createVideo(meta){
  const video=document.createElement('video');
  Object.assign(video,{muted:true,playsInline:true,preload:'auto'});
  video.dataset.preview=meta.preview;
  video.style.display='none';
  document.body.append(video);
  return video;
}
export function createVideoElements(){
  return MEDIA.map(createVideo);
}
export function createMediaSampler(videos,preview,{workbench=false}={}){
  const independent=Array.isArray(SONG.clips);
  const timeFor=(meta,time,index)=>independent?clipSourceTime(SONG.clips[index],time):meta.trimStart==null?time:meta.trimStart+time%(meta.trimEnd-meta.trimStart);
  const cache=new Map();
  const loading=new Map();
  function release(index){
    const video=videos[index];
    const entry=loading.get(index);
    loading.delete(index);
    entry?.cancel();
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    delete videos[index];
  }
  function load(index){
    if(loading.has(index))return loading.get(index).ready;
    const meta=MEDIA[index];
    const video=videos[index]??=createVideo(meta);
    const proxy=workbench&&(meta.playback||(meta.kind==='builtin'&&meta.preview.replace(/\.mp4$/,'-playback.mp4')));
    let fallback=proxy&&proxy!==meta.preview?meta.preview:null;
    const entry={};
    entry.ready=new Promise((resolve,reject)=>{
      function cleanup(){
        video.removeEventListener('loadeddata',loaded);
        video.removeEventListener('error',failed);
        entry.cancel=()=>{};
      }
      function loaded(){cleanup();resolve(video);}
      function failed(){
        if(fallback){video.src=fallback;fallback=null;return;}
        cleanup();
        release(index);
        reject(Error('背景视频加载失败'));
      }
      entry.cancel=()=>{cleanup();reject(Error('背景已切换'));};
      video.addEventListener('loadeddata',loaded);
      video.addEventListener('error',failed);
      video.src=proxy||meta.preview;
    });
    loading.set(index,entry);
    return entry.ready;
  }
  const ready=preview&&!independent&&!workbench?Promise.all(MEDIA.map((_,index)=>load(index))):Promise.resolve();
  async function imageAt(meta,t,index){
    const frame=Math.min(meta.count-1,Math.floor((timeFor(meta,t,index)%meta.duration)*meta.fps+1e-5));
    const url=`assets/frames/${meta.frameDir??meta.id}/${String(frame).padStart(5,'0')}.jpg`;
    if(!cache.has(url)){
      const image=new Image();image.src=url;
      const decoded=image.decode().then(()=>image).catch(error=>{
        if(cache.get(url)===decoded)cache.delete(url);
        throw error;
      });
      cache.set(url,decoded);
      if(cache.size>(independent?16:3*MEDIA.length))cache.delete(cache.keys().next().value);
    }
    return cache.get(url);
  }
  const localTime=(video,t)=>Math.min(t%video.duration,video.duration-1/120);
  async function seek(video,local){
    if(Math.abs(video.currentTime-local)<.001&&!video.seeking)return video;
    await new Promise((resolve,reject)=>{
      const done=()=>{video.removeEventListener('error',fail);resolve();};
      const fail=()=>{video.removeEventListener('seeked',done);reject(Error('背景取帧失败'));};
      video.addEventListener('seeked',done,{once:true});video.addEventListener('error',fail,{once:true});
      video.currentTime=local;
    });
    return video;
  }
  function pause(){
    for(const index of loading.keys())if(!videos[index].paused)videos[index].pause();
  }

  async function follow(video,t,resync){
    const local=localTime(video,t);
    // Use the media decoder's sequential playback between timeline corrections.
    if(resync||video.paused||video.seeking||Math.abs(video.currentTime-local)>.12){
      await seek(video,local);
    }
    if(video.paused){
      video.loop=true;
      // A blocked autoplay falls back to exact seeking on subsequent renders.
      video.play().catch(()=>{});
    }
    return video;
  }

  function indicesAt(t){
    if(!independent)return MEDIA.map((_,index)=>index);
    const scene=resolveClipScene(SONG.clips,t);
    if(!scene)return [];
    const indices=[...new Set(scene.order)];
    if(scene.raw>0&&MEDIA.length>4&&SONG.elements?.cards?.cardLayout==='glass-filmstrip'){
      indices.push((scene.from+4)%MEDIA.length);
    }
    return indices;
  }

  return {
    ready,pause,
    prefetch(t){
      if(!preview)for(const index of indicesAt(t))imageAt(MEDIA[index],t,index).catch(()=>{});
    },
    async at(t,{realtime=false,resync=false,exact=false}={}){
      const indices=indicesAt(t);
      const result=[];
      if(independent)for(const index of loading.keys())if(!indices.includes(index))release(index);
      if(!preview||exact){
        pause();
        await Promise.all(indices.map(async index=>{result[index]=await imageAt(MEDIA[index],t,index);}));return result;
      }
      await ready;
      if(!realtime)pause();
      await Promise.all(indices.map(async index=>{
        const video=await load(index),local=timeFor(MEDIA[index],t,index);
        result[index]=realtime?await follow(video,local,resync):await seek(video,localTime(video,local));
      }));return result;
    },
  };
}
