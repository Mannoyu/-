import {legacyClips,clipEnd} from './clip-editor-model.mjs';
import {createClipEditor} from './workbench-clips.js';
import {createElementEditor} from './workbench-elements.js';
const get = id => document.getElementById(id);
const audio = get('audio');
const preview = get('preview');
const status = get('status');
const layoutLabels = {cardX:'卡片横移',cardY:'卡片竖移',cardScale:'卡片大小',lyricX:'字幕横移',lyricY:'字幕竖移',lyricScale:'字幕区域缩放'};
const importLabels = {audio:'音乐',video:'背景视频',package:'Wallpaper 基础背景',dynamic:'Wallpaper 动态版'};
let state, token, slotIndex = 0, lineIndex = -1, sceneKey, revision = 0;
let importKind, savedPosition = 0, drawing = false, queuedDraw = false, frameRequest, poll;
let readyScene, lastClock = -Infinity;
let captureInProgress = false;
let previewSuspended = false;
let replacementAsset;
let renameAssetId, backgroundImportTarget;
const tracks = ['ticks','background-track','audio-track','lyric-track'].map(get);
const playheads = tracks.map(()=>Object.assign(document.createElement('span'),{className:'playhead'}));
let queue = Promise.resolve();
let assetFilter='all',assetSearch='',waveAudio,lastDraft,past=[],future=[];
const clipEditor=createClipEditor({state:()=>state,index:()=>slotIndex,select:index=>{slotIndex=index;},time:()=>savedPosition,
  save,paintSlot,paintTimeline,seek,stamp,notify,panel:switchPanel,pause:()=>audio.pause()});
const elementEditor=createElementEditor({state:()=>state,save,seek,notify,panel:switchPanel,pause:()=>audio.pause(),play:()=>audio.play(),
  playing:()=>!audio.paused,
  selectLyric:()=>selectLyric(state.draft.lyrics.findIndex(line=>savedPosition>=line.time&&savedPosition<line.end)),
  selectBackground:()=>{slotIndex=state.draft.clips.findIndex(clip=>savedPosition>=clip.start&&savedPosition<clipEnd(clip));paintSlot();}});
elementEditor.bind();

