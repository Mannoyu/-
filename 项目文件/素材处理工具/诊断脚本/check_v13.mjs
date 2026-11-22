import fs from 'node:fs';
import {serve,loadChromium,launch,openPage} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/browser.mjs';
const root='C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台';
const {server,port}=await serve(root),browser=await launch(await loadChromium(root));
try{
 const page=await openPage(browser,{port,rel:'index.html',w:1920,h:1080});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const result=await page.evaluate(async()=>{
  const {LYRICS,CARD_CUES}=await import('./timeline.js');
  const {deckState}=await import('./deck.js');
  const {layoutFor}=await import('./pv-lyrics.js');
  const normalize=text=>text.replace(/\s/g,'');
  const missing=[],bounds=[],wrongActive=[];
  const scenes=[...document.querySelectorAll('.pvScene')];
  for(let i=0;i<LYRICS.length;i++){
   const line=LYRICS[i],plan=layoutFor(line.text,line.kind);
   if(normalize(plan.map(p=>p.text).join(''))!==normalize(line.text))missing.push(i);
   await window.render(line.time+.9);
   const scene=scenes[i],stage=document.querySelector('.pvStage').getBoundingClientRect(),next=scene.querySelector('.pvNext').getBoundingClientRect();
   if(document.querySelectorAll('.pvScene[aria-hidden="false"]').length!==1||scene.getAttribute('aria-hidden')!=='false')wrongActive.push(i);
   scene.querySelectorAll('.pvPart,.pvTranslation').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(r.left<stage.left-1||r.right>stage.right+1||r.bottom>next.top-12)bounds.push({i,text:el.textContent});
   });
   if(scene.querySelector('.pvTranslation span').textContent!==line.translation)missing.push(`translation-${i}`);
  }
  const samples=[];
  for(const t of [39.02,39.22,39.72,40.02,40.32]){
   await window.render(t);
   const active=document.querySelector('.pvScene[aria-hidden="false"]');
   samples.push({t,hero:active.querySelector('.pv-hero').getBoundingClientRect().top,translation:active.querySelector('.pvTranslation').getBoundingClientRect().top});
  }
  const range=values=>Math.max(...values)-Math.min(...values),steady=samples.slice(2);
  const switches=[];
  for(const t of [10,45,85,115,155,175,212]){
   await window.render(t);
   const state=deckState(t),cards=[...document.querySelectorAll('.wallCard')];
   const front=cards.find(c=>c.style.zIndex==='10');
   switches.push({t,active:state.active,front:Number(front.dataset.source),activeDots:[...document.querySelectorAll('.deckDot')].filter(c=>c.style.width==='28px').length});
  }
  const transitions=[];
  for(const cue of CARD_CUES){
   const times=[cue.at-1,cue.at-.6,cue.at-.2,cue.at+.2,cue.at+.59,cue.at+.61];
   for(const t of times){
    await window.render(t);
    transitions.push({t,active:deckState(t).active,sources:[...document.querySelectorAll('.wallCard')].map(c=>Number(c.dataset.source))});
   }
  }
  const frameHashes=[];
  const miniature=document.createElement('canvas');miniature.width=96;miniature.height=54;
  const ctx=miniature.getContext('2d');
  for(const t of [114,114.25,114.5,174,174.25,174.5]){
   await window.render(t);ctx.drawImage(document.getElementById('background'),0,0,96,54);
   const pixels=ctx.getImageData(0,0,96,54).data;
   let hash=2166136261;for(const v of pixels)hash=Math.imul(hash^v,16777619)>>>0;
   frameHashes.push({t,hash});
  }
  return {scenes:scenes.length,missing,bounds,wrongActive,switches,transitions,frameHashes,stableHeroY:range(steady.map(s=>s.hero)),stableTranslationY:range(steady.map(s=>s.translation)),copy:{eyebrow:document.getElementById('wallpaperLabel').textContent,footer:document.querySelector('footer').innerText}};
 });
 const failures=[];
 if(result.missing.length||result.bounds.length||result.wrongActive.length)failures.push('PV歌词完整性或排版回归');
 if(result.stableHeroY>.01||result.stableTranslationY>.01)failures.push('字幕阅读期纵向抖动');
 const expected=[0,1,0,2,0,3,0];
 result.switches.forEach((s,i)=>{if(s.active!==expected[i]||s.front!==s.active||s.activeDots!==1)failures.push(`场景或卡片错误:${s.t}`);});
 if(new Set(result.frameHashes.map(f=>f.hash)).size!==6)failures.push('新背景取帧没有推进');
 if(errors.length)failures.push(...errors);
 const report={...result,failures,passed:!failures.length};
 fs.writeFileSync(root+'/archive/qa/v13-check.json',JSON.stringify(report,null,2));
 for(const [id,t] of [['plana',115],['elaina',175],['transition',108.2],['base',155]]){
  await page.evaluate(t=>window.render(t),t);await page.screenshot({path:`${root}/archive/qa/v13-${id}.png`});
 }
 console.log(JSON.stringify({passed:report.passed,failures,scenes:report.scenes,switches:report.switches,stableHeroY:report.stableHeroY,stableTranslationY:report.stableTranslationY},null,2));process.exitCode=failures.length?1:0;
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
