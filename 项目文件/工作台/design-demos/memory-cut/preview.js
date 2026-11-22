const frame=document.querySelector('iframe'),screen=document.getElementById('screen'),audio=document.getElementById('audio');
const play=document.getElementById('play'),seek=document.getElementById('seek'),clock=document.getElementById('clock'),loading=document.querySelector('.loading');
const segments={verse:[20.92,38.97],chorus:[38,53.67],next:[78,95]};
let segment='chorus',start=38,end=53.67,time=45.5,ready=false,playing=false,queued=null,pending=null,raf=0;
const text=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function fit(){const scale=Math.min(screen.clientWidth/1920,screen.clientHeight/1080);frame.style.transform=`scale(${scale})`;frame.style.left=document.fullscreenElement?`${(screen.clientWidth-1920*scale)/2}px`:'';frame.style.top=document.fullscreenElement?`${(screen.clientHeight-1080*scale)/2}px`:'';}
new ResizeObserver(fit).observe(screen);document.addEventListener('fullscreenchange',fit);
function remember(){try{localStorage.setItem('memory-cut-position',JSON.stringify({segment,time}));}catch{}}
function pause(){playing=false;cancelAnimationFrame(raf);audio.pause();play.textContent='播放试听';remember();}
function fail(error){pause();loading.hidden=false;loading.textContent=`载入遇到问题：${error.message}。请刷新重试。`;}
async function draw(t){queued=t;if(!ready)return;if(pending)return pending;pending=(async()=>{try{while(queued!==null){const next=queued;queued=null;await frame.contentWindow.render(next);}}catch(error){fail(error);throw error;}finally{pending=null;}})();return pending;}
async function jump(t){time=Math.max(start,Math.min(end,t));audio.currentTime=time;seek.value=String(time);clock.textContent=`${text(time)} / ${text(end)}`;await draw(time);remember();}
function tick(){if(!playing)return;time=audio.currentTime;if(time>=end){if(document.getElementById('loop').checked&&!window.__recording){time=start;audio.currentTime=start;}else{pause();jump(end-.02);return;}}seek.value=String(time);clock.textContent=`${text(time)} / ${text(end)}`;draw(time);raf=requestAnimationFrame(tick);}
async function begin(){if(time>=end-.05)await jump(start);try{await audio.play();playing=true;play.textContent='暂停';tick();}catch(error){fail(error);}}
play.addEventListener('click',()=>playing?pause():begin());document.getElementById('restart').addEventListener('click',async()=>{pause();await jump(start);begin();});seek.addEventListener('input',()=>{pause();jump(Number(seek.value));});
async function setSegment(value){pause();segment=value;[start,end]=segments[value];seek.min=String(start);seek.max=String(end);document.querySelectorAll('[data-segment]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.segment===value)));await jump(start+.6);}
document.querySelectorAll('[data-segment]').forEach(el=>el.addEventListener('click',()=>setSegment(el.dataset.segment)));
document.getElementById('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await screen.requestFullscreen();}catch{}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});audio.addEventListener('error',()=>fail(new Error('音频无法加载')));window.addEventListener('pagehide',remember);
async function init(){if(ready)return;if(!frame.contentWindow?.READY||audio.readyState<1){requestAnimationFrame(init);return;}ready=true;try{const saved=JSON.parse(localStorage.getItem('memory-cut-position'));if(saved&&segments[saved.segment]){await setSegment(saved.segment);time=Math.max(start,Math.min(end-.05,Number(saved.time)||start));}}catch{}await jump(time);loading.hidden=true;document.querySelectorAll('[disabled]').forEach(el=>el.disabled=false);window.AUDITION_READY=true;window.audition={seek:jump,pause,setSegment,state:()=>({time,playing,segment})};}
frame.addEventListener('load',init);fit();init();
