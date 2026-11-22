import {MIN_CLIP,clipEnd,legacyClips,orderedClips,splitClip,editClip,insertClip,resolveClip} from '/project/clip-editor-model.mjs';

const $=id=>document.getElementById(id);
const audio=$('audio');
const makeId=()=>crypto.randomUUID();
const projectUrl=value=>value?.startsWith('blob:')?value:`/project/${String(value).split('/').map(encodeURIComponent).join('/')}`;
const stamp=value=>`${String(Math.floor(Math.max(0,value)/60)).padStart(2,'0')}:${(Math.max(0,value)%60).toFixed(2).padStart(5,'0')}`;
const round=value=>Math.round(value*60)/60;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const button=(label,handler,className='')=>{
  const node=document.createElement('button');node.type='button';node.textContent=label;node.className=className;
  node.addEventListener('click',()=>run(handler));return node;
};
let state,assets=[],original,title='',artist='',duration=1,clips=[],lyrics=[],audioId='',time=0,selected,tab='video',replacing=false;
let past=[],future=[],playing=false,clockOrigin=0,lastDraw=-Infinity,frameRequest,zoom=1,snap=true,extent=1,dragging=false;
let wave=[],waveKey=0,currentImage='',lastFrame=-1,cardSelected=false;
const localUrls=new Set();

function hint(message,error=false){$('hint').textContent=message;$('hint').classList.toggle('error',error);}
function run(task){return Promise.resolve().then(task).catch(error=>hint(error.message,true));}
function capture(){return structuredClone({clips,audioId,duration,title,artist,selected});}
function commit(previous){past.push(previous);if(past.length>60)past.shift();future=[];refresh();}
function applySnapshot(value){({clips,audioId,duration,title,artist,selected}=structuredClone(value));setAudio();time=clamp(time,0,duration);refresh();}
function undo(){if(!past.length)return;future.push(capture());applySnapshot(past.pop());hint('已撤销');}
function redo(){if(!future.length)return;past.push(capture());applySnapshot(future.pop());hint('已重做');}
function assetFor(id){return assets.find(asset=>asset.id===id);}
function chosen(){return clips.find(clip=>clip.id===selected);}
function thumbnail(asset,sourceTime=1){
  if(asset?.thumb)return asset.thumb;
  if(!asset?.count)return '';
  const frame=clamp(Math.floor(sourceTime*asset.fps),0,asset.count-1);
  return projectUrl(`assets/frames/${asset.frameDir??asset.id}/${String(frame).padStart(5,'0')}.jpg`);
}
function select(id,{seek=false}={}){
  selected=id;const clip=chosen();
  if(seek&&clip)setTime(Math.min(clipEnd(clip)-MIN_CLIP,clip.start+Math.min(.5,clip.duration/2)));
  renderTimeline();renderInspector();$('delete').disabled=$('split').disabled=!clip;
}
function refresh(){
  extent=Math.max(30,duration,...clips.map(clipEnd));
  $('song-title').textContent=title;$('song-artist').textContent=artist;$('total').textContent=stamp(duration);
  $('clip-count').textContent=`${clips.length} 段`;$('undo').disabled=!past.length;$('redo').disabled=!future.length;
  $('delete').disabled=$('split').disabled=!chosen();
  renderAssets();renderTimeline();renderInspector();drawPreview(true);updateClock();
}