function notify(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

function releasePlayer(player) {
  player.pause();player.removeAttribute('src');player.load();player.hidden=true;
}
for(const [dialog,player] of [['capture-dialog','sample'],['export-dialog','result']]){
  get(dialog)?.addEventListener('close',()=>releasePlayer(get(player)));
}

async function api(endpoint, data, raw) {
  const headers = {'x-showreel-token':token};
  if (data && !raw) headers['content-type'] = 'application/json';
  const response = await fetch(endpoint, data ? {method:'POST',headers,body:raw?data:JSON.stringify(data)} : {headers});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
  return result;
}

function action(task) {
  const pending = queue.then(task);
  queue = pending.catch(error => notify(error.message,true));
  return pending;
}

function options(select, rows, value) {
  select.replaceChildren(...rows.map(([key,label]) => new Option(label,key)));
  select.value = String(value);
}

function stamp(time) {
  const seconds = Math.max(0,time);
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${(seconds%60).toFixed(2).padStart(5,'0')}`;
}

function position(time) {
  return Math.max(0,Math.min(time, state.duration - 1/60));
}

function drawTime(time) {
  savedPosition = position(time);
  const now = performance.now();
  if(audio.paused||now-lastClock>=32){
    get('clock').value = stamp(savedPosition);
    get('scrub').value = savedPosition;
    for(const playhead of playheads)playhead.style.left=`${savedPosition/state.duration*100}%`;
    lastClock=now;
  }
  if (readyScene!==sceneKey) return;
  const player = preview.contentWindow;
  if (!player?.READY) return;
  if (drawing) {
    queuedDraw = true;
    return;
  }
  drawing = true;
  const renderScene=sceneKey;
  Promise.resolve(player.render(savedPosition)).then(()=>{if(renderScene===sceneKey)elementEditor.update();}).catch(error => {if(renderScene===sceneKey)notify(error.message,true);}).finally(() => {
    if(renderScene!==sceneKey)return;
    drawing = false;
    if (queuedDraw) {
      queuedDraw = false;
      drawTime(savedPosition);
    }
  });
}

function seek(time) {
  audio.currentTime = position(time);
  drawTime(time);
}

function loadScene(key, title='画面预览') {
  get('preview-title').textContent = title;
  get('return-draft').hidden = title==='画面预览';
  if(captureInProgress||document.hidden){sceneKey=key;previewSuspended=true;return;}
  if (sceneKey === key) return;
  sceneKey = key;
  readyScene = undefined;
  drawing=false;queuedDraw=false;
  get('scene-box').hidden=true;
  preview.src = `/project/index.html?draft=${key}&render=1&w=1920&h=1080`;
  previewSuspended=false;
}

document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    audio.pause();
    readyScene=undefined;
    preview.src='about:blank';
    previewSuspended=true;
  } else if(previewSuspended&&!captureInProgress&&state){
    const key=sceneKey||state.key;
    sceneKey=undefined;
    loadScene(key,get('preview-title').textContent);
  }
});

function paintState(next,{reset=false,keep=false}={}) {
  const oldId=state?.draft.id;
  state = next;
  const {draft,assets,drafts,templates,duration} = state;
  if(!Array.isArray(draft.clips))draft.clips=legacyClips(draft,duration,(()=>{let index=0;return ()=>`${draft.id}-legacy-${index++}`;})());
  if(oldId!==draft.id){past=[];future=[];}
  lastDraft=structuredClone(draft);paintHistory();
  if (reset) {
    audio.pause();
    savedPosition = 0;
    slotIndex = 0;
    lineIndex = -1;
  }
  const url = `/project/${next.audio}`;
  if (audio.getAttribute('src') !== url) audio.src = url;
  get('scrub').max = Math.max(0,duration-1/60);
  get('duration').textContent = stamp(duration);
  get('draft-name').value=draft.name;
  get('song-name').value=draft.title;
  get('artist').value=draft.artist;
  options(get('drafts'),drafts.map(item=>[item.id,item.name]),draft.id);
  options(get('templates'),templates.map(item=>[item.id,item.name]),draft.templateId);
  options(get('audio-choice'),[['original','原始歌曲'],...assets.filter(item=>item.kind==='audio').map(item=>[item.id,item.name])],draft.audioId);
  slotIndex=Math.min(slotIndex,draft.clips.length-1);
  options(get('slots'),[[-1,'选择背景片段'],...draft.clips.map((item,index)=>[index,`${index+1} · ${stamp(item.start)} · ${assets.find(a=>a.id===item.assetId)?.name??'背景'}`])],slotIndex);
  options(get('lyric-choice'),[[-1,'全曲默认字幕'],...draft.lyrics.map((line,index)=>[index,`${stamp(line.time)} · ${line.text||'空白歌词'}`])],lineIndex);
  get('asset-count').textContent=`${assets.length} 项`;
  get('asset-list').replaceChildren(...assets.filter(asset=>(assetFilter==='all'||(assetFilter==='audio'?asset.kind==='audio':asset.kind!=='audio'))&&asset.name.toLowerCase().includes(assetSearch)).map(asset=>{
    const item=document.createElement('li');
    const thumbnail=document.createElement('span');
    thumbnail.className='asset-thumb';
    thumbnail.setAttribute('aria-hidden','true');
    if(asset.kind==='audio')thumbnail.textContent='♪';
    else {
      thumbnail.draggable=true;
      thumbnail.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',asset.id);event.dataTransfer.effectAllowed='copy';});
      const image=new Image();
      image.alt='';
      image.loading='lazy';
      image.decoding='async';
      const frame=String(Math.min(asset.count-1,Math.round(asset.fps))).padStart(5,'0');
      image.src=`/project/assets/frames/${encodeURIComponent(asset.frameDir??asset.id)}/${frame}.jpg`;
      image.addEventListener('error',()=>image.remove(),{once:true});
      thumbnail.append(image);
    }
    const copy=document.createElement('div');
    copy.className='asset-copy';
    const name=document.createElement('strong');
    name.textContent=asset.name;
    name.title=asset.name;
    const detail=document.createElement('span');
    detail.className='asset-spec';
    detail.textContent=asset.kind==='audio'?'音频':`${asset.staticBase?'静态底图 · ':''}${asset.width?`${asset.width}×${asset.height} · `:''}${Number(asset.fps.toFixed(2))} fps${asset.captureFps!==undefined?` · 实采 ${asset.captureFps} 次/秒`:''}${asset.captureWarning?' · 建议试看':''}`;
    copy.append(name,detail);
    if (asset.original) {
      const original=document.createElement('a');
      original.href=`/project/${asset.original}`;
      original.download=`${asset.name}.mp4`;
      original.textContent=`${asset.staticBase?'下载合成版':'下载原规格'} ${asset.sourceWidth}×${asset.sourceHeight} / ${Number(asset.sourceFps.toFixed(2))} fps`;
      copy.append(original);
    }
    const controls=document.createElement('div');
    controls.className='asset-actions';
    if(asset.kind!=='audio'){
      const use=createAssetButton('替换',()=>openReplacement(asset));
      use.setAttribute('aria-label',`替换背景：${asset.name}`);
      const add=createAssetButton('＋ 添加',()=>clipEditor.add(asset));
      add.setAttribute('aria-label',`添加背景：${asset.name}`);
      const rename=createAssetButton('重命名',()=>openAssetRename(asset));
      rename.setAttribute('aria-label',`重命名素材：${asset.name}`);
      controls.append(add,use);
      if(get('rename-dialog'))controls.append(rename);
    }else controls.append(createAssetButton(state.draft.audioId===asset.id?'使用中':'设为音乐',()=>switchMusic(asset.id)));
    if(asset.kind!=='builtin'){
      const remove=createAssetButton('移除',()=>{
        const usedBy=state.assetUsage?.[asset.id]??[];
        if(usedBy.length){notify(`请先在这些草稿中替换 ${asset.name}：${usedBy.join('、')}`,true);return;}
        return change('asset-remove',{assetId:asset.id}).then(()=>notify(`已移除 ${asset.name}，可在素材库底部恢复。`));
      });
      remove.setAttribute('aria-label',`移除素材：${asset.name}`);
      controls.append(remove);
    }
    item.append(thumbnail,copy);
    if(controls.childElementCount)item.append(controls);
    return item;
  }));
  const removed=next.removedAssets??[];
  get('removed-assets').hidden=!removed.length;
  get('removed-list').replaceChildren(...removed.map(asset=>{
    const row=document.createElement('li');
    const name=document.createElement('span');
    name.textContent=asset.name;
    row.append(name,createAssetButton('恢复',()=>change('asset-restore',{assetId:asset.id})),createAssetButton('永久删除',()=>{
      if(!confirm(`永久删除「${asset.name}」及其本地素材和逐帧文件？删除后无法恢复。`))return;
      releasePlayer(get('sample'));
      return change('asset-delete',{assetId:asset.id}).then(()=>notify(`已永久删除 ${asset.name} 的本地文件。`));
    }));
    return row;
  }));
  paintSlot();
  paintLyric();
  elementEditor.paint();
  for (const [name,value] of Object.entries(draft.layout)) get(name).value=value;
  paintTimeline();
  if(waveAudio!==draft.audioId){waveAudio=draft.audioId;clipEditor.loadWave();}
  if (!keep) loadScene(next.key);
  if(reset&&audio.readyState)seek(0);
  else drawTime(savedPosition);
  notify(`自动保存 · ${new Date(draft.updatedAt).toLocaleTimeString('zh-CN')}`);
}

function createAssetButton(label,handler) {
  const button=document.createElement('button');
  button.type='button';
  button.textContent=label;
  button.addEventListener('click',()=>Promise.resolve().then(handler).catch(error=>notify(error.message,true)));
  return button;
}

function showMaterials() {
  switchPanel('materials');
  document.querySelector('[data-panel="materials"]').focus();
}

function openReplacement(asset) {
  if(!state.draft.clips.length)throw new Error('时间线没有片段，请使用「添加」放入背景');
  replacementAsset=asset.id;
  get('replace-asset').textContent=asset.name;
  get('replace-status').textContent='';
  options(get('replace-slot'),state.draft.clips.map((slot,index)=>{
    const current=state.assets.find(item=>item.id===slot.assetId);
    return [index,`片段 ${index+1} · ${stamp(slot.start)} · ${current?.name||'背景'}`];
  }),slotIndex);
  get('replace-dialog').showModal();
}

function openAssetRename(asset) {
  if(!asset)throw new Error('找不到选中的背景素材');
  renameAssetId=asset.id;
  get('asset-name').value=asset.name;
  get('rename-status').textContent='';
  get('rename-dialog').showModal();
  get('asset-name').select();
}

async function replaceBackground(assetId,index) {
  const asset=state.assets.find(item=>item.id===assetId&&item.kind!=='audio');
  const draft=state.draft;
  const previous=draft.clips[index];
  if(!asset||!previous)throw new Error('找不到选中的素材或卡片');
  if(previous.assetId===assetId)return;
  const replacement={...previous,assetId,sourceIn:0,sourceOut:asset.duration,phase:0};
  draft.clips[index]=replacement;
  try {
    await save();
  } catch(error){
    if(draft.clips[index]===replacement)draft.clips[index]=previous;
    if(state.draft===draft)paintSlot();
    throw error;
  }
}

function paintSlot() {
  get('slots').value=String(slotIndex);
  const slot=state.draft.clips[slotIndex];
  get('clip-fields').hidden=!slot;get('clip-empty').hidden=Boolean(slot);
  if(!slot)return;
  options(get('backgrounds'),state.assets.filter(item=>item.kind!=='audio').map(item=>[item.id,item.name]),slot.assetId);
  get('focus').value=slot.focus;
  get('zoom').value=slot.zoom;
  get('trim-start').value=slot.sourceIn;
  get('trim-end').value=slot.sourceOut;
  get('clip-start').value=Number(slot.start.toFixed(4));get('clip-duration').value=Number(slot.duration.toFixed(4));
  get('clip-end-label').textContent=`结束 ${stamp(clipEnd(slot))}`;
  get('clip-card-x').value=slot.cardX;get('clip-card-y').value=slot.cardY;get('clip-card-scale').value=slot.cardScale;
  get('clip-transition').value=String(slot.transition??0);
}

function paintLyric() {
  const line = state.draft.lyrics[lineIndex];
  const style = line ? line.style||{} : state.draft.lyricStyle;
  get('lyric-fields').hidden = !line;
  get('font-size').value=style.fontSize||'';
  get('lyric-align').value=style.align||'';
  get('lyric-effect').value=style.effect||'default';
  get('lyric-delay').value=style.delay??0;get('lyric-duration').value=style.duration??.42;get('lyric-color').value=style.color||'#ffffff';
  if (!line) return;
  get('lyric-time').value=line.time;
  get('lyric-end').value=line.end;
  get('lyric-text').value=line.text;
  get('translation').value=line.translation;
  get('emphasis').value=(style.emphasis||[]).join('、');
}

function selectLyric(index) {
  switchPanel('lyric-settings');
  lineIndex=index;
  get('lyric-choice').value=String(index);
  paintLyric();
  selectClip('lyric-track',index);
  if (index>=0) seek(state.draft.lyrics[index].time+.18);
}

function selectClip(track, index) {
  for(const clip of get(track).querySelectorAll('.clip')){
    clip.setAttribute('aria-pressed',String(Number(clip.dataset.index)===index));
  }
}

function paintTimeline() {
  const {draft,duration}=state;
  const percent = time => `${time/duration*100}%`;
  tracks.forEach((track,index)=>track.replaceChildren(playheads[index]));
  const tickCount=8*Number(get('timeline-zoom').value);
  for (let index=0;index<tickCount;index++) {
    const time=index*duration/tickCount;
    const tick=document.createElement('span');
    tick.className='tick';tick.style.left=percent(time);tick.textContent=stamp(time).split('.')[0];
    get('ticks').append(tick);
  }
  function clip(track,start,end,label,choose,index) {
    const button=document.createElement('button');
    button.className='clip';button.textContent=label;button.title=`${stamp(start)}　${label}`;
    if(index!==undefined)button.dataset.index=index;
    button.style.left=percent(start);button.style.width=percent(Math.max(0,end-start));
    button.addEventListener('click',choose);
    get(track).append(button);
  }
  clipEditor.paintTrack();
  clip('audio-track',0,duration,`${draft.title} ${draft.artist?` · ${draft.artist}`:''}`,event=>{
    if(!event.detail)return;
    const bounds=event.currentTarget.getBoundingClientRect();
    seek((event.clientX-bounds.left)/bounds.width*duration);
  });
  draft.lyrics.forEach((line,index)=>clip('lyric-track',line.time,line.end,line.text||'歌词',()=>selectLyric(index),index));
  selectClip('lyric-track',lineIndex);
  clipEditor.paintWave();
}

function paintHistory(){get('undo').disabled=!past.length;get('redo').disabled=!future.length;}
function save({history=true}={}) {
  const draft=structuredClone(state.draft);
  const before=lastDraft;
  if(history&&before){past.push(structuredClone(before));if(past.length>60)past.shift();future=[];}
  lastDraft=structuredClone(draft);paintHistory();
  const ticket=++revision;
  notify('正在保存…');
  return action(async()=>{
    try {
      const result=await api('/api/workbench',{action:'save',id:draft.id,draft});
      if(ticket===revision)paintState(result);
    }catch(error){
      if(ticket===revision&&before){state.draft=before;lastDraft=structuredClone(before);if(history)past.pop();paintState(state,{keep:true});}
      throw error;
    }
  });
}

function restoreHistory(redo=false){
  const source=redo?future:past,target=redo?past:future;if(!source.length)return;
  target.push(structuredClone(state.draft));state.draft=source.pop();return save({history:false});
}

function change(actionName, fields={}, reset=false) {
  return action(async()=>{
    const result=await api('/api/workbench',{action:actionName,...fields});
    paintState(result,{reset});
  });
}

function bind(id,event,handler) {
  get(id).addEventListener(event, (...args)=>{
    if (!state) return;
    Promise.resolve().then(()=>handler(...args)).catch(error=>notify(error.message,true));
  });
}

function switchPanel(id) {
  const selected=document.querySelector(`[data-panel="${id}"]`);
  for(const button of selected.parentElement.querySelectorAll('[data-panel]')){
    button.setAttribute('aria-pressed',String(button===selected));
    get(button.dataset.panel).hidden=button!==selected;
  }
}
for(const button of document.querySelectorAll('[data-panel]')){
  button.addEventListener('click',()=>switchPanel(button.dataset.panel));
}
get('guide-open').addEventListener('click',()=>get('guide-dialog').showModal());
get('guide-materials').addEventListener('click',()=>{get('guide-dialog').close();showMaterials();});
get('template-backgrounds').addEventListener('click',showMaterials);
bind('replace-apply','click',async()=>{
  const button=get('replace-apply');
  const index=Number(get('replace-slot').value);
  const draft=state.draft;
  const previous=draft.clips[index];
  button.disabled=true;
  try {
    await replaceBackground(replacementAsset,index);
    slotIndex=index;
    get('slots').value=String(index);
    paintSlot();
    audio.pause();
    const start=draft.clips[index]?.start;
    if(start!==undefined)seek(Math.min(start+.15,clipEnd(draft.clips[index])-1/60));
    get('replace-dialog').close();
    switchPanel('background-settings');
    notify(`片段 ${index+1} 的背景已保存。`);
  } catch(error){
    if(state.draft===draft)draft.clips[index]=previous;
    get('replace-status').textContent=error.message;
  } finally {button.disabled=false;}
});

function sizePreview() {
  const scale=get('monitor-surface').clientWidth/1920;
  preview.contentWindow?.setWorkbenchPreviewScale?.(scale,devicePixelRatio);
}
new ResizeObserver(sizePreview).observe(get('monitor-surface'));
preview.addEventListener('load',async()=>{
  const player=preview.contentWindow;
  const scene=sceneKey;
  if(!scene||new URL(player.location.href).searchParams.get('draft')!==scene)return;
  for (let attempt=0;attempt<200&&scene===sceneKey&&!player.READY;attempt++) await new Promise(resolve=>setTimeout(resolve,50));
  if(scene!==sceneKey)return;
  if(!player.READY){notify('未能加载预览画面，请刷新工作台',true);return;}
  readyScene=scene;
  sizePreview();
  player.setWorkbenchPlaying(!audio.paused);
  drawTime(audio.paused?savedPosition:audio.currentTime);
});
audio.addEventListener('loadedmetadata',()=>{if(state)seek(savedPosition);});
audio.addEventListener('play',()=>{
  get('play').textContent='Ⅱ';
  get('play').setAttribute('aria-label','暂停');
  get('preview-quality').textContent='实时播放';
  elementEditor.update();
  preview.contentWindow?.setWorkbenchPlaying?.(true);
  let lastFrame = -1;
  const tick = () => {
    if (audio.paused) return;
    const time = audio.currentTime;
    const frame = Math.floor(time * 60);
    if (frame !== lastFrame) {
      lastFrame = frame;
      drawTime(time);
    }
    frameRequest = requestAnimationFrame(tick);
  };
  frameRequest=requestAnimationFrame(tick);
});
audio.addEventListener('pause',()=>{
  cancelAnimationFrame(frameRequest);
  preview.contentWindow?.setWorkbenchPlaying?.(false);
  get('play').textContent='▶';
  get('play').setAttribute('aria-label','播放');
  get('preview-quality').textContent='源帧核对';
  if(state)drawTime(audio.currentTime);
});

bind('play','click',()=>audio.paused ? audio.play() : audio.pause());
for(const [id,step] of [['previous-frame',-1],['next-frame',1]]){
  bind(id,'click',()=>{
    audio.pause();
    seek((Math.round(savedPosition*60)+step)/60);
  });
}
const fullscreen=get('fullscreen');
fullscreen.hidden=!document.fullscreenEnabled;
bind('fullscreen','click',()=>document.fullscreenElement?document.exitFullscreen():get('monitor').requestFullscreen());
document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'退出全屏':'全屏';});
bind('timeline-zoom','change',event=>{
  const trackArea=get('tracks');
  const viewport=get('timeline-scroll');
  const progress=savedPosition/state.duration;
  const cursorOffset=progress*trackArea.clientWidth-viewport.scrollLeft;
  const anchor=cursorOffset>=0&&cursorOffset<=viewport.clientWidth?cursorOffset:viewport.clientWidth/2;
  trackArea.style.width=`${Number(event.target.value)*100}%`;
  paintTimeline();
  viewport.scrollLeft=progress*trackArea.clientWidth-anchor;
});
document.addEventListener('keydown',event=>{
  if(event.code!=='Space'||event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.target.closest('input,textarea,select,button,a,summary,[contenteditable]')||document.querySelector('dialog[open]'))return;
  event.preventDefault();get('play').click();
});
bind('scrub','input',event=>seek(Number(event.target.value)));
bind('ticks','pointerdown',event=>{
  const box=get('ticks').getBoundingClientRect();seek((event.clientX-box.left)/box.width*state.duration);
});
bind('drafts','change',event=>change('open',{id:event.target.value},true));
bind('new-draft','click',()=>{
  const name=window.prompt('新草稿名称',`${state.draft.name} · 新视频`);
  if(name?.trim())return change('new',{name},true);
});
for (const [id,key] of Object.entries({'draft-name':'name','song-name':'title',artist:'artist'})) {
  bind(id,'change',event=>{state.draft[key]=event.target.value;return save();});
}
async function switchMusic(id){
  if(id===state.draft.audioId)return;
  state.draft.audioId=id;
  const music=state.assets.find(asset=>asset.id===id);
  if (music) {
    state.draft.title=music.name;
    state.draft.artist='';
    lineIndex=-1;
    savedPosition=0;
    audio.pause();
  } else {
    const {SONG:original}=await import('/song-data.js');
    Object.assign(state.draft,{title:original.title,artist:original.artist});
    lineIndex=-1;
    savedPosition=0;
    audio.pause();
  }
  await save();get('music-dialog').close();
}
bind('audio-choice','change',event=>switchMusic(event.target.value));
bind('change-music','click',async()=>{
  const {SONG}=await import('/song-data.js');
  get('music-list').replaceChildren(...[{id:'original',name:SONG.title,duration:SONG.duration},...state.assets.filter(a=>a.kind==='audio')].map(asset=>{
    const button=createAssetButton(`${asset.id===state.draft.audioId?'使用中 · ':''}${asset.name} · ${stamp(asset.duration)}`,()=>switchMusic(asset.id));
    button.className='music-option';button.setAttribute('aria-pressed',String(asset.id===state.draft.audioId));return button;
  }));get('music-dialog').showModal();
});
bind('template-preview','click',()=>action(async()=>{
  const result=await api('/api/workbench',{action:'template-preview',templateId:get('templates').value});
  loadScene(result.key,`模板预览 · ${get('templates').selectedOptions[0].textContent}`);
}));
bind('return-draft','click',()=>loadScene(state.key));
bind('template-apply','click',()=>change('template-apply',{templateId:get('templates').value}));
bind('template-save','click',()=>{
  const name=window.prompt('模板名称',`模板 ${String(state.templates.length+1).padStart(2,'0')}`);
  if(name?.trim())return change('template-save',{name,includeBackgrounds:get('template-include-backgrounds').checked});
});
for (const [name,label] of Object.entries(layoutLabels)) {
  const wrapper=document.createElement('label');
  wrapper.textContent=label;
  const input=document.createElement('input');
  const scale=name.endsWith('Scale');
  Object.assign(input,{id:name,type:'number',min:scale?.5:-500,max:scale?1.5:500,step:scale?.05:1});
  wrapper.append(input);get('layout').append(wrapper);
  bind(name,'change',event=>{state.draft.layout[name]=Number(event.target.value);if(name.startsWith('card'))state.draft.clips=state.draft.clips.map(clip=>({...clip,[name]:Number(event.target.value)}));return save();});
}
bind('slots','change',event=>{slotIndex=Number(event.target.value);paintSlot();paintTimeline();});
bind('backgrounds','change',event=>{
  return replaceBackground(event.target.value,slotIndex);
});
for (const [id,key] of Object.entries({focus:'focus',zoom:'zoom','trim-start':'sourceIn','trim-end':'sourceOut'})) {
  bind(id,'change',event=>clipEditor.patch({[key]:Number(event.target.value)}));
}
bind('lyric-choice','change',event=>selectLyric(Number(event.target.value)));
bind('add-lyric','click',()=>{
  const time=Number(savedPosition.toFixed(3));
  if(state.draft.lyrics.some(line=>Math.abs(line.time-time)<.025))throw new Error('此时间已有歌词，请选择现有歌词编辑');
  const next=state.draft.lyrics.find(line=>line.time>time);
  const previous=state.draft.lyrics.findLast(line=>line.time<time);
  if(previous&&previous.end>time)previous.end=time;
  const entry={time,end:Math.min(state.duration,next?.time??state.duration,time+4),text:'新字幕',translation:'',kind:'lyric'};
  state.draft.lyrics.push(entry);state.draft.lyrics.sort((first,second)=>first.time-second.time);lineIndex=state.draft.lyrics.indexOf(entry);
  return save();
});
bind('remove-lyric','click',()=>{state.draft.lyrics.splice(lineIndex,1);lineIndex=-1;return save();});
for (const [id,key] of Object.entries({'lyric-time':'time','lyric-end':'end','lyric-text':'text',translation:'translation'})) {
  bind(id,'change',event=>{
    const line=state.draft.lyrics[lineIndex];
    line[key]=event.target.type==='number'?Number(event.target.value):event.target.value;
    if(key==='time'){
      state.draft.lyrics.sort((first,second)=>first.time-second.time);lineIndex=state.draft.lyrics.indexOf(line);
    }
    return save();
  });
}
for (const [id,key,parse] of [['font-size','fontSize',value=>value?Number(value):undefined],['lyric-align','align',String],['lyric-effect','effect',String],['lyric-delay','delay',Number],['lyric-duration','duration',Number],['lyric-color','color',String],['emphasis','emphasis',value=>value.split(/[、,，]+/).map(word=>word.trim()).filter(Boolean)]]) {
  bind(id,'change',event=>{
    const line=state.draft.lyrics[lineIndex];
    const style=line?(line.style??={}):state.draft.lyricStyle;
    style[key]=parse(event.target.value);
    return save();
  });
}
bind('lyric-replay','click',()=>{const line=state.draft.lyrics[lineIndex];seek(line?.time??0);return audio.play();});
bind('lrc-open','click',()=>get('lrc-file').click());
bind('lrc-file','change',async event=>{
  const file=event.target.files[0];
  event.target.value='';
  if(!file)return;
  const lines=new Map();
  for (const row of (await file.text()).split(/\r?\n/)) {
    const text=row.replace(/\[[^\]]*\]/g,'').trim();
    if (!text) continue;
    for (const match of row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) {
      const time=Number(match[1])*60+Number(match[2]);
      if(time>=state.duration)continue;
      if(lines.has(time)) lines.get(time).translation=text;
      else lines.set(time,{time,end:state.duration,text,translation:'',kind:'lyric'});
    }
  }
  if (!lines.size) throw new Error('没有找到当前歌曲时长内的 LRC 歌词');
  state.draft.lyrics=[...lines.values()].sort((first,second)=>first.time-second.time);
  lineIndex=-1;
  return save();
});

async function upload(blob,kind,name) {
  notify(`正在准备${importLabels[kind]}…`);
  const query=new URLSearchParams({kind,name});
  const result=await api(`/api/workbench/import?${query}`,blob,true);
  Object.assign(state,{assets:result.assets,assetUsage:result.assetUsage,removedAssets:result.removedAssets});
  paintState(state,{keep:true});
  notify(`已入库 ${result.imported.length} 项${importLabels[kind]}`);
  return result.imported;
}
for (const button of document.querySelectorAll('[data-import]')) {
  button.addEventListener('click',()=>{
    importKind=button.dataset.import;
    get('import-file').accept={audio:'audio/*,.flac,.m4a',video:'video/*,.mkv',package:'.pkg'}[importKind];
    get('import-file').click();
  });
}
bind('import-file','change',event=>{
  const file=event.target.files[0];event.target.value='';
  if(file)return upload(file,importKind,file.name.replace(/\.[^.]+$/,''));
});
get('background-rename')?.addEventListener('click',()=>{
  if(state)openAssetRename(state.assets.find(asset=>asset.id===get('backgrounds').value));
});
get('rename-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const name=get('asset-name').value.trim();
  const button=get('rename-apply');
  if(button.disabled)return;
  if(!name){get('rename-status').textContent='请输入背景素材名称';return;}
  button.disabled=true;
  try {
    await change('asset-rename',{assetId:renameAssetId,name});
    get('rename-dialog').close();
    notify(`素材已重命名为 ${name}`);
  } catch(error){get('rename-status').textContent=error.message;}
  finally{button.disabled=false;}
});
get('background-import')?.addEventListener('click',()=>{
  if(!state)return;
  if(!state.draft.clips[slotIndex])return;
  backgroundImportTarget={draftId:state.draft.id,index:slotIndex,id:state.draft.clips[slotIndex].id};
  get('background-file').click();
});
get('background-file')?.addEventListener('change',async event=>{
  const [file]=event.target.files;
  const target=backgroundImportTarget;
  event.target.value='';
  if(!file||!target)return;
  const button=get('background-import');
  button.disabled=true;
  try {
    const [asset]=await upload(file,'video',file.name.replace(/\.[^.]+$/,''));
    await queue;
    if(state.draft.id!==target.draftId||state.draft.clips[target.index]?.id!==target.id){
      notify('视频已入库，可在素材库选择「用作背景」。');
      return;
    }
    await replaceBackground(asset.id,target.index);
    notify(`片段 ${target.index+1} 已换成 ${asset.name}`);
  } catch(error){notify(error.message,true);
  } finally {button.disabled=false;}
});
bind('wallpaper-folder','click',()=>get('wallpaper-folder-input').click());
bind('wallpaper-folder-input','change',async event=>{
  const files=Array.from(event.target.files);
  event.target.value='';
  if(!files.length)return;
  const rootFiles=files.filter(file=>file.webkitRelativePath.split('/').length===2);
  const scene=rootFiles.find(file=>file.name.toLowerCase()==='scene.pkg');
  if(!scene)throw new Error('所选文件夹根目录没有 scene.pkg，请选择 Wallpaper 的创意工坊项目文件夹。');
  let name=scene.webkitRelativePath.split('/')[0];
  const project=rootFiles.find(file=>file.name.toLowerCase()==='project.json');
  if(project&&project.size<=1024*1024){
    try {
      const title=JSON.parse(await project.text()).title;
      if(typeof title==='string'&&title.trim())name=title.trim();
    } catch {}
  }
  return upload(scene,'package',name);
});
bind('capture-open','click',()=>get('capture-dialog').showModal());
let captureSettingsFolder;
bind('capture-folder','input',()=>{
  captureSettingsFolder=undefined;
  get('capture-status').textContent='';
  get('capture-settings').replaceChildren();
  get('capture-settings').hidden=true;
});
bind('capture-load-settings','click',async()=>{
  const folder=get('capture-folder').value.trim();
  const status=get('capture-status');
  const button=get('capture-load-settings');
  if(!folder){status.textContent='请粘贴壁纸文件夹路径。';return;}
  button.disabled=true;
  get('record').disabled=true;
  status.textContent='正在读取壁纸设置…';
  try {
    const {title,properties,layers}=await api('/api/workbench/wallpaper-settings',{folder});
    if(folder!==get('capture-folder').value.trim())return;
    captureSettingsFolder=folder;
    const settings=get('capture-settings');
    settings.replaceChildren();
    const appendGroup=(heading,items)=>{
      if(!items.length)return;
      const group=document.createElement('details');
      const summary=document.createElement('summary');
      summary.textContent=heading;
      group.append(summary,...items);
      group.open=heading==='壁纸开关';
      settings.append(group);
    };
    const createField=(name,element)=>{
      const label=document.createElement('label');
      label.className='capture-setting';
      label.append(name,element);
      return label;
    };
    appendGroup('壁纸开关',properties.map(property=>{
      const control=document.createElement(property.options?'select':'input');
      control.dataset.property=property.key;
      if(property.options){
        property.options.forEach((option,index)=>control.add(new Option(option.label,index)));
        control.selectedIndex=property.options.findIndex(option=>option.value===property.value);
        control.values=property.options.map(option=>option.value);
      } else {
        control.type='checkbox';control.checked=property.value;
      }
      return createField(property.label,control);
    }));
    appendGroup('隐藏粒子和文字图层',layers.filter(layer=>layer.visible).map(layer=>{
      const control=document.createElement('input');control.type='checkbox';control.dataset.layer=layer.id;
      return createField(`${layer.kind} · ${layer.label}`,control);
    }));
    settings.hidden=!settings.childElementCount;
    status.textContent=settings.hidden?`${title} 没有可调整的开关或图层。`:`已读取 ${title}`;
  } catch(error){
    if(folder===get('capture-folder').value.trim())status.textContent=error.message;
  } finally {
    button.disabled=false;
    get('record').disabled=false;
  }
});
bind('record','click',async()=>{
  if(captureInProgress)return;
  const folder=get('capture-folder').value.trim();
  const message=get('capture-status');
  if(!folder){message.textContent='请粘贴壁纸文件夹路径。';get('capture-folder').focus();return;}
  audio.pause();
  captureInProgress=true;
  readyScene=undefined;
  preview.src='about:blank';
  const seconds=Math.max(3,Math.min(60,Math.round(Number(get('capture-duration').value)||10)));
  const video=get('sample');
  releasePlayer(video);
  get('record').disabled=true;
  get('capture-load-settings').disabled=true;
  get('capture-folder').disabled=true;
  message.textContent=`正在采集 ${seconds} 秒。工作台画面已暂停；若帧率不稳，会重试一次并保留较流畅的结果。`;
  try {
    const settings=get('capture-settings');
    const properties=captureSettingsFolder===folder?Object.fromEntries([...settings.querySelectorAll('[data-property]')].map(control=>[
      control.dataset.property,control.type==='checkbox'?control.checked:control.values[control.selectedIndex],
    ])):{};
    const hiddenLayers=captureSettingsFolder===folder?[...settings.querySelectorAll('[data-layer]:checked')].map(control=>Number(control.dataset.layer)):[];
    const result=await api('/api/workbench/capture',{folder,seconds,properties,hiddenLayers});
    const [asset]=result.imported;
    Object.assign(state,{assets:result.assets,assetUsage:result.assetUsage,removedAssets:result.removedAssets});
    paintState(state,{keep:true});
    video.src=`/project/${asset.preview}`;
    video.hidden=false;
    message.textContent=`已入库 · ${asset.width}×${asset.height} · 实采约 ${asset.captureFps} 次/秒 · 内容累计静止约 ${asset.freezeSeconds} 秒。${asset.captureWarning||''}${asset.nearlyStatic?'这段画面接近静止，可保留部分效果后重新采集。':''}`;
    notify(`已入库：${asset.name}`);
  } catch(error) {
    message.textContent=error.message;
  } finally {
    const key=sceneKey;
    sceneKey=undefined;
    captureInProgress=false;
    loadScene(key||state.key,get('preview-title').textContent);
    get('record').disabled=false;
    get('capture-load-settings').disabled=false;
    get('capture-folder').disabled=false;
  }
});

function exportControls() {
  get('export-value-label').hidden=get('export-mode').value==='single';
}
function paintExport(job) {
  get('export-progress').value=job?.progress||0;
  get('export-status').textContent=job?.error||job?.phase||'';
  get('export-start').disabled=job?.status==='running';
  get('export-cancel').disabled=job?.status!=='running';
  if(job?.status==='complete'&&get('export-dialog').open){
    const player=get('result');const link=get('download');
    if(player.getAttribute('src')!==job.result.url)player.src=job.result.url;
    get('export-location').textContent=`已保存到：${job.result.file}`;
    player.hidden=link.hidden=false;
  }
  if(job?.status!=='running'){clearInterval(poll);poll=undefined;}
}
async function readExport(){paintExport(await api('/api/video-export'));}
bind('storage-clean','click',()=>action(async()=>{
  const next=await api('/api/workbench',{action:'storage-clean'});
  paintState(next,{keep:true});
  notify(`已释放 ${(next.cleanup.freedBytes/1024**2).toFixed(1)} MiB 缓存，下次导出会重新渲染。`);
}));
function watchExport(){if(!poll)poll=setInterval(()=>readExport().catch(error=>notify(error.message,true)),800);}
bind('export-open','click',async()=>{
  get('export-mode').value=state.draft.export.mode;
  get('export-value').value=state.draft.export.value;
  exportControls();get('export-dialog').showModal();
  await readExport();if(get('export-start').disabled)watchExport();
});
async function saveExportSettings() {
  state.draft.export={mode:get('export-mode').value,value:Number(get('export-value').value)};
  return save();
}
bind('export-mode','change',()=>{exportControls();return saveExportSettings();});
bind('export-value','change',saveExportSettings);
bind('export-start','click',async()=>{
  await saveExportSettings();
  const job=await api('/api/video-export',{...state.draft.export,draftId:state.draft.id});
  releasePlayer(get('result'));get('download').hidden=true;
  paintExport(job);watchExport();
});
bind('export-cancel','click',()=>api('/api/video-export',{cancel:true}).then(paintExport));
bind('download','click',()=>api('/api/video-export',{reveal:true}));

bind('undo','click',()=>restoreHistory());bind('redo','click',()=>restoreHistory(true));
document.addEventListener('keydown',event=>{
  if(!state||event.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();Promise.resolve(restoreHistory(event.shiftKey)).catch(error=>notify(error.message,true));}
});
get('asset-search').addEventListener('input',event=>{assetSearch=event.target.value.trim().toLowerCase();if(state)paintState(state,{keep:true});});
for(const button of document.querySelectorAll('[data-asset-filter]'))button.addEventListener('click',()=>{
  assetFilter=button.dataset.assetFilter;document.querySelectorAll('[data-asset-filter]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));if(state)paintState(state,{keep:true});
});
clipEditor.bind();
try {
  const initial=await api('/api/workbench');
  token=initial.token;
  paintState(initial,{reset:true});
} catch(error) {notify(error.message,true);}
