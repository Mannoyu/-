import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire('C:/Users/123/.codex/skills/motion-showreel/scripts/package.json');
const {chromium}=require('playwright');
const phase=process.argv.includes('--before')?'before':process.argv.includes('--deck-before')?'deck-before':'after';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.setContent('<iframe width="1920" height="1080" src="http://127.0.0.1:50923/project/index.html?render=1&w=1920&h=1080"></iframe>');
  const scene=page.frames().find(f=>f.url().includes('/project/index.html'));
  await scene.waitForFunction(()=>window.READY===true);
  const result=await scene.evaluate(async()=>{
    const {LYRICS}=await import('./timeline.js');
    const rows=[...document.querySelectorAll('.lyricLine')];
    const idx=LYRICS.findLastIndex(line=>line.time<=50);
    const row=rows[idx],positions=[],deck=document.getElementById('deck');
    for(let frame=0;frame<45;frame++){
      const t=50+frame/30;await window.render(t);
      positions.push({t,main:row.querySelector('.base').getBoundingClientRect().top,translation:row.querySelector('.translation').getBoundingClientRect().top,deck:deck.getBoundingClientRect().top,cards:[...deck.children].map(card=>card.getBoundingClientRect().top)});
    }
    const range=key=>Math.max(...positions.map(p=>p[key]))-Math.min(...positions.map(p=>p[key]));
    const boundary=LYRICS.findIndex(line=>line.time===41.35),scroll=[];
    for(let frame=0;frame<19;frame++){
      const t=41.35-.5+frame/30;await window.render(t);
      scroll.push({t,y:rows[boundary].getBoundingClientRect().top});
    }
    const scrollReversals=scroll.filter((p,i)=>i>0&&p.y>scroll[i-1].y+.1).length;
    const steadyCardRanges=[...deck.children].map((_,i)=>Math.max(...positions.map(p=>p.cards[i]))-Math.min(...positions.map(p=>p.cards[i])));
    await window.render(38.3);const release=deck.firstElementChild.getBoundingClientRect().top;
    await window.render(39.3);const fallen=deck.firstElementChild.getBoundingClientRect().top;
    await window.render(39.6);
    const current=rows[LYRICS.findLastIndex(line=>line.time<=39.6)];
    const type=getComputedStyle(current.querySelector('.base'));
    return {steadyMainRange:range('main'),steadyTranslationRange:range('translation'),steadyDeckRange:range('deck'),steadyCardRanges,cardTransitionTravel:Math.abs(fallen-release),positions,scrollReversals,
      style:{fontSize:parseFloat(type.fontSize),fontWeight:type.fontWeight,letterSpacing:parseFloat(type.letterSpacing),highlightGlyphs:current.querySelector('.sung').children.length},
      text:current.querySelector('.base').firstChild.textContent};
  });
  const failures=[];
  if(result.steadyMainRange>.05||result.steadyTranslationRange>.05)failures.push('字幕在同一句播放期间随音乐上下抖动');
  if(result.scrollReversals)failures.push('换句滚动出现反向跳动');
  if(result.steadyDeckRange>.05||result.steadyCardRanges.some(range=>range>.05))failures.push('非切卡期间卡组仍然上下移动');
  if(result.cardTransitionTravel<200)failures.push('高潮落牌切换动画丢失');
  if(result.style.fontSize<48.9||result.style.fontWeight!=='500'||result.style.letterSpacing!==1.5)failures.push('主字幕字号/字重/字距偏离已确认样式');
  if(!result.style.highlightGlyphs)failures.push('旧版柔光字符高亮层丢失');
  if(errors.length)failures.push(...errors);
  const report={phase,...result,failures,passed:failures.length===0};
  fs.writeFileSync(`C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台/archive/qa/v10-${phase}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,positions:undefined},null,2));
  process.exitCode=failures.length?1:0;
}finally{await browser.close();}