function renderAssets(){
  const term=$('search').value.trim().toLowerCase();
  const rows=assets.filter(asset=>(tab==='audio'?asset.kind==='audio':asset.kind!=='audio')&&asset.name.toLowerCase().includes(term));
  $('asset-count').textContent=`${rows.length} 项`;
  $('assets').replaceChildren(...rows.map(asset=>{
    const item=document.createElement('article');item.className=`asset-item${asset.kind==='audio'?' audio-item':''}`;
    const copy=document.createElement('div');const name=document.createElement('strong');name.className='asset-name';name.textContent=asset.name;name.title=asset.name;
    const spec=document.createElement('div');spec.className='asset-type';spec.textContent=asset.kind==='audio'?stamp(asset.duration):`${asset.fps?`${Math.round(asset.fps)} fps · `:''}${asset.local?'本页素材':'已入库'}`;
    copy.append(name,spec);
    if(asset.kind==='audio'){
      const symbol=document.createElement('span');symbol.className='audio-symbol';symbol.textContent='♪';symbol.setAttribute('aria-hidden','true');
      item.append(symbol,copy,button(asset.id===audioId?'使用中':'设为音乐',()=>switchAudio(asset.id)));
    }else{
      const image=document.createElement('div');image.className='asset-image';image.draggable=true;
      const img=new Image();img.src=thumbnail(asset);img.alt=asset.name;img.loading='lazy';
      const add=button(replacing?'↔':'＋',()=>addAsset(asset));add.className='add-button';add.setAttribute('aria-label',`${replacing?'替换为':'添加背景'}：${asset.name}`);
      const length=document.createElement('span');length.className='asset-time';length.textContent=stamp(asset.duration);
      image.append(img,add,length);image.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',asset.id);event.dataTransfer.effectAllowed='copy';});
      image.addEventListener('dblclick',()=>run(()=>addAsset(asset)));item.append(image,copy);
    }
    return item;
  }));
  if(!rows.length){const empty=document.createElement('p');empty.className='field-note';empty.textContent='没有匹配的素材';$('assets').append(empty);}
  document.querySelectorAll('[data-tab]').forEach(node=>node.setAttribute('aria-selected',node.dataset.tab===tab));
}
function activateTab(next){tab=next;renderAssets();}

function addAsset(asset,start=time){
  const before=capture();
  if(replacing&&chosen()){
    clips=editClip(clips,selected,{assetId:asset.id,sourceIn:0,sourceOut:asset.duration,phase:0});
    replacing=false;document.body.classList.remove('replacing');hint('已替换所选片段，时间线位置和时长保持不变');
  }else{
    if(clips.some(c=>start>=c.start&&start<clipEnd(c)-.00001))throw new Error('播放头处已有背景。先删除留出空位，或选中片段后点「从素材库替换」');
    const next=orderedClips(clips).find(c=>c.start>=start);
    const available=Math.min(next?.start??Infinity,Math.max(duration,start+asset.duration))-start;
    if(available<MIN_CLIP)throw new Error('此处没有足够的空白空间');
    const inserted=insertClip(clips,asset,start,Math.min(asset.duration,available),makeId,state.draft.layout);
    clips=inserted.clips;selected=inserted.clip.id;hint('已添加独立背景片段，可拖动两侧边缘调整时长');
  }
  commit(before);
}
function deleteSelected(){
  if(!chosen())return;
  const before=capture();const removed=chosen();clips=clips.filter(clip=>clip.id!==selected);selected=undefined;
  setTime(removed.start);commit(before);hint('已删除片段并保留空位，音乐和字幕没有移动；可撤销或添加背景');
}
function splitSelected(){
  const before=capture();clips=splitClip(clips,selected,round(time),makeId);commit(before);hint(`已在 ${stamp(time)} 分割，两个片段可独立编辑`);
}

