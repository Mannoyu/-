import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {exportFrameCount, exportVideo} from './video-export.mjs';
import {validateSession} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/editor-model.mjs';
import {stopProcess} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/editor-media.mjs';

function json(response, status, payload) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 512 * 1024) throw new Error('请求过大');
  }
  return JSON.parse(body);
}

export async function streamResult(request,response,result) {
  const {size}=await stat(result.file);
  const range=request.headers.range;
  let start=0,end=size-1;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2])){response.writeHead(416,{'Content-Range':`bytes */${size}`});return response.end();}
    if(!match[1])start=Math.max(0,size-Number(match[2]));
    else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
    if(start>end||start>=size){response.writeHead(416,{'Content-Range':`bytes */${size}`});return response.end();}
  }
  response.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'no-store','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
  if(request.method==='HEAD')return response.end();
  const stream=createReadStream(result.file,{start,end});
  stream.on('error',()=>response.destroy());response.on('close',()=>stream.destroy());stream.pipe(response);
}

export async function installVideoExport(app, root, workbench) {
  const url = new URL(app.url);
  const editor = await (await fetch(url)).text();
  const {token} = await (await fetch(new URL('/api/project', url))).json();
  const panel = await readFile(new URL('./video-export-panel.html', import.meta.url), 'utf8');
  if (!editor.includes('</body>') || !token) throw new Error('无法加载工作区导出面板');
  const page = editor.replace('</head>', '<link rel="stylesheet" href="/project/ui-shell.css">\n</head>').replace('</body>', `${panel}\n</body>`);
  const original = app.server.listeners('request')[0];
  app.server.off('request', original);
  let job;
  let running;
  const state = () => {
    if (!job) return null;
    const muxTimes = job.progress === .88 && job.muxDuration ? [...job.log.matchAll(/^out_time_us=(\d+)/gm)] : [];
    const muxProgress = muxTimes.length ? Math.min(1, Number(muxTimes.at(-1)[1]) / 1e6 / job.muxDuration) : 0;
    return {status: job.status, phase: job.phase, progress: job.progress + .08 * muxProgress, log: job.log, error: job.error, result: job.result};
  };
  const cancel = () => {
    if (job?.status !== 'running') return;
    job.userCancelled = true;
    job.cancelled = true;
    stopProcess(job.child);
    for (const encoder of job.encoders) stopProcess(encoder);
  };

  app.server.on('request', async (request, response) => {
    const pathname = new URL(request.url, url).pathname;
    const videoFile=pathname===job?.result?.url;
    if (!videoFile&&!['/', '/editor', '/api/video-export'].includes(pathname)) return original(request, response);
    const localhost = `localhost:${url.port}`;
    if (![url.host, localhost].includes(request.headers.host) ||
        (request.headers.origin && ![url.origin, `http://${localhost}`].includes(request.headers.origin))) {
      return json(response, 403, {error: '无效的访问来源'});
    }
    if(videoFile){
      if(!['GET','HEAD'].includes(request.method))return json(response,405,{error:'不支持的请求'});
      try {return await streamResult(request,response,job.result);} catch(error) {return json(response,404,{error:'桌面上的成片已移动或删除'});}
    }
    if (pathname !== '/api/video-export') {
      if (!['GET', 'HEAD'].includes(request.method)) return original(request, response);
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
      response.end(request.method === 'HEAD' ? undefined : page);
      return;
    }
    if (request.headers['x-showreel-token'] !== token) return json(response, 403, {error: '工作区令牌无效'});
    if (request.method === 'GET') return json(response, 200, state());
    if (request.method !== 'POST') return json(response, 405, {error: '不支持的请求'});
    try {
      const input = await readBody(request);
      if(input.reveal===true){
        if(!job?.result?.file)throw new Error('尚无导出成片');
        await stat(job.result.file);
        if(process.platform==='win32')await new Promise((resolve,reject)=>execFile('explorer.exe',[`/select,${job.result.file}`],{windowsHide:true},error=>error?reject(error):resolve()));
        return json(response,200,state());
      }
      if (input.cancel === true) {
        cancel();
        return json(response, 200, state());
      }
      if (job?.status === 'running') return json(response, 409, {error: '已有视频正在导出'});
      const {project,session} = input.draftId && workbench ? workbench.exportDraft(input.draftId)
        : {project:app.project,session:validateSession(input.session,app.project)};
      exportFrameCount(project, input);
      const current = {id: randomUUID().slice(0, 12), phase: '检查素材与画面缓存', status: 'running', progress: 0, log: '', encoders: new Set()};
      job = current;
      running = exportVideo(root, project, session, {mode:input.mode,value:input.value}, current)
        .then(result => {
          Object.assign(current, {result, phase: '完成', status: 'complete', progress: 1});
        }, error => {
          Object.assign(current, {error: error.message, phase: current.userCancelled ? '已取消' : '导出失败', status: current.userCancelled ? 'cancelled' : 'failed'});
        });
      return json(response, 202, state());
    } catch (error) {
      return json(response, 400, {error: error.message});
    }
  });
  return async () => { cancel(); await running; };
}
