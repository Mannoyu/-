import fs from 'node:fs';
import {serve,loadChromium,launch} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/browser.mjs';
const root='C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台';
const {server,port}=await serve(root),browser=await launch(await loadChromium(root));
try{
 const result={};
 for(const [name,base] of [['offline',`http://127.0.0.1:${port}/`],['editor','http://127.0.0.1:59197/project/']]){
  const page=await browser.newPage();await page.goto(base+'index.html?render=1');
  result[name]=await page.evaluate(async()=>{
   const video=document.createElement('video');video.muted=true;video.preload='auto';video.src='assets/background-intra.mp4';
   await new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',reject,{once:true});});
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const c=canvas.getContext('2d');
   const result=[];
   for(const t of [1,3,5,7,1]){
    await new Promise(resolve=>{video.addEventListener('seeked',resolve,{once:true});video.currentTime=t;});
    c.drawImage(video,0,0,320,180);const a=c.getImageData(0,0,320,180).data;
    let h=2166136261;for(let i=0;i<a.length;i++)h=Math.imul(h^a[i],16777619);
    result.push({requested:t,currentTime:video.currentTime,hash:h>>>0,seekable:[video.seekable.start(0),video.seekable.end(0)]});
   }
   return result;
  });await page.close();
 }
 fs.writeFileSync(root+'/archive/qa/v11-diagnosis/media-server-comparison.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