function renderInspector(){
  const clip=chosen();$('inspector-content').hidden=!clip;$('inspector-empty').hidden=Boolean(clip);
  $('selection-tag').textContent=clip?`V1 · ${orderedClips(clips).findIndex(c=>c.id===clip.id)+1}`:'未选择';
  if(!clip)return;
  const asset=assetFor(clip.assetId);$('selection-image').src=thumbnail(asset);$('selection-name').textContent=asset?.name??'背景';
  $('selection-spec').textContent=`${stamp(clip.duration)} · ${asset?.fps?`${Math.round(asset.fps)} fps`:'本页导入'}`;
  for(const [id,key] of Object.entries({'clip-start':'start','clip-duration':'duration','source-in':'sourceIn','source-out':'sourceOut','focus':'focus','zoom':'zoom','card-x':'cardX','card-y':'cardY','card-scale':'cardScale'})){
    if(document.activeElement!==$(id))$(id).value=Number(clip[key].toFixed(3));
  }
  $('clip-end').textContent=stamp(clipEnd(clip));
  $('source-in').max=asset?.duration??3600;$('source-out').max=asset?.duration??3600;
}
function inspectorTab(key){
  document.querySelectorAll('[data-inspector]').forEach(node=>node.setAttribute('aria-selected',node.dataset.inspector===key));
  $('timing-panel').hidden=key!=='timing';$('picture-panel').hidden=key!=='picture';
}
function propertyChange(id,key){
  $(id).addEventListener('change',()=>run(()=>{
    if(!chosen())return;
    const value=Number($(id).value);const clip=chosen();const asset=assetFor(clip.assetId);
    if(!Number.isFinite(value))throw new Error('请输入有效数字');
    const limits={focus:[0,1],zoom:[1,3],cardX:[-500,500],cardY:[-500,500],cardScale:[.5,1.5],sourceIn:[0,clip.sourceOut-MIN_CLIP],sourceOut:[clip.sourceIn+MIN_CLIP,asset.duration]};
    if(limits[key]&&(value<limits[key][0]||value>limits[key][1])){$(id).value=clip[key];throw new Error(`数值范围为 ${limits[key][0].toFixed(2)} 至 ${limits[key][1].toFixed(2)}`);}
    const before=capture();
    try {clips=editClip(clips,selected,{[key]:key==='start'||key==='duration'?round(value):value});commit(before);hint('已更新所选片段 · 仅在本页试编');}
    catch(error){$(id).value=clip[key];throw error;}
  }));
}

function renderTimeline(){
  const width=Math.max(1,$('timeline-scroll').clientWidth*zoom);$('tracks').style.width=`${width}px`;
  const px=value=>value/extent*width;
  const tickStep=[1,2,5,10,15,30,60,120,300,600].find(step=>px(step)>74)??600;
  $('ruler').replaceChildren();
  for(let value=0;value<=extent;value+=tickStep/5){
    const node=document.createElement('span');const major=Math.abs(value/tickStep-Math.round(value/tickStep))<.001;
    node.className=major?'tick':'tick minor';node.style.left=`${px(value)}px`;if(major)node.textContent=stamp(value).slice(0,5);$('ruler').append(node);
  }
  const video=$('video-track');video.replaceChildren();
  let end=0;
  const addGap=(start,finish)=>{
    if(finish-start<.05)return;const gap=document.createElement('button');gap.className='gap';gap.style.left=`${px(start)}px`;gap.style.width=`${px(finish-start)}px`;
    gap.textContent=px(finish-start)>85?'＋ 添加背景':'＋';gap.title=`空白 ${stamp(start)} — ${stamp(finish)}`;
    gap.addEventListener('click',()=>{selected=undefined;setTime(start);activateTab('video');renderInspector();hint('已定位空白区域，点击左侧背景上的「＋」添加');});video.append(gap);
  };
  for(const clip of orderedClips(clips)){
    addGap(end,clip.start);end=clipEnd(clip);
    const asset=assetFor(clip.assetId);const node=document.createElement('div');node.className=`video-clip${selected===clip.id?' selected':''}`;
    node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label',`${asset?.name??'背景'}，开始 ${stamp(clip.start)}，时长 ${stamp(clip.duration)}`);node.setAttribute('aria-pressed',String(selected===clip.id));node.dataset.clip=clip.id;
    node.style.left=`${px(clip.start)}px`;node.style.width=`${px(clip.duration)}px`;
    const strip=document.createElement('div');strip.className='filmstrip';
    const count=Math.max(1,Math.min(40,Math.ceil(px(clip.duration)/67)));
    for(let i=0;i<count;i++){const img=new Image();img.alt='';img.draggable=false;img.loading='lazy';img.src=thumbnail(asset,clip.sourceIn+((clip.phase??0)+i*Math.min(clip.duration,3)/count)%(clip.sourceOut-clip.sourceIn));strip.append(img);}
    const label=document.createElement('div');label.className='clip-label';const name=document.createElement('strong');name.textContent=asset?.name??'背景';const length=document.createElement('span');length.textContent=stamp(clip.duration);label.append(name,length);
    node.append(strip,label);
    for(const side of ['left','right']){const handle=document.createElement('span');handle.className=`trim-handle ${side}`;handle.dataset.side=side;handle.setAttribute('aria-hidden','true');node.append(handle);}
    node.addEventListener('pointerdown',event=>startDrag(event,clip.id));node.addEventListener('keydown',event=>{if(event.key==='Enter'){select(clip.id,{seek:true});}});
    video.append(node);
  }
  addGap(end,extent);
  const audioWidth=px(duration);$('audio-clip').style.width=`${audioWidth}px`;$('audio-name').textContent=assetFor(audioId)?.name??title;
  $('audio-end').style.left=`${audioWidth}px`;
  $('lyric-track').replaceChildren(...lyrics.filter(line=>line.text&&line.end>line.time).map(line=>{
    const node=document.createElement('div');node.className='lyric-clip';node.textContent=line.text;node.style.left=`${px(line.time)}px`;node.style.width=`${px(line.end-line.time)}px`;node.title=line.text;return node;
  }));
  if(!lyrics.length){const node=document.createElement('span');node.className='empty-lyrics';node.textContent='当前草稿没有字幕 · 正式版可导入 LRC 或逐句添加';$('lyric-track').append(node);}
  paintWave();updateClock();
}

