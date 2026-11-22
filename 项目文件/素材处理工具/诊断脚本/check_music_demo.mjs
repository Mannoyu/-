import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire('C:/Users/123/.codex/skills/motion-showreel/scripts/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.setContent('<iframe width="1920" height="1080" src="http://127.0.0.1:50923/project/index.html?render=1&w=1920&h=1080"></iframe>');
  const scene=page.frames().find(frame=>frame.url().includes('/project/index.html'));
  await scene.waitForFunction(()=>window.READY===true);
  const result=await scene.evaluate(async()=>{
    const {LYRICS,CARD_CUES}=await import('./timeline.js');
    const {deckState}=await import('./deck.js');
    const overflows=[];
    for(let i=0;i<LYRICS.length;i++){
      await window.render(LYRICS[i].time+.1);
      const el=document.querySelectorAll('.lyricLine')[i];
      const base=el.querySelector('.base').getBoundingClientRect();
      const copy=el.querySelector('.lyricCopy').getBoundingClientRect();
      const windowRect=document.getElementById('lyricWindow').getBoundingClientRect();
      if(base.right>windowRect.right-5||copy.height>96)overflows.push({i,text:LYRICS[i].text,right:base.right,bound:windowRect.right,height:copy.height});
    }
    const durations=[];
    for(let frame=0;frame<45;frame++){
      const start=performance.now();await window.render(37.5+frame/30);durations.push(performance.now()-start);
    }
    const stages=[];
    for(const cue of CARD_CUES){
      for(const offset of [-1,.8]){
        const t=cue.at+offset;await window.render(t);
        stages.push({t,active:deckState(t).active,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),clock:document.getElementById('clock').textContent});
      }
    }
    return {overflows,stages,frames:durations.length,renderMeanMs:durations.reduce((a,b)=>a+b,0)/durations.length,renderMaxMs:Math.max(...durations)};
  });
  const report={...result,errors};
  fs.writeFileSync('C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台/archive/qa/music-demo-check.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
