import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
const require=createRequire('C:/Users/123/.codex/skills/motion-showreel/scripts/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
try{
 await page.goto('http://127.0.0.1:50923/project/index.html?render=1&w=1920&h=1080');
 await page.waitForFunction(()=>window.READY===true);
 const samples=[];
 for(const t of [1,1+1/30,1+2/30,3,5,7,1]){
  const frame=await page.evaluate(async t=>{
   await window.render(t);
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
   const c=canvas.getContext('2d');
   const videos=[...document.querySelectorAll('video')].map(video=>{
    c.drawImage(video,0,0,320,180);
    return {time:video.currentTime,width:video.videoWidth,height:video.videoHeight,duration:video.duration,data:[...c.getImageData(0,0,320,180).data]};
   });
   c.drawImage(document.getElementById('background'),0,0,320,180);
   return {t,videos,background:[...c.getImageData(0,0,320,180).data]};
  },t);
  const hash=data=>createHash('sha256').update(Buffer.from(data)).digest('hex').slice(0,16);
  samples.push({t,background:hash(frame.background),videos:frame.videos.map(v=>({...v,data:undefined,hash:hash(v.data)}))});
 }
 console.log(JSON.stringify(samples,null,2));
 fs.writeFileSync('C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台/archive/qa/v11-diagnosis/sampling-before.json',JSON.stringify(samples,null,2));
}finally{await browser.close();}