function nearest(value,ignore){
  if(!snap)return round(value);
  const threshold=8/($('tracks').clientWidth/extent);
  const points=[0,time,duration,...clips.filter(c=>c.id!==ignore).flatMap(c=>[c.start,clipEnd(c)])];
  const close=points.reduce((best,point)=>Math.abs(point-value)<Math.abs(best-value)?point:best,value+threshold+1);
  return Math.abs(close-value)<threshold?close:round(value);
}
function timelineTime(event){const rect=$('tracks').getBoundingClientRect();return clamp((event.clientX-rect.left)/rect.width*extent,0,extent);}
function startDrag(event,id){
  if(event.button!==0)return;
  event.preventDefault();event.stopPropagation();
  pause();selected=id;const node=event.currentTarget;const side=event.target.dataset.side;
  document.querySelectorAll('.video-clip').forEach(element=>{const active=element.dataset.clip===id;element.classList.toggle('selected',active);element.setAttribute('aria-pressed',active);});
  renderInspector();$('delete').disabled=$('split').disabled=false;
  const before=capture(),initial=structuredClone(chosen()),anchor=event.clientX,width=$('tracks').clientWidth;
  let candidate=initial,changed=false,valid=true;
  dragging=true;node.setPointerCapture(event.pointerId);
  const move=event=>{
    const delta=(event.clientX-anchor)/width*extent;
    if(Math.abs(event.clientX-anchor)<3&&!changed)return;
    changed=true;
    const others=orderedClips(before.clips.filter(c=>c.id!==id));
    const previous=others.filter(c=>clipEnd(c)<=initial.start+.0001).at(-1);
    const next=others.find(c=>c.start>=clipEnd(initial)-.0001);
    if(side==='left'){
      const start=clamp(nearest(initial.start+delta,id),clipEnd(previous??{start:0,duration:0}),clipEnd(initial)-MIN_CLIP);
      candidate={...initial,start,duration:clipEnd(initial)-start,phase:(initial.phase??0)+start-initial.start};
    }else if(side==='right')candidate={...initial,duration:clamp(nearest(clipEnd(initial)+delta,id),initial.start+MIN_CLIP,next?.start??3600)-initial.start};
    else candidate={...initial,start:Math.max(0,nearest(initial.start+delta,id))};
    try{editClip(before.clips,id,candidate);valid=true;}catch{valid=false;}node.classList.toggle('invalid',!valid);
    node.style.left=`${candidate.start/extent*width}px`;node.style.width=`${candidate.duration/extent*width}px`;
    hint(`${side?'修剪':'移动'}至 ${stamp(candidate.start)} — ${stamp(clipEnd(candidate))}${valid?'':' · 此位置与其他片段冲突'}`,!valid);
  };
  const finish=event=>{
    node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',finish);node.removeEventListener('pointercancel',cancel);
    if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);dragging=false;
    if(changed&&valid){clips=editClip(before.clips,id,candidate);commit(before);hint('已更新片段，可按 Ctrl+Z 撤销');}
    else{renderTimeline();renderInspector();if(!changed)setTime(clamp(time,initial.start,clipEnd(initial)-MIN_CLIP));}
  };
  const cancel=event=>{changed=false;finish(event);hint('已取消拖动');};
  node.addEventListener('pointermove',move);node.addEventListener('pointerup',finish);node.addEventListener('pointercancel',cancel);
}

