import fs from 'node:fs';
import {serve,loadChromium,launch,openPage} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/browser.mjs';
const root='C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台';
const {server,port}=await serve(root);
const browser=await launch(await loadChromium(root));
try{
 const page=await openPage(browser,{port,rel:'index.html',w:1920,h:1080});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const result=await page.evaluate(async()=>{
  const {LYRICS,FPS,CARD_CUES}=await import('./timeline.js');
  const {MEDIA}=await import('./media.js');
  const {drawCover,deckState}=await import('./deck.js');
  const hash=data=>{let h=2166136261;for(let i=0;i<data.length;i++)h=Math.imul(h^data[i],16777619);return h>>>0;};
  const scratch=document.createElement('canvas');scratch.width=1920;scratch.height=1080;
  const c=scratch.getContext('2d',{willReadFrequently:true});
  const actual=document.getElementById('background').getContext('2d',{willReadFrequently:true});
  const sampling=[];
  for(const t of [24,24+1/30,50.8,50.8+1/60,59.99,60,50.8]){
   await window.render(t);
   const state=deckState(t),meta=MEDIA[state.active];
   const frame=Math.min(meta.count-1,Math.floor((t%meta.duration)*meta.fps+1e-5));
   const image=new Image();image.src=`assets/frames/${meta.id}/${String(frame).padStart(5,'0')}.jpg`;await image.decode();
   drawCover(c,image,1920,1080);
   const a=actual.getImageData(0,0,1920,1080).data,b=c.getImageData(0,0,1920,1080).data;
   let delta=0,maxDelta=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);delta+=d;maxDelta=Math.max(maxDelta,d);}
   const meanDelta=delta/a.length;
   // GPU/CPU canvas crop paths can round an 8-bit channel by one level.
   sampling.push({t,source:meta.id,frame,hash:hash(a),meanDelta,maxDelta,matchesSource:maxDelta<=1});
  }
  const positions=[];
  for(let i=0;i<40;i++){
   const t=50+i/60;await window.render(t);
   const idx=LYRICS.findLastIndex(line=>line.time<=t),line=document.querySelectorAll('.lyricLine')[idx];
   positions.push({main:line.querySelector('.base').getBoundingClientRect().top,translation:line.querySelector('.translation').getBoundingClientRect().top,cards:[...document.querySelectorAll('.wallCard')].map(el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return {x:m.m41,y:m.m42};})});
  }
  const range=values=>Math.max(...values)-Math.min(...values);
  const cards=positions[0].cards.map((_,i)=>({xRange:range(positions.map(p=>p.cards[i].x)),yRange:range(positions.map(p=>p.cards[i].y))}));
  const overflows=[];
  for(let i=0;i<LYRICS.length;i++){
   await window.render(LYRICS[i].time+.1);
   const el=document.querySelectorAll('.lyricLine')[i],base=el.querySelector('.base').getBoundingClientRect(),copy=el.querySelector('.lyricCopy').getBoundingClientRect(),bounds=document.getElementById('lyricWindow').getBoundingClientRect();
   if(base.right>bounds.right-5||copy.height>96)overflows.push({i,right:base.right,bound:bounds.right,height:copy.height});
  }
  await window.render(39.6);
  const idx=LYRICS.findLastIndex(line=>line.time<=39.6),rows=[...document.querySelectorAll('.lyricLine')],style=getComputedStyle(rows[idx].querySelector('.base'));
  const presentation={fontSize:parseFloat(style.fontSize),fontWeight:style.fontWeight,currentOpacity:parseFloat(rows[idx].style.opacity),neighborOpacity:parseFloat(rows[idx+1].style.opacity),backgroundFilter:document.getElementById('background').style.filter};
  const transitions=CARD_CUES.map(cue=>({at:cue.at,before:deckState(cue.at-1).active,after:deckState(cue.at+.8).active,target:cue.target}));
  return {fps:FPS,sampling,cards,subtitleMainRange:range(positions.map(p=>p.main)),subtitleTranslationRange:range(positions.map(p=>p.translation)),overflows,presentation,transitions};
 });
 const failures=[];
 if(result.fps!==60)failures.push('输出时间轴不是60fps');
 if(result.sampling.some(p=>!p.matchesSource))failures.push('导出背景与指定源帧不一致');
 if(result.sampling[0].hash===result.sampling[1].hash||result.sampling[2].hash===result.sampling[3].hash)failures.push('背景相邻源帧未变化');
 if(result.sampling[2].hash!==result.sampling[6].hash)failures.push('乱序回放不一致');
 if(result.cards.some(c=>c.yRange>.001||c.xRange<.05))failures.push('卡片没有保持Y稳定并左右轻摆');
 if(result.subtitleMainRange>.001||result.subtitleTranslationRange>.001)failures.push('字幕仍上下抖动');
 if(result.overflows.length)failures.push('字幕溢出或行间重叠');
 if(result.presentation.fontSize<51||result.presentation.fontWeight!=='600'||result.presentation.currentOpacity-result.presentation.neighborOpacity<.4)failures.push('字幕层级不足');
 if(result.transitions.some(c=>c.before===c.after||c.after!==c.target))failures.push('高潮切卡失效');
 failures.push(...errors);
 const report={...result,failures,passed:failures.length===0};
 fs.writeFileSync(root+'/archive/qa/v11-check.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));process.exitCode=failures.length?1:0;
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
