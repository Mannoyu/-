import {SONG} from './runtime-song.js';
import {clipSourceTime,resolveClipScene} from './clip-editor-model.mjs';
// Offline rendering samples decoded source frames, never a browser video surface.
export const MEDIA=SONG.videos;
export function createVideoElements(){
  return MEDIA.map(meta=>{
    const video=document.createElement('video');
    Object.assign(video,{muted:true,playsInline:true,preload:'auto'});
    video.dataset.preview=meta.preview;video.style.display='none';
    document.body.append(video);return video;
  });
}
export function createMediaSampler(videos,preview,{workbench=false}={}){
  const independent=Array.isArray(SONG.clips);
  const timeFor=(meta,time,index)=>independent?clipSourceTime(SONG.clips[index],time):meta.trimStart==null?time:meta.trimStart+time%(meta.trimEnd-meta.trimStart);
  const cache=new Map();
  const loading=new Map();
  function load(index){
    if(loading.has(index))return loading.get(index);
    const video=videos[index];
    const pending=new Promise((resolve,reject)=>{
    const meta=MEDIA[index];
    let proxy=workbench&&(meta.playback||(meta.kind==='builtin'&&meta.preview.replace(/\.mp4$/,'-playback.mp4')));
    function fail(){
      if(proxy){video.src=proxy;proxy=false;}
      else reject(Error('背景视频加载失败'));
    }
    video.addEventListener('loadeddata',()=>{video.removeEventListener('error',fail);resolve();},{once:true});
    video.addEventListener('error',fail);
    video.src=meta.preview;
    });
    loading.set(index,pending);return pending;
  }
  const ready=preview&&!independent?Promise.all(videos.map((_,index)=>load(index))):Promise.resolve();
  async function imageAt(meta,t,index){
    const frame=Math.min(meta.count-1,Math.floor((timeFor(meta,t,index)%meta.duration)*meta.fps+1e-5));
    const url=`assets/frames/${meta.frameDir??meta.id}/${String(frame).padStart(5,'0')}.jpg`;
    if(!cache.has(url)){
      const image=new Image();image.src=url;
      cache.set(url,image.decode().then(()=>image));
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
    for(const video of videos)if(!video.paused)video.pause();
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

  return {
    ready,pause,
    prefetch(t){
      const scene=independent?resolveClipScene(SONG.clips,t):null;
      const indices=independent?[...new Set(scene?.order??[])]:MEDIA.map((_,index)=>index);
      if(!preview)for(const index of indices)imageAt(MEDIA[index],t,index).catch(()=>{});
    },
    async at(t,{realtime=false,resync=false,exact=false}={}){
      const scene=independent?resolveClipScene(SONG.clips,t):null;
      const indices=independent?[...new Set(scene?.order??[])]:MEDIA.map((_,index)=>index);
      const result=[];
      if(independent)for(const [index] of loading)if(!indices.includes(index)){
        const video=videos[index];video.pause();video.removeAttribute('src');video.load();loading.delete(index);
      }
      if(!preview||exact){
        pause();
        await Promise.all(indices.map(async index=>{result[index]=await imageAt(MEDIA[index],t,index);}));return result;
      }
      await ready;
      if(!realtime)pause();
      await Promise.all(indices.map(async index=>{
        await load(index);const video=videos[index],local=timeFor(MEDIA[index],t,index);
        result[index]=realtime?await follow(video,local,resync):await seek(video,localTime(video,local));
      }));return result;
    },
  };
}
