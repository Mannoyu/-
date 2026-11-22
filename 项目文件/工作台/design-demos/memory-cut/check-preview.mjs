import {loadChromium,launch} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/browser.mjs';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('.',import.meta.url));
const browser=await launch(await loadChromium());
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1560,height:1080},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]);
 await page.waitForFunction(()=>window.AUDITION_READY===true,null,{timeout:90000});
 for(const [segment,time,name] of [['chorus',46,'chorus'],['chorus',40,'goodbye'],['verse',24.8,'verse'],['next',81,'next']]){
  await page.evaluate(async({segment,time})=>{await window.audition.setSegment(segment);await window.audition.seek(time);},{segment,time});
  await page.locator('#screen').screenshot({path:output+name+'.png'});
 }
 const geometry=await page.evaluate(()=>{
  const doc=document.querySelector('iframe').contentDocument;
  return [...doc.querySelectorAll('.lyric')].map((article,index)=>{
   const headline=article.querySelector('.headline');
   const translation=article.querySelector('.translation');
   const box=article.getBoundingClientRect();
   const headlineBottom=headline?.getBoundingClientRect().bottom;
   const translationTop=translation?.getBoundingClientRect().top;
   const overlap=headline&&translation&&headlineBottom>translationTop;
   return {index,headlineBottom,translationTop,okay:!overlap&&box.top>=140&&box.right<=1840&&box.bottom<=1020};
  });
 });
 await page.click('[data-segment="chorus"]');
 const cut=await page.evaluate(async()=>{
  const scene=()=>document.querySelector('iframe').contentWindow.SCENE_STATE.active;
  await window.audition.seek(38.9);
  const before=scene();
  await window.audition.seek(39.05);
  return [before,scene()];
 });
 await page.evaluate(()=>window.audition.seek(38.55));
 await page.click('#play');await page.waitForFunction(()=>document.querySelector('#audio').currentTime>40,null,{timeout:10000});await page.click('#play');
 const playback=await page.evaluate(()=>({audio:document.querySelector('#audio').currentTime,readyState:document.querySelector('#audio').readyState,scene:document.querySelector('iframe').contentWindow.SCENE_STATE}));
 await page.evaluate(()=>window.audition.seek(46));
 const getState=()=>page.evaluate(()=>{const d=document.querySelector('iframe').contentDocument,a=d.querySelector('.lyric[aria-hidden="false"]');return {transform:a.querySelector('.headline').style.transform,opacity:a.style.opacity,image:d.querySelector('#image').toDataURL()};});
 const a=await getState();await page.evaluate(async()=>{await window.audition.seek(41);await window.audition.seek(46);});const b=await getState();
 const deterministic=JSON.stringify(a)===JSON.stringify(b);
 await page.setViewportSize({width:430,height:940});const mobile=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
 await page.screenshot({path:output+'mobile.png'});
 const result={errors,geometry,cut,playback,deterministic,mobile};await writeFile(output+'check-results.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,geometry:geometry.filter(row=>!row.okay)}));
 if(errors.length||geometry.some(row=>!row.okay)||cut[0]!==0||cut[1]!==1||!deterministic||mobile.scroll>mobile.width)process.exitCode=1;
}finally{await browser.close();}
