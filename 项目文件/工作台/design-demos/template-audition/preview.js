import {mountTreatment} from './treatment.js';

const frame=document.querySelector('iframe'),audio=document.getElementById('audio');
const play=document.getElementById('play'),seek=document.getElementById('seek'),clock=document.getElementById('clock');
const screen=document.getElementById('screen'),loading=document.querySelector('.loading');
const segments={verse:[20.92,38.97],chorus:[38.97,53.67],next:[79.03,95]};
let segment='chorus',start=38.97,end=53.67,time=39.6,ready=false,initializing=false,playing=false,treatment,mode='demo';
let drawPromise=null,queued=null,raf=0;
const storageKey='music-template-audition-v1';
const clockText=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function fit(){
  const scale=Math.min(screen.clientWidth/1920,screen.clientHeight/1080);
  frame.style.transform=`scale(${scale})`;
  if(document.fullscreenElement){frame.style.left=`${(screen.clientWidth-1920*scale)/2}px`;frame.style.top=`${(screen.clientHeight-1080*scale)/2}px`;}
  else{frame.style.left='';frame.style.top='';}
}
new ResizeObserver(fit).observe(screen);
document.addEventListener('fullscreenchange',fit);
function fail(error){pause();loading.hidden=false;loading.textContent=`试听暂时无法载入：${error.message}。请刷新重试。`;}
function display(){seek.value=String(time);clock.textContent=`${clockText(time)} / ${clockText(end)}`;}
function remember(){try{localStorage.setItem(storageKey,JSON.stringify({segment,time,mode}));}catch{}}
async function draw(value){
  queued=value;
  if(!ready)return;
  if(drawPromise)return drawPromise;
  drawPromise=(async()=>{
    try{while(queued!==null){const next=queued;queued=null;await frame.contentWindow.render(next);}}
    catch(error){fail(error);throw error;}
    finally{drawPromise=null;}
  })();
  return drawPromise;
}
function pause(){playing=false;cancelAnimationFrame(raf);audio.pause();play.textContent='播放试听';remember();}
async function jump(value){time=Math.max(start,Math.min(end,value));audio.currentTime=time;display();await draw(time);remember();}
function tick(){
  if(!playing)return;
  time=audio.currentTime;
  if(time>=end){
    if(document.getElementById('loop').checked&&!window.__recording){time=start;audio.currentTime=start;}
    else{pause();jump(end-1/60);return;}
  }
  display();draw(time);raf=requestAnimationFrame(tick);
}
async function begin(){
  if(time>=end-.04)await jump(start);
  try{await audio.play();playing=true;play.textContent='暂停';tick();}
  catch(error){loading.hidden=false;loading.textContent=`音乐播放失败：${error.message}`;}
}
play.addEventListener('click',()=>playing?pause():begin());
document.getElementById('restart').addEventListener('click',async()=>{pause();await jump(start);await begin();});
seek.addEventListener('input',()=>{pause();jump(Number(seek.value));});
function setSegment(value){
  segment=value;[start,end]=segments[value];seek.min=String(start);seek.max=String(end);
  document.querySelectorAll('.segment').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.segment===value)));
}
document.querySelectorAll('.segment').forEach(button=>button.addEventListener('click',async()=>{pause();setSegment(button.dataset.segment);await jump(start+.5);}));
function setMode(value){
  mode=value;treatment.setMode(value);
  document.querySelectorAll('.variant').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===value)));
  document.getElementById('description').textContent=value==='demo'?'左侧构图与切卡沿用原版；背景柔化后退，右侧保留完整歌词、固定译文位置和低幅频谱。切换“当前模板”可对照同一时刻。':'正在查看工程当前默认的固定模板。切换“本次 Demo”可在同一时刻比较背景与歌词处理。';
  draw(time);remember();
}
document.querySelectorAll('.variant').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
document.getElementById('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await screen.requestFullscreen();}catch{}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
window.addEventListener('pagehide',remember);
audio.addEventListener('error',()=>fail(new Error('音乐加载失败')));
async function initialize(){
  if(ready||initializing)return;
  if(!frame.contentWindow?.READY||audio.readyState<1){requestAnimationFrame(initialize);return;}
  initializing=true;
  try{
    treatment=await mountTreatment(frame.contentWindow);
    try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&segments[saved.segment]){setSegment(saved.segment);time=Math.max(start,Math.min(end-.05,Number(saved.time)||start));mode=saved.mode==='original'?'original':'demo';}}catch{}
    ready=true;setMode(mode);fit();await jump(time);
    loading.hidden=true;document.querySelectorAll('button:disabled,input:disabled').forEach(element=>element.disabled=false);
    window.AUDITION_READY=true;
    window.audition={seek:jump,pause,setMode,setSegment:async value=>{pause();setSegment(value);await jump(start+.5);},state:()=>({time,segment,mode,playing}),lyrics:treatment.lyrics};
  }catch(error){fail(error);}
}
frame.addEventListener('load',initialize);
fit();initialize();
