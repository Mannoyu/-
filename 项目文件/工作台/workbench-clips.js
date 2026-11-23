import {MIN_CLIP,clipEnd,editClip,insertClip,splitClip,orderedClips} from './clip-editor-model.mjs';

const get=id=>document.getElementById(id);
const round=value=>Math.round(value*60)/60;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function createClipEditor(host){
  let snap=true,dragging=false,waveKey=0,wave=[];
  const state=()=>host.state();
  const clips=()=>state().draft.clips;
  const selected=()=>clips()[host.index()];
  const run=fn=>Promise.resolve().then(fn).catch(error=>host.notify(error.message,true));
  const hint=text=>{get('timeline-hint').textContent=text;};
  const select=(id,seek=false)=>{
    host.select(clips().findIndex(clip=>clip.id===id));host.paintSlot();
    get('split-clip').disabled=get('delete-clip').disabled=!selected();
    host.panel('background-settings');
    if(seek&&selected())host.seek(Math.min(clipEnd(selected())-MIN_CLIP,selected().start+.15));
    for(const node of get('background-track').querySelectorAll('.video-clip'))node.setAttribute('aria-pressed',String(node.dataset.id===id));
  };
  const timeAt=event=>{
    const bounds=get('background-track').getBoundingClientRect();return clamp((event.clientX-bounds.left)/bounds.width*state().duration,0,state().duration);
  };
  function nearest(value,id){
    if(!snap)return round(value);
    const limit=8/get('background-track').clientWidth*state().duration;
    const points=[0,host.time(),state().duration,...clips().filter(c=>c.id!==id).flatMap(c=>[c.start,clipEnd(c)])];
    const target=points.reduce((best,p)=>Math.abs(p-value)<Math.abs(best-value)?p:best,value+limit+1);
    return Math.abs(target-value)<limit?target:round(value);
  }
  function patch(patch){
    const clip=selected();if(!clip)throw new Error('请先选择片段');
    const next=editClip(clips(),clip.id,patch);state().draft.clips=next;host.select(next.findIndex(c=>c.id===clip.id));
    return host.save();
  }
  function remove(){
    const clip=selected();if(!clip)return;
    state().draft.clips=clips().filter(c=>c.id!==clip.id);host.select(-1);host.seek(clip.start);
    hint('片段已删除并留下空位。点击空白区域，再从左侧添加背景。');return host.save();
  }
  function split(){
    const clip=selected();if(!clip)throw new Error('先选中要分割的背景片段');
    state().draft.clips=splitClip(clips(),clip.id,round(host.time()),()=>crypto.randomUUID());
    hint('已分割为独立片段，画面播放保持连续');return host.save();
  }
  function add(asset,start=host.time()){
    if(clips().some(c=>start>=c.start&&start<clipEnd(c)-.00001))throw new Error('此处已有片段，请先删除留空，或使用「替换」');
    const next=orderedClips(clips()).find(c=>c.start>=start);
    const length=Math.min(asset.duration,(next?.start??state().duration)-start);
    if(length<MIN_CLIP)throw new Error('此处没有足够的空白空间');
    const result=insertClip(clips(),asset,start,length,()=>crypto.randomUUID(),state().draft.layout);
    state().draft.clips=result.clips;host.select(result.clips.findIndex(c=>c.id===result.clip.id));
    hint('已添加背景，可拖动边缘调整长度');return host.save();
  }
  function drag(event,id){
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();host.pause();select(id);
    const node=event.currentTarget,side=event.target.dataset.side,anchor=event.clientX;
    const original=structuredClone(selected()),before=clips(),width=get('background-track').clientWidth;
    let candidate=original,changed=false,valid=true;dragging=true;node.setPointerCapture(event.pointerId);
    const move=e=>{
      if(Math.abs(e.clientX-anchor)<3&&!changed)return;changed=true;
      const delta=(e.clientX-anchor)/width*state().duration;
      const others=before.filter(c=>c.id!==id),previous=others.filter(c=>clipEnd(c)<=original.start+.00001).at(-1),next=others.find(c=>c.start>=clipEnd(original)-.00001);
      if(side==='left'){
        const start=clamp(nearest(original.start+delta,id),previous?clipEnd(previous):0,clipEnd(original)-MIN_CLIP);
        candidate={...original,start,duration:clipEnd(original)-start,phase:original.phase+start-original.start};
      }else if(side==='right')candidate={...original,duration:clamp(nearest(clipEnd(original)+delta,id),original.start+MIN_CLIP,next?.start??3600)-original.start};
      else candidate={...original,start:clamp(nearest(original.start+delta,id),0,3600-original.duration)};
      try{editClip(before,id,candidate);valid=true;}catch{valid=false;}
      node.classList.toggle('invalid',!valid);node.style.left=`${candidate.start/state().duration*100}%`;node.style.width=`${candidate.duration/state().duration*100}%`;
      hint(`${side?'修剪':'移动'} ${host.stamp(candidate.start)} — ${host.stamp(clipEnd(candidate))}${valid?'':' · 与其他片段重叠'}`);
    };
    const finish=e=>{
      node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',finish);node.removeEventListener('pointercancel',cancel);
      if(node.hasPointerCapture(e.pointerId))node.releasePointerCapture(e.pointerId);dragging=false;
      if(changed&&valid)run(()=>{state().draft.clips=editClip(before,id,candidate);host.select(clips().findIndex(c=>c.id===id));return host.save();});
      else {host.paintTimeline();if(!changed)host.seek(clamp(host.time(),original.start,clipEnd(original)-MIN_CLIP));}
    };
    const cancel=e=>{changed=false;finish(e);};
    node.addEventListener('pointermove',move);node.addEventListener('pointerup',finish);node.addEventListener('pointercancel',cancel);
  }
  function paintTrack(){
    const track=get('background-track'),duration=state().duration;
    const percent=value=>`${value/duration*100}%`;
    let end=0;
    const gap=(start,finish)=>{
      if(finish-start<MIN_CLIP)return;
      const button=document.createElement('button');button.className='clip-gap';button.style.left=percent(start);button.style.width=percent(finish-start);button.textContent='＋ 添加背景';
      button.addEventListener('click',()=>{host.select(-1);host.seek(start);host.paintSlot();host.panel('materials');hint('已定位空白，点击素材的「添加」');});track.append(button);
    };
    clips().forEach((clip,index)=>{
      gap(end,Math.min(clip.start,duration));end=clipEnd(clip);
      if(clip.start>=duration)return;
      const asset=state().assets.find(a=>a.id===clip.assetId),node=document.createElement('div');
      node.className='clip video-clip';node.tabIndex=0;node.setAttribute('role','button');node.dataset.id=clip.id;
      node.setAttribute('aria-label',`${asset?.name??'背景'}，${host.stamp(clip.start)}，时长 ${host.stamp(clip.duration)}`);node.setAttribute('aria-pressed',String(index===host.index()));
      node.style.left=percent(clip.start);node.style.width=percent(clip.duration);
      const strip=document.createElement('div');strip.className='filmstrip';
      const count=Math.max(1,Math.min(36,Math.ceil(clip.duration/duration*track.clientWidth/74)));
      for(let i=0;i<count;i++){
        const image=new Image();image.alt='';image.draggable=false;image.loading='lazy';
        const span=clip.sourceOut-clip.sourceIn,time=clip.sourceIn+((clip.phase+i/count*clip.duration)%span+span)%span;
        image.src=`/project/assets/frames/${encodeURIComponent(asset.frameDir??asset.id)}/${String(Math.min(asset.count-1,Math.floor(time*asset.fps))).padStart(5,'0')}.jpg`;
        strip.append(image);
      }
      const label=document.createElement('span');label.className='video-clip-label';label.textContent=`${asset?.name??'背景'} · ${host.stamp(clip.duration)}`;node.append(strip,label);
      for(const side of ['left','right']){const handle=document.createElement('span');handle.dataset.side=side;handle.className=`trim-handle ${side}`;node.append(handle);}
      node.addEventListener('pointerdown',event=>drag(event,clip.id));node.addEventListener('keydown',event=>{if(event.key==='Enter')select(clip.id,true);});track.append(node);
    });
    gap(end,duration);
    get('split-clip').disabled=get('delete-clip').disabled=!selected();
    const outside=clips().filter(c=>clipEnd(c)>duration+.001).length;
    get('timeline-summary').textContent=`${clips().length} 个片段 · ${host.stamp(duration)}${outside?` · ${outside} 段超出歌曲，已保留`:''}`;
  }
  async function loadWave(){
    const key=++waveKey;wave=[];
    const asset=state().assets.find(a=>a.id===state().draft.audioId);
    try{
      const response=await fetch(`/project/${asset?.features??'audio/features.json'}`);if(!response.ok)return;
      const data=await response.json();if(key!==waveKey)return;wave=data.energy??[];paintWave();
    }catch{}
  }
  function paintWave(){
    const track=get('audio-track'),clip=track.querySelector('.clip');if(!clip||!wave.length)return;
    clip.classList.add('wave-clip');let canvas=clip.querySelector('canvas');
    if(!canvas){const text=document.createElement('span');text.textContent=clip.textContent;canvas=document.createElement('canvas');canvas.setAttribute('aria-label','当前音乐能量波形');clip.replaceChildren(canvas,text);}
    canvas.width=Math.max(1,Math.ceil(track.clientWidth));canvas.height=36;const ctx=canvas.getContext('2d');
    ctx.fillStyle=getComputedStyle(track).getPropertyValue('--ui-wave').trim();
    const peak=Math.max(.001,...wave.filter((_,i)=>i%Math.max(1,Math.floor(wave.length/2000))===0));
    for(let x=0;x<canvas.width;x+=3){const a=Math.floor(x/canvas.width*wave.length),b=Math.max(a+1,Math.floor((x+3)/canvas.width*wave.length));let value=0;for(let i=a;i<Math.min(b,wave.length);i++)value=Math.max(value,wave[i]);const h=Math.min(36,value/peak*36);ctx.fillRect(x,(36-h)/2,1.5,h);}
  }
  function bind(){
    for(const [id,fn] of [['split-clip',split],['delete-clip',remove],['clip-delete-property',remove]])get(id).addEventListener('click',()=>run(fn));
    get('clip-snap').addEventListener('click',()=>{snap=!snap;get('clip-snap').setAttribute('aria-pressed',String(snap));});
    for(const [id,key] of Object.entries({'clip-start':'start','clip-duration':'duration','clip-card-x':'cardX','clip-card-y':'cardY','clip-card-scale':'cardScale'})){
      get(id).addEventListener('change',()=>run(async()=>{try{if(!get(id).value.trim())throw new Error('请输入数值');await patch({[key]:Number(get(id).value)});}finally{host.paintSlot();}}));
    }
    get('clip-transition').addEventListener('change',()=>run(()=>{const index=host.index();return patch({transition:Number(get('clip-transition').value),transitionFrom:clips()[index-1]?.id});}));
    get('background-track').addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});
    get('background-track').addEventListener('drop',event=>{event.preventDefault();const asset=state().assets.find(a=>a.id===event.dataTransfer.getData('text/plain'));if(asset&&asset.kind!=='audio')run(()=>add(asset,nearest(timeAt(event))));});
    document.addEventListener('keydown',event=>{
      if(!state()||event.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;
      if(event.key.toLowerCase()==='s'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();run(split);}
      else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();run(remove);}
    });
    const resize=get('timeline-resize');
    resize.addEventListener('pointerdown',event=>{
      resize.setPointerCapture(event.pointerId);host.pause();const bounds=get('timeline-resize').parentElement.getBoundingClientRect();
      const move=e=>{document.documentElement.style.setProperty('--timeline-height',`${clamp(bounds.bottom-e.clientY,230,Math.min(520,innerHeight-360))}px`);};
      const stop=()=>{resize.removeEventListener('pointermove',move);resize.removeEventListener('pointerup',stop);resize.removeEventListener('pointercancel',stop);};
      resize.addEventListener('pointermove',move);resize.addEventListener('pointerup',stop);resize.addEventListener('pointercancel',stop);
    });
    resize.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();document.documentElement.style.setProperty('--timeline-height',`${clamp(document.querySelector('.timeline').clientHeight+(event.key==='ArrowUp'?24:-24),230,520)}px`);}});
    new ResizeObserver(()=>{if(state()&&!dragging){host.paintTimeline();}}).observe(get('timeline-scroll'));
  }
  return {paintTrack,paintWave,loadWave,add,patch,selected,bind};
}