function setTime(value){time=clamp(value,0,Math.max(0,duration-MIN_CLIP));if(audio.src&&audio.readyState)audio.currentTime=time;clockOrigin=performance.now()-time*1000;updateClock();drawPreview(true);}
function updateClock(){
  $('clock').textContent=stamp(time);$('playhead').style.left=`${time/extent*$('tracks').clientWidth}px`;
  $('footer-time').textContent=`${stamp(time)} / ${stamp(duration)} · ${clips.length} 个背景片段`;
}
function drawPreview(force=false){
  const resolved=resolveClip(clips,time);$('empty-preview').hidden=Boolean(resolved);
  if(!resolved)return;
  const {clip,sourceTime}=resolved;const asset=assetFor(clip.assetId);
  const frame=Math.floor(sourceTime*(asset?.fps??30));
  if(force||clip.id!==currentImage||frame!==lastFrame){
    const src=thumbnail(asset,sourceTime);
    if($('background').getAttribute('src')!==src){$('background').src=src;$('card-image').src=src;}
    currentImage=clip.id;lastFrame=frame;
  }
  $('background').style.objectPosition=`${clip.focus*100}% center`;$('background').style.transform=`scale(${clip.zoom})`;
  $('card-stack').style.transform=`translate(${clip.cardX/1920*$('viewer').clientWidth}px,${clip.cardY/1080*$('viewer').clientHeight}px) scale(${clip.cardScale})`;
  $('card-title').textContent=asset?.name??'';
  $('subtitle').textContent=lyrics.find(line=>time>=line.time&&time<line.end)?.text??'';
}
function pause(){playing=false;audio.pause();cancelAnimationFrame(frameRequest);$('play').textContent='▶';$('play').setAttribute('aria-label','播放');}
async function togglePlay(){
  if(playing){pause();return;}
  if(!audio.src)throw new Error('请先选择一首音乐');
  if(audio.readyState)audio.currentTime=time;
  await audio.play();playing=true;clockOrigin=performance.now()-time*1000;$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','暂停');
  const tick=now=>{
    if(!playing)return;
    time=Math.min(duration,audio.readyState?audio.currentTime:(now-clockOrigin)/1000);
    if(time>=duration-MIN_CLIP){pause();setTime(0);return;}
    updateClock();if(now-lastDraw>100){drawPreview();lastDraw=now;}frameRequest=requestAnimationFrame(tick);
  };frameRequest=requestAnimationFrame(tick);
}
audio.addEventListener('ended',()=>{pause();setTime(0);});
function setAudio(){
  pause();const asset=assetFor(audioId);audio.src=projectUrl(asset?.audio??original.audio);audio.load();
  loadWave(asset);
}
function switchAudio(id){
  if(id===audioId){$('music-dialog').close();return;}
  const asset=assetFor(id);if(!asset)throw new Error('找不到音频');
  const before=capture();audioId=id;duration=asset.duration;title=asset.songTitle??asset.name;artist=asset.artist??'';time=0;setAudio();commit(before);
  $('music-dialog').close();hint('已更换音乐，背景与字幕编排均保留 · 超出歌曲范围的部分不播放');
}
function musicDialog(){
  $('music-list').replaceChildren(...assets.filter(a=>a.kind==='audio').map(asset=>{
    const node=button('',()=>switchAudio(asset.id),'music-option');
    const symbol=document.createElement('span');symbol.className='audio-symbol';symbol.textContent='♪';
    const copy=document.createElement('span');copy.className='music-copy';const name=document.createElement('strong');name.textContent=asset.name;const length=document.createElement('small');length.textContent=stamp(asset.duration);copy.append(name,length);node.append(symbol,copy);
    if(asset.id===audioId){node.classList.add('active');const active=document.createElement('span');active.className='active-label';active.textContent='正在使用';node.append(active);}
    return node;
  }));$('music-dialog').showModal();
}
async function loadWave(asset){
  const key=++waveKey;wave=[];paintWave();
  if(asset?.energy){wave=asset.energy;paintWave();return;}
  if(!asset?.features)return;
  try{const response=await fetch(projectUrl(asset.features));if(!response.ok)return;const data=await response.json();if(key!==waveKey)return;wave=Array.isArray(data.energy)?data.energy:[];paintWave();}catch{}
}
function paintWave(){
  const canvas=$('waveform');const width=Math.max(1,$('audio-clip').clientWidth),height=36;canvas.width=Math.ceil(width);canvas.height=height;
  const context=canvas.getContext('2d');context.clearRect(0,0,width,height);if(!wave.length)return;
  context.fillStyle=getComputedStyle(canvas).getPropertyValue('--ui-wave').trim();const peak=Math.max(.001,...wave.filter((_,i)=>i%Math.max(1,Math.floor(wave.length/3000))===0));
  for(let x=0;x<width;x+=3){let value=0;const first=Math.floor(x/width*wave.length),end=Math.max(first+1,Math.floor((x+3)/width*wave.length));for(let i=first;i<Math.min(end,wave.length);i++)value=Math.max(value,wave[i]);const h=Math.max(1,Math.min(height,value/peak*height));context.fillRect(x,(height-h)/2,1.5,h);}
}

