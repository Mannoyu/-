import fs from 'node:fs';
import assert from 'node:assert/strict';
import {serve,loadChromium,launch,openPage} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/browser.mjs';
const root='C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台';
const {server,port}=await serve(root),browser=await launch(await loadChromium(root));
try{
 const page=await openPage(browser,{port,rel:'index.html',w:1920,h:1080});
 const result=await page.evaluate(async()=>{
  const {CARD_CUES}=await import('./timeline.js');
  const {cardSourceAt,deckState}=await import('./deck.js');
  const rows=[],transitions=[];
  for(const t of [10,45,85,115,155,175,212]){
   await window.render(t);
   const state=deckState(t),cards=[...document.querySelectorAll('.wallCard')];
   const ordered=cards.map((el,i)=>({rank:(i-state.turn%4+4)%4,source:Number(el.dataset.source)})).sort((a,b)=>a.rank-b.rank).map(c=>c.source);
   rows.push({t,turn:state.turn,active:state.active,front:Number(cards.find(c=>c.style.zIndex==='10').dataset.source),ordered});
  }
  for(const cue of CARD_CUES){
   for(const t of [cue.at-.7,cue.at-.2,cue.at+.3,cue.at+.59,cue.at+.61]){
    await window.render(t);
    transitions.push({t,sources:[...document.querySelectorAll('.wallCard')].map(c=>Number(c.dataset.source))});
   }
  }
  return {rows,transitions,cues:CARD_CUES,extendedCycle:Array.from({length:16},(_,i)=>cardSourceAt(i))};
 });
 assert.deepEqual(result.rows.map(r=>r.active),[0,1,2,3,0,1,2]);
 assert.deepEqual(result.extendedCycle,[0,1,2,3,0,1,2,3,0,1,2,3,0,1,2,3]);
 for(const r of result.rows){assert.equal(r.front,r.active);assert.deepEqual(r.ordered,[0,1,2,3].map(i=>(r.turn+i)%4));}
 for(const r of result.transitions)assert.deepEqual(r.sources,[0,1,2,3]);
 fs.writeFileSync(root+'/archive/qa/v14-card-cycle.json',JSON.stringify({passed:true,...result},null,2));
 await page.evaluate(()=>window.render(115));await page.screenshot({path:root+'/archive/qa/v14-cycle.png'});
 console.log('PASS: front/background sequence 1→2→3→4→1→2→3; all four cards unique and ordered, including every transition and future cycles.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
