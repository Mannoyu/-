import {DUR, LYRICS, SHOTS, CHORUSES} from './timeline.js';
import {createEffects} from './effects.js';
import {createDeck,deckState,drawCover,BACKGROUNDS} from './deck.js';
import {createMediaSampler,createVideoElements} from './media.js';
import {SONG} from './runtime-song.js';
import {createPvLyrics} from './pv-lyrics.js';
import {createWorld} from './world.js';
import {createPerformance} from './performance.js';
import {createTemplateFrame} from './template-frame.js';
import {createTemplateLyrics} from './template-lyrics.js';
import {resolveClipScene} from './clip-editor-model.mjs';
const q=new URLSearchParams(location.search);
const presentation=q.get('presentation')||'original';
const titleLine=LYRICS.find(line=>line.kind==='title');
const usePV=Boolean(titleLine)||q.get('lyrics')!=='classic';
document.querySelector('.lyrics').classList.toggle('pv-mode',usePV);
const W=Number(q.get('w'))||1920,H=Number(q.get('h'))||1080;
const stage=document.getElementById('stage');
stage.dataset.presentation=presentation;
stage.style.width='1920px';stage.style.height='1080px';
if(W!==1920||H!==1080)stage.style.transform=`scale(${Math.min(W/1920,H/1080)})`;
const esc0=t=>t.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fill={title:SONG.title,'title-upper':SONG.title.toUpperCase(),tagline:SONG.tagline,'title-artist':`${esc0(SONG.title)} <b>／</b> ${esc0(SONG.artist)}`,'artist-sub':esc0(SONG.artist)+(SONG.subtitle?` <span>／</span> ${esc0(SONG.subtitle)}`:'')};
document.querySelectorAll('[data-song]').forEach(el=>{const v=fill[el.dataset.song];if(el.dataset.song.includes('-')&&el.dataset.song!=='title-upper')el.innerHTML=v;else el.textContent=v;});
document.title=`${SONG.title} · 音乐壁纸`;
const videos=createVideoElements();
// Only the Motion Studio editor has a continuous playback clock.
const studioFrame=window.frameElement?.id==='scene'?window.frameElement:null;
const studioPlay=studioFrame?.ownerDocument.getElementById('play');
const media=createMediaSampler(videos,window.parent!==window,{workbench:window.frameElement?.id==='preview'});
window.prefetchExportFrame=time=>media.prefetch(time);
let exactPreview=false;
window.setExactPreview=value=>{exactPreview=value===true;};
let workbenchPlaying=false;
let previewScale=1;
window.setWorkbenchPreviewScale=(scale,pixelRatio)=>{
  stage.style.transform=`scale(${scale})`;
  previewScale=Math.max(.35,Math.min(1,scale*pixelRatio));
};
window.setWorkbenchPlaying=value=>{
  workbenchPlaying=value===true;
  if(!workbenchPlaying)media.pause();
};
const isPlaying=()=>workbenchPlaying||studioPlay?.getAttribute('aria-label')==='暂停';
if(studioPlay){
  new MutationObserver(()=>{if(!isPlaying())media.pause();})
    .observe(studioPlay,{attributes:true,attributeFilter:['aria-label']});
}
let previousTime=0;
const mediaSources=[];
const bg=document.getElementById('background');
bg.width=1920;bg.height=1080;
const bc=bg.getContext('2d');
const renderDeck=createDeck(mediaSources);
const cover=document.getElementById('coverGroup'),halo=document.getElementById('halo');
const lyricTrack=document.getElementById('lyricTrack');
if(SONG.layout){
  const {cardX,cardY,cardScale,lyricX,lyricY,lyricScale}=SONG.layout;
  if(cardX||cardY)cover.style.translate=`${cardX}px ${cardY}px`;
  if(cardScale!==1)cover.style.scale=String(cardScale);
  const lyrics=lyricTrack.closest('.lyrics');
  if(lyricX||lyricY)lyrics.style.translate=`${lyricX}px ${lyricY}px`;
  if(lyricScale!==1)lyrics.style.scale=String(lyricScale);
}
const drawBackground=(index)=>{
  const {cropFocus,zoom}=BACKGROUNDS[index];
  drawCover(bc,mediaSources[index],bg.width,bg.height,cropFocus,null,zoom);
};
const escape=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const graphemes=new Intl.Segmenter('ja',{granularity:'grapheme'});
const highlight=text=>[...graphemes.segment(text)].map(({segment})=>`<span class="lyricChar">${escape(segment)}</span>`).join('');
let lyricNumber=0;
lyricTrack.innerHTML=LYRICS.map(l=>`<div class="lyricLine" data-kind="${l.kind}"><span class="lineNumber">${l.kind==='lyric'?String(++lyricNumber).padStart(2,'0'):'·'}</span><i class="lineTick"></i><div class="lyricCopy"><span class="base">${escape(l.text)}<span class="sung" aria-hidden="true">${highlight(l.text)}</span></span><span class="translation">${escape(l.translation)}</span></div><i class="lineSweep" aria-hidden="true"></i></div>`).join('');
const lines=[...document.querySelectorAll('.lyricLine')];
const refs=lines.map(line=>({line,sung:line.querySelector('.sung'),chars:[...line.querySelectorAll('.lyricChar')],copy:line.querySelector('.lyricCopy'),base:line.querySelector('.base'),sweep:line.querySelector('.lineSweep'),translation:line.querySelector('.translation')}));
const lyricWindow=document.getElementById('lyricWindow');
const pv=usePV&&!titleLine?createPvLyrics(lyricWindow,LYRICS,CHORUSES,{emphasis:SONG.emphasis,style:presentation==='original'?SONG.lyricStyle:undefined,effectMode:q.get('lyricFx')==='contour'?'contour':'glow'}):null;
window.setLyricEffectStyle=(mode,strength=1)=>pv?.setEffectStyle(mode,strength);
const performance=usePV&&!titleLine&&presentation==='performance'?createPerformance(stage,LYRICS,CHORUSES,{enabled:true,emphasis:SONG.emphasis}):null;
const template=usePV&&presentation==='template'?createTemplateFrame(stage):null;
const templateLyrics=template&&!titleLine?createTemplateLyrics(lyricWindow,LYRICS,{emphasis:SONG.emphasis,style:SONG.lyricStyle}):null;
window.setPresentationStyle=mode=>{performance?.setEnabled(mode==='performance');performance?.fit();template?.setEnabled(mode==='template');templateLyrics?.setEnabled(mode==='template');if(mode==='template')templateLyrics?.fit();else pv?.fit();};
window.setFrameIntensity=value=>{template?.setStrength(value);templateLyrics?.setStrength(value);};
const meter=document.getElementById('meter');meter.innerHTML='<i></i>'.repeat(13);
const bars=[...meter.children];
const renderEffects=createEffects();
const renderWorld=createWorld(stage);
window.READY=false;
window.DUR=DUR;
window.motionIntensity=.75;
window.backgroundBrightness=1;
window.setPreviewStyle=mode=>{window.motionIntensity=mode==='quiet'?.35:mode==='vivid'?1.3:.75;};
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>x*x*(3-2*x);
const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
document.getElementById('endClock').textContent=clock(DUR);
let features;
function sample(array,time){
  const position=Math.max(0,time/features.step),i=Math.min(array.length-1,Math.floor(position));
  const p=position-i;
  return array[i]+((array[Math.min(i+1,array.length-1)]??array[i])-array[i])*p;
}
function musicAt(t){
  const frame=Math.min(features.bands.length-1,Math.floor(t/features.step));
  const energy=(sample(features.energy,t)+sample(features.energy,Math.max(0,t-.04))+sample(features.energy,Math.max(0,t-.08)))/3;
  const bass=sample(features.bass,t);
  // These envelopes come from the actual audio, not a periodic stand-in BPM.
  const beat=clamp(sample(features.onset,t)*.65+Math.max(0,bass-sample(features.bass,Math.max(0,t-.08)))*1.4);
  return {energy,bass,beat,bands:features.bands[frame]};
}
let bandDecay;
function bandsEnv(t){const f=Math.min(features.bands.length-1,Math.floor(t/features.step));return Array.from({length:13},(_,j)=>{let v=0;for(let k=0;k<=14;k++){const row=features.bands[Math.max(0,f-k)];v=Math.max(v,row[j]*bandDecay[k]);}return v;});}
const initializing=Promise.all([
  fetch(SONG.features||'audio/features.json').then(r=>{if(!r.ok)throw Error('音乐分析数据加载失败');return r.json();}),
  document.fonts.ready,media.ready,
]).then(([data])=>{
  features=data;
  bandDecay=Array.from({length:15},(_,offset)=>Math.exp(-offset*features.step/.2));
  if(usePV){pv?.fit();performance?.fit();templateLyrics?.fit();return;}
  refs.forEach(({base,copy,sung})=>{
    // Fit only long lines, using the actual restored font and glyph shaping.
    // Both text layers keep the same font size, tracking and baseline.
    const fontSize=parseFloat(getComputedStyle(base).fontSize);
    const width=Math.max(base.scrollWidth,sung.scrollWidth),available=copy.clientWidth-6;
    if(width>available)base.style.fontSize=`${fontSize*available/width}px`;
  });
});
window.render=async t=>{
  await initializing;
  const position=Math.max(0,Math.min(t,DUR-1/60));
  const exact=exactPreview||(q.has('draft')&&!isPlaying());
  const time=exact?Math.round(position*60)/60:position;
  const resync=time<previousTime||time-previousTime>.3;
  previousTime=time;
  mediaSources.splice(0,mediaSources.length,...await media.at(time,{realtime:isPlaying(),resync,exact}));
  // A pause can arrive while a correction is waiting for a decoded frame.
  if(!isPlaying())media.pause();
  const independent=Array.isArray(SONG.clips);
  const state=independent?resolveClipScene(SONG.clips,time):deckState(time),audio=musicAt(time);
  const rasterScale=workbenchPlaying&&!exact?previewScale:1;
  const width=Math.round(1920*rasterScale);
  if(bg.width!==width){bg.width=width;bg.height=Math.round(1080*rasterScale);}
  cover.style.visibility=state?'visible':'hidden';
  if(independent&&state){
    const clip=SONG.clips[state.active];cover.style.translate=`${clip.cardX}px ${clip.cardY}px`;cover.style.scale=String(clip.cardScale);
  }
  if(state)drawBackground(state.backgroundP===1?state.to:state.from);
  else {bc.clearRect(0,0,bg.width,bg.height);bc.fillStyle='#080a0e';bc.fillRect(0,0,bg.width,bg.height);}
  if(state&&state.to!==state.from&&state.backgroundP>0&&state.backgroundP<1){
    bc.globalAlpha=state.backgroundP;
    drawBackground(state.to);
    bc.globalAlpha=1;
  }
  if(state)renderDeck(time,state,audio,rasterScale);
  const accent=state?BACKGROUNDS[state.from].accent.map((a,i)=>Math.round(a+(BACKGROUNDS[state.to].accent[i]-a)*state.backgroundP)):[160,175,195];
  document.documentElement.style.setProperty('--accent',`rgb(${accent.join(',')})`);
  const {beat,energy,bass}=audio,k=window.motionIntensity;
  cover.style.transform='none';
  // The deck stays still between chorus cues; createDeck owns the drop transition.
  halo.style.opacity=state?`${.2+energy*.18+beat*.28*k}`:'0';
  halo.style.transform=`scale(${1+bass*.07*k})`;
  // Choruses lift the backdrop gently instead of reframing the layout.
  const lift=CHORUSES.reduce((v,s)=>Math.max(v,Math.min(clamp((time-s.start+.6)/1.5),clamp((s.end-time+.6)/1.5))),0);
  bg.style.filter=`saturate(${1+.03*lift}) brightness(${window.backgroundBrightness})`;
  const env=bandsEnv(time);bars.forEach((bar,j)=>{bar.style.transform=`scaleY(${.08+env[j]*.92})`;});
  const idx=Math.max(0,LYRICS.findLastIndex(line=>line.time<=time));
  const local=time-LYRICS[idx].time;
  const lineDuration=LYRICS[idx].end-LYRICS[idx].time;
  const nextShift=idx===LYRICS.length-1?0:ease(clamp((local-(lineDuration-.32))/.32));
  const visualIndex=idx+nextShift;
  const progress=clamp(local/Math.max(.1,lineDuration-.32));
  if(usePV)pv?.render(time,idx,audio,presentation==='original'&&!q.has('lyricFx')?0:k);
  else{
   lyricTrack.style.transform=`translateY(${200-visualIndex*100}px)`;
   refs.forEach(({line,sung,chars,sweep,translation},j)=>{
    const dist=Math.abs(j-visualIndex),focus=Math.max(0,1-dist);
    line.style.visibility=dist>3.1?'hidden':'visible';
    if(dist>3.1)return;
    line.style.opacity=`${Math.max(.1,1-dist*.43)}`;
    line.style.transform=`translateX(${focus*12}px) scale(${.74+.26*focus})`;
    line.style.filter='none';
    line.style.color=`rgba(248,252,251,${.7+.3*focus})`;
    translation.style.opacity=`${.65+focus*.35}`;
    line.style.setProperty('--focus',focus.toFixed(4));
    // LRC provides line timing only. This soft sweep is decorative, not word timing.
    const fill=j<idx?1:j===idx?progress:0;
    sung.style.setProperty('--reveal-solid',`${Math.max(0,fill*108-8)}%`);
    sung.style.setProperty('--reveal-edge',`${fill*108}%`);
    sung.style.opacity=focus;
    // Rhythm affects light only. Keep glyphs and translations on fixed baselines.
    chars.forEach((char,i)=>{
      const edge=fill*chars.length-i-.5;
      const glow=Math.exp(-edge*edge/3)*focus;
      char.style.setProperty('--char-glow',glow.toFixed(4));
    });
    sweep.style.transform=`scaleX(${j===idx?progress:0})`;
    sweep.style.opacity=focus*.4;
   });
  }
  const lyricIndex=LYRICS.slice(0,idx+1).filter(line=>line.kind==='lyric').length;
  document.getElementById('verseNumber').textContent=LYRICS[idx].kind==='lyric'?`${String(lyricIndex).padStart(2,'0')} — ${lyricNumber}`:LYRICS[idx].kind==='instrumental'?'INTERLUDE':LYRICS[idx].kind==='outro'?'OUTRO':LYRICS[idx].kind==='credit'?'CREDITS':'INTRO';
  document.getElementById('verseProgress').style.width=`${clamp(local/lineDuration)*100}%`;
  document.getElementById('focusMark').style.opacity=`${1-nextShift*.5}`;
  document.getElementById('lyricAura').style.opacity=`${.45+energy*.25+beat*.12}`;
  document.getElementById('sectionName').textContent=SHOTS.findLast(shot=>shot.start<=time).label;
  const treble=(env[9]+env[10]+env[11]+env[12])/4;
  renderEffects(time,{beat,bass:audio.bass,treble,progress,index:idx,k,lines});
  renderWorld(time);
  performance?.render(time,idx,audio);
  template?.render(time,audio);
  templateLyrics?.render(time,idx,audio);
  document.getElementById('progressFill').style.width=`${time/DUR*100}%`;
  document.getElementById('clock').textContent=clock(time);
};
try{
  await initializing;
  await window.render(0);window.READY=true;
}catch(e){document.body.innerHTML=`<p style="padding:40px">${escape(e.message)}，请通过本机预览链接打开。</p>`;throw e;}
