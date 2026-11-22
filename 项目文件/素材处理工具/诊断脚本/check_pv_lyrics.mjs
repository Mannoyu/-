import fs from 'node:fs';
import {serve,loadChromium,launch,openPage} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/browser.mjs';
const root='C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台';
const {server,port}=await serve(root),browser=await launch(await loadChromium(root));
try{
 const page=await openPage(browser,{port,rel:'index.html',w:1920,h:1080});
 const result=await page.evaluate(async()=>{
  const {LYRICS}=await import('./timeline.js');
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
    if(r.left<stage.left-1||r.right>stage.right+1||r.bottom>next.top-12)bounds.push({i,text:el.textContent,left:r.left,right:r.right,bottom:r.bottom,stageRight:stage.right,nextTop:next.top});
   });
   if(scene.querySelector('.pvTranslation span').textContent!==line.translation)missing.push(`translation-${i}`);
  }
  const samples=[];
  for(const t of [39.02,39.22,39.72,40.02,40.32]){
   await window.render(t);
   const active=document.querySelector('.pvScene[aria-hidden="false"]');
   samples.push({t,firstOpacity:parseFloat(active.querySelector('.pvGlyph').style.opacity),hero:active.querySelector('.pv-hero').getBoundingClientRect().top,translation:active.querySelector('.pvTranslation').getBoundingClientRect().top});
  }
  const range=values=>Math.max(...values)-Math.min(...values);
  const steady=samples.slice(2);
  return {scenes:scenes.length,missing,bounds,wrongActive,samples,stableHeroY:range(steady.map(s=>s.hero)),stableTranslationY:range(steady.map(s=>s.translation))};
 });
 const failures=[];
 if(result.missing.length)failures.push('原文或译文丢失');
 if(result.bounds.length)failures.push('文本超出PV区域或遮住下一句');
 if(result.wrongActive.length)failures.push('歌词场景激活错误');
 if(result.stableHeroY>.01||result.stableTranslationY>.01)failures.push('阅读停留期仍有纵向抖动');
 if(result.samples[1].firstOpacity<=result.samples[0].firstOpacity)failures.push('文字入场未推进');
 const report={...result,failures,passed:!failures.length};
 fs.writeFileSync(root+'/archive/qa/v12-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=failures.length?1:0;
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
