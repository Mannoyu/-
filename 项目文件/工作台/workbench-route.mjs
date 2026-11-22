import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {captureWallpaper,importMedia,inspectWallpaper} from './workbench-media.mjs';
import {beginImport} from './workbench-storage.mjs';

function json(response,status,payload) {
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(payload));
}

async function body(request) {
  let bytes=0;
  const pieces=[];
  for await(const part of request){
    bytes+=part.length;
    if(bytes>1024*1024)throw new Error('草稿请求超过 1 MB');
    pieces.push(part);
  }
  return JSON.parse(Buffer.concat(pieces).toString('utf8'));
}

export async function installWorkbench(app,root,store,token) {
  const page=await readFile(new URL('./workbench.html',import.meta.url));
  const origin=new URL(app.url);
  const hosts=[origin.host,`localhost:${origin.port}`];
  const original=app.server.listeners('request')[0];
  app.server.off('request',original);
  let processing=false;
  app.server.on('request',async(request,response)=>{
    const url=new URL(request.url,origin);
    const route=url.pathname;
    if(!['/','/workbench','/api/workbench','/api/workbench/import','/api/workbench/capture','/api/workbench/wallpaper-settings'].includes(route))return original(request,response);
    if(!hosts.includes(request.headers.host)||request.headers.origin&&!hosts.some(host=>`http://${host}`===request.headers.origin)){
      return json(response,403,{error:'无效的访问来源'});
    }
    try {
      if((route==='/'||route==='/workbench')&&['GET','HEAD'].includes(request.method)){
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
        return response.end(request.method==='HEAD'?undefined:page);
      }
      if(request.method==='GET'&&route==='/api/workbench')return json(response,200,{...store.view(),token});
      if(request.method!=='POST')return json(response,405,{error:'不支持的请求'});
      if(request.headers['x-showreel-token']!==token)return json(response,403,{error:'工作台令牌无效'});
      if(route==='/api/workbench')return json(response,200,store.update(await body(request)));
      if(route==='/api/workbench/wallpaper-settings')return json(response,200,await inspectWallpaper(await body(request)));
      if(route==='/api/workbench/import'||route==='/api/workbench/capture'){
        if(processing)return json(response,409,{error:'正在准备另一份素材'});
        processing=true;
        const receipt=beginImport(root);
        const makeId=()=>receipt.track(randomUUID());
        let committed=false;
        try {
          const files=route==='/api/workbench/capture'?await captureWallpaper(root,await body(request),makeId):
            await importMedia(root,request,url.searchParams.get('kind'),(url.searchParams.get('name')||'素材').slice(0,120),makeId);
          store.addAssets(files);committed=true;
          return json(response,200,{...store.view(),imported:files});
        } finally {try {if(committed)receipt.finish();else receipt.rollback();} finally {processing=false;}}
      }
      return json(response,405,{error:'不支持的请求'});
    } catch(error) {
      if(!response.headersSent)json(response,400,{error:(error.stderr?.trim().split(/\r?\n/).at(-1)||error.message).slice(0,400)});
    }
  });
}