async function localFile(file,kind){
  const url=URL.createObjectURL(file);localUrls.add(url);
  try{
    const media=document.createElement(kind==='audio'?'audio':'video');media.preload=kind==='audio'?'metadata':'auto';media.muted=true;media.src=url;
    await new Promise((resolve,reject)=>{media.addEventListener('loadedmetadata',resolve,{once:true});media.addEventListener('error',()=>reject(new Error('无法读取这个媒体文件')),{once:true});});
    const length=media.duration;if(!Number.isFinite(length)||length<.1||length>3600)throw new Error('请选择 0.1 秒至 60 分钟的素材');
    const asset={id:makeId(),name:file.name.replace(/\.[^.]+$/,''),kind:kind==='audio'?'audio':'local-video',duration:length,local:true};
    if(kind==='audio'){
      asset.audio=url;
      if(file.size<80*1024**2){
        try{const context=new AudioContext();try{const data=await context.decodeAudioData(await file.arrayBuffer());const channel=data.getChannelData(0),step=Math.max(1,Math.floor(channel.length/1500));asset.energy=[];for(let start=0;start<channel.length;start+=step){let energy=0;for(let n=start;n<Math.min(start+step,channel.length);n+=8)energy+=channel[n]**2;asset.energy.push(Math.sqrt(energy/(step/8)));}}finally{await context.close();}}catch{}
      }
    }else{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      await new Promise((resolve,reject)=>{media.addEventListener('loadeddata',resolve,{once:true});media.addEventListener('error',reject,{once:true});if(media.readyState>=2)resolve();});
      canvas.getContext('2d').drawImage(media,0,0,320,180);asset.thumb=canvas.toDataURL('image/jpeg',.8);asset.preview=url;
    }
    media.removeAttribute('src');media.load();assets.push(asset);
    if(kind==='audio'){switchAudio(asset.id);activateTab('audio');}
    else{activateTab('video');hint('背景已加入本页素材库，点击「＋」放到空白区域；初稿只预览本地视频首帧');}
    $('import-dialog').close();renderAssets();
  }catch(error){URL.revokeObjectURL(url);localUrls.delete(url);throw error;}
}

