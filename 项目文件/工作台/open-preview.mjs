import {createEditorServer} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/editor.mjs';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {installVideoExport} from './video-export-route.mjs';
import {openWorkbench} from './workbench-store.mjs';
import {installWorkbench} from './workbench-route.mjs';
import {maintainStorage,recoverImports,removeManaged} from './workbench-storage.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const tools=path.resolve(root,'../素材处理工具/bin');
if(fs.existsSync(path.join(tools,'ffprobe.exe')))process.env.PATH=`${tools}${path.delimiter}${process.env.PATH||''}`;
const marker=path.join(root,'workspace','server.json');
fs.mkdirSync(path.dirname(marker),{recursive:true});
function openBrowser(url) {
  if(process.platform==='win32'&&process.env.MUSIC_WORKBENCH_OPEN==='1'){
    execFile('cmd.exe',['/d','/c','start','',url],{windowsHide:true},error=>{
      if(error)console.error(`无法自动打开浏览器，请访问 ${url}`);
    });
  }
}
if(fs.existsSync(marker)){
  const previous=JSON.parse(fs.readFileSync(marker,'utf8'));
  let running=false;
  try {process.kill(previous.pid,0);running=true;} catch(error) {if(error.code!=='ESRCH')throw error;}
  if(running){
    if(!previous.url)throw new Error('工作台正在启动，请稍后再试');
    const response=await fetch(new URL('/api/workbench',previous.url),{signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw new Error('已有工作台尚未就绪');
    console.log(`已有工作台 ${previous.url}`);openBrowser(previous.url);process.exit(0);
  }
  removeManaged(root,marker);
}
fs.writeFileSync(marker,JSON.stringify({pid:process.pid}),{flag:'wx'});
process.once('exit',()=>{try {removeManaged(root,marker);} catch {}});
const app=await createEditorServer(root,{size:'1920x1080',fps:60,quality:{workers:3,crf:13,dpr:1,subframes:1}});
if(process.env.MUSIC_WORKBENCH_PORT){
  const port=Number(process.env.MUSIC_WORKBENCH_PORT);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('MUSIC_WORKBENCH_PORT 必须是 1–65535 的端口号');
  await new Promise((resolve,reject)=>app.server.close(error=>error?reject(error):resolve()));
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
  app.url=`http://127.0.0.1:${port}/editor`;
}
const {token,session}=await (await fetch(new URL('/api/project',app.url))).json();
const workbench=openWorkbench(root,app.project,session);
try {recoverImports(root);maintainStorage(root);} catch(error) {console.error(`缓存清理未完成：${error.message}`);}
const storageTimer=setInterval(()=>{try {maintainStorage(root);} catch(error) {console.error(error.message);}},30*60*1000);
storageTimer.unref();
const stopVideoExport=await installVideoExport(app,root,workbench);
await installWorkbench(app,root,workbench,token);
const workbenchUrl=new URL('/workbench',app.url).href;
fs.writeFileSync(marker,JSON.stringify({pid:process.pid,url:workbenchUrl}));
console.log(`工作台 ${workbenchUrl}\n1080p / 60fps · 分段缓存与循环导出`);
openBrowser(workbenchUrl);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{
  await stopVideoExport();
  await app.close();
  process.exit(0);
});
