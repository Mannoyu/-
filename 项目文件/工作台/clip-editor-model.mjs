export const MIN_CLIP = 1 / 60;
const rounded = value => Math.round(value * 60000) / 60000;
export const clipEnd = clip => rounded(clip.start + clip.duration);
export const orderedClips = clips => [...clips].sort((a,b) => a.start-b.start);

export function legacyClips(draft, duration, makeId) {
  const clips=[0,...draft.cues.filter(time => time>0&&time<duration)].map((start,index,starts)=>{
    const slot=draft.backgrounds[index%draft.backgrounds.length];
    return {id:makeId(),assetId:slot.assetId,start,duration:(starts[index+1]??duration)-start,
      sourceIn:slot.start,sourceOut:slot.end,phase:start,focus:slot.focus,zoom:slot.zoom,
      cardX:draft.layout?.cardX??0,cardY:draft.layout?.cardY??0,cardScale:draft.layout?.cardScale??1};
  });
  return clips.map((clip,index)=>index?{...clip,transitionFrom:clips[index-1].id,transition:1.2}:clip);
}

export function validatePlacement(clips, candidate) {
  if(!Number.isFinite(candidate.start)||!Number.isFinite(candidate.duration)||candidate.start<0||candidate.duration<MIN_CLIP)throw new Error('片段至少保留一帧，开始时间不能为负数');
  if(clips.some(clip=>clip.id!==candidate.id&&candidate.start<clipEnd(clip)-.00001&&clipEnd(candidate)>clip.start+.00001))throw new Error('这个位置已有背景，请先移开或删除原片段');
  return candidate;
}

export function splitClip(clips, id, time, makeId) {
  const clip=clips.find(item=>item.id===id);
  if(!clip||time-clip.start<MIN_CLIP||clipEnd(clip)-time<MIN_CLIP)throw new Error('请把播放头移到所选片段内部再分割');
  const elapsed=rounded(time-clip.start);
  const rightId=makeId();
  return orderedClips(clips.flatMap(item=>item.id===id?[
    {...clip,duration:elapsed},
    {...clip,id:rightId,start:rounded(time),duration:rounded(clip.duration-elapsed),phase:rounded((clip.phase??0)+elapsed),transition:0,transitionFrom:undefined},
  ]:[item.transitionFrom===id?{...item,transitionFrom:rightId}:item]));
}

export function editClip(clips,id,patch) {
  const clip=clips.find(item=>item.id===id);
  if(!clip)throw new Error('请先选中一个背景片段');
  const candidate=validatePlacement(clips,{...clip,...patch});
  return orderedClips(clips.map(item=>item.id===id?candidate:item));
}

export function insertClip(clips,asset,start,duration,makeId,layout={}) {
  const clip=validatePlacement(clips,{id:makeId(),assetId:asset.id,start:rounded(start),duration:rounded(duration),sourceIn:0,sourceOut:asset.duration,
    phase:0,focus:.5,zoom:1,cardX:layout.cardX??0,cardY:layout.cardY??0,cardScale:layout.cardScale??1});
  return {clip,clips:orderedClips([...clips,clip])};
}

export function resolveClip(clips,time) {
  const clip=clips.find(item=>time>=item.start&&time<clipEnd(item));
  if(!clip)return null;
  const span=clip.sourceOut-clip.sourceIn;
  const sourceTime=span>0?clip.sourceIn+(((clip.phase??0)+time-clip.start)%span+span)%span:clip.sourceIn;
  return {clip,sourceTime};
}

// Both realtime preview and exported frames use this resolver, including legacy swaps.
export function resolveClipScene(clips,time) {
  const current=clips.findIndex(clip=>time>=clip.start&&time<clipEnd(clip));
  let from=current,to=current,raw=0;
  for(let i=1;i<clips.length;i++){
    const incoming=clips[i],previous=clips[i-1],length=Math.min(incoming.transition??0,previous.duration/.7,incoming.duration/.3);
    if(!length||incoming.transitionFrom!==previous.id||Math.abs(clipEnd(previous)-incoming.start)>.00002)continue;
    const start=incoming.start-length*.7;
    if(time>=start&&time<start+length){from=i-1;to=i;raw=(time-start)/length;break;}
  }
  if(from<0)return null;
  const smooth=value=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};
  const backgroundP=smooth((raw-.15)/.7);
  const order=[from,...Array.from({length:3},(_,i)=>(from+i+1)%clips.length)];
  return {from,to,active:backgroundP>=.5?to:from,turn:from,raw,p:smooth(raw),backgroundP,order};
}

export function clipSourceTime(clip,time){
  const span=clip.sourceOut-clip.sourceIn;
  return clip.sourceIn+(((clip.phase??0)+time-clip.start)%span+span)%span;
}

export function normalizeClips(input,findAsset){
  if(!Array.isArray(input)||input.length>600)throw new Error('背景片段必须是数组，最多 600 段');
  const ids=new Set();
  const finite=(value,min,max,label)=>{if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${label}超出范围`);return value;};
  const clips=input.map(item=>{
    if(typeof item.id!=='string'||!item.id||item.id.length>100||ids.has(item.id))throw new Error('片段 ID 缺失或重复');
    ids.add(item.id);const asset=findAsset(item.assetId);
    if(!asset||asset.kind==='audio')throw new Error('片段引用的背景素材不存在');
    const sourceIn=finite(item.sourceIn,0,asset.duration-MIN_CLIP,'素材入点');
    return {id:item.id,assetId:asset.id,start:finite(item.start,0,3600,'开始时间'),duration:finite(item.duration,MIN_CLIP,3600,'片段时长'),
      sourceIn,sourceOut:finite(item.sourceOut,sourceIn+MIN_CLIP,asset.duration,'素材出点'),phase:finite(item.phase??0,-7200,7200,'播放相位'),
      focus:finite(item.focus??.5,0,1,'取景'),zoom:finite(item.zoom??1,1,3,'缩放'),cardX:finite(item.cardX??0,-500,500,'卡片横移'),cardY:finite(item.cardY??0,-500,500,'卡片竖移'),cardScale:finite(item.cardScale??1,.5,1.5,'卡片大小'),
      transition:finite(item.transition??0,0,1.2,'转场时长'),transitionFrom:typeof item.transitionFrom==='string'?item.transitionFrom:undefined};
  });
  const sorted=orderedClips(clips);
  for(const clip of sorted){validatePlacement(sorted,clip);if(clipEnd(clip)>3600)throw new Error('时间线最长支持 60 分钟');}
  return sorted;
}