function setup(){
  document.querySelectorAll('[data-tab]').forEach(node=>node.addEventListener('click',()=>activateTab(node.dataset.tab)));
  document.querySelectorAll('[data-inspector]').forEach(node=>node.addEventListener('click',()=>inspectorTab(node.dataset.inspector)));
  document.querySelectorAll('[data-close]').forEach(node=>node.addEventListener('click',()=>$(node.dataset.close).close()));
  for(const [id,key] of Object.entries({'clip-start':'start','clip-duration':'duration','source-in':'sourceIn','source-out':'sourceOut','focus':'focus','zoom':'zoom','card-x':'cardX','card-y':'cardY','card-scale':'cardScale'}))propertyChange(id,key);
  $('search').addEventListener('input',renderAssets);
  for(const [id,fn] of Object.entries({split:splitSelected,delete:deleteSelected,'delete-property':deleteSelected,undo,redo,play:togglePlay,'change-audio':musicDialog}))$(id).addEventListener('click',()=>run(fn));
  $('replace').addEventListener('click',()=>{replacing=true;activateTab('video');document.body.classList.add('replacing');hint('替换模式：点击左侧某个背景的「↔」；按 Esc 取消');});
  $('snap').addEventListener('click',()=>{snap=!snap;$('snap').setAttribute('aria-pressed',snap);});
  $('previous').addEventListener('click',()=>{pause();setTime(time-MIN_CLIP);});$('next').addEventListener('click',()=>{pause();setTime(time+MIN_CLIP);});
  $('zoom-timeline').addEventListener('input',event=>{zoom=Number(event.target.value);renderTimeline();});
  $('fit').addEventListener('click',()=>{zoom=1;$('zoom-timeline').value=1;renderTimeline();$('timeline-scroll').scrollLeft=0;});
  $('ruler').addEventListener('pointerdown',event=>{pause();setTime(timelineTime(event));});
  $('video-track').addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});
  $('video-track').addEventListener('drop',event=>{event.preventDefault();const asset=assetFor(event.dataTransfer.getData('text/plain'));if(asset&&asset.kind!=='audio')run(()=>addAsset(asset,round(timelineTime(event))));});
  $('import-open').addEventListener('click',()=>$('import-dialog').showModal());
  for(const id of ['import-audio','import-music'])$(id).addEventListener('click',()=>$('file-audio').click());
  $('import-video').addEventListener('click',()=>$('file-video').click());
  for(const kind of ['video','audio'])$(`file-${kind}`).addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';if(file)run(()=>localFile(file,kind));});
  $('review').addEventListener('click',()=>$('review-dialog').showModal());
  $('full').addEventListener('click',()=>run(()=>$('viewer').requestFullscreen()));
  $('select-card').addEventListener('click',()=>{
    const active=resolveClip(clips,time);if(active)select(active.clip.id);cardSelected=!cardSelected;$('card-stack').classList.toggle('selected',cardSelected);inspectorTab('picture');
  });
  $('reset-card').addEventListener('click',()=>run(()=>{const before=capture();clips=editClip(clips,selected,{cardX:0,cardY:0,cardScale:1});commit(before);}));
  $('card-stack').addEventListener('pointerdown',event=>{
    const active=resolveClip(clips,time);if(!active)return;pause();select(active.clip.id);inspectorTab('picture');cardSelected=true;$('card-stack').classList.add('selected');
    const before=capture(),initial=structuredClone(chosen()),x=event.clientX,y=event.clientY,node=event.currentTarget;
    event.preventDefault();node.setPointerCapture(event.pointerId);let changed=false;
    const move=event=>{const dx=(event.clientX-x)/$('viewer').clientWidth*1920,dy=(event.clientY-y)/$('viewer').clientHeight*1080;changed||=Math.abs(dx)+Math.abs(dy)>2;clips=editClip(clips,selected,{cardX:Math.round(clamp(initial.cardX+dx,-500,500)),cardY:Math.round(clamp(initial.cardY+dy,-500,500))});drawPreview(true);renderInspector();};
    const finish=event=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',finish);node.removeEventListener('pointercancel',cancel);if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);if(changed)commit(before);};
    const cancel=event=>{clips=before.clips;changed=false;finish(event);drawPreview(true);renderInspector();};
    node.addEventListener('pointermove',move);node.addEventListener('pointerup',finish);node.addEventListener('pointercancel',cancel);
  });
  const resize=$('resize-bar');
  resize.addEventListener('pointerdown',event=>{
    resize.setPointerCapture(event.pointerId);const initial=$('editor').getBoundingClientRect();
    const move=event=>{const height=clamp(initial.bottom-event.clientY-5,240,Math.min(550,initial.height-270));$('editor').style.setProperty('--timeline-height',`${height}px`);};
    const stop=()=>{resize.removeEventListener('pointermove',move);resize.removeEventListener('pointerup',stop);resize.removeEventListener('pointercancel',stop);};
    resize.addEventListener('pointermove',move);resize.addEventListener('pointerup',stop);resize.addEventListener('pointercancel',stop);
  });
  resize.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const current=document.querySelector('.timeline').clientHeight;$('editor').style.setProperty('--timeline-height',`${clamp(current+(event.key==='ArrowUp'?25:-25),240,550)}px`);}});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){replacing=false;document.body.classList.remove('replacing');renderAssets();}
    if(event.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
    if(event.code==='Space'){event.preventDefault();run(togglePlay);}else if(event.key.toLowerCase()==='s'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();run(splitSelected);}else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();deleteSelected();}
  });
  new ResizeObserver(()=>{if(!dragging&&state){renderTimeline();drawPreview(true);}}).observe($('timeline-scroll'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  window.addEventListener('pagehide',()=>{pause();audio.removeAttribute('src');audio.load();for(const url of localUrls)URL.revokeObjectURL(url);});
}

try{
  const response=await fetch('/api/workbench');if(!response.ok)throw new Error('无法读取当前草稿，请先启动工作台');state=await response.json();
  original=(await import('/project/song-data.js')).SONG;
  assets=[{id:'original',name:original.title,kind:'audio',audio:original.audio,duration:original.duration,songTitle:original.title,artist:original.artist},...state.assets];
  ({title,artist,audioId}=state.draft);duration=state.duration;lyrics=structuredClone(state.draft.lyrics);
  clips=Array.isArray(state.draft.clips)?structuredClone(state.draft.clips):legacyClips(state.draft,duration,makeId);selected=clips[0]?.id;time=Math.min(3.5,duration/2);
  $('draft-name').textContent=state.draft.name;
  setup();setAudio();refresh();setTime(time);
  window.EDIT_STUDIO_READY=true;
}catch(error){hint(error.message,true);$('draft-name').textContent='无法打开初稿';}
