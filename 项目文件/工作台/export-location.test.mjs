import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {desktopDirectory,exportName} from './export-location.mjs';
import {streamResult} from './video-export-route.mjs';
import {removeManaged} from './workbench-storage.mjs';

test('desktop is an absolute existing directory and export names cannot escape it',()=>{
  const desktop=desktopDirectory();assert.ok(path.isAbsolute(desktop));assert.ok(fs.statSync(desktop).isDirectory());
  const name=exportName({title:'歌曲/../测试:视频',size:'1920x1080',fps:60},'single','abc',3);
  assert.equal(path.dirname(path.resolve(desktop,name)),desktop);
  assert.match(name,/单遍 - 1080p60 - abc\.mp4$/);
});

test('desktop video streaming handles seeking, HEAD and invalid ranges',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-export-test-'));
  const file=path.join(root,'视频.mp4');fs.writeFileSync(file,Buffer.from('0123456789'));
  const server=http.createServer((request,response)=>streamResult(request,response,{file}).catch(()=>{response.writeHead(404);response.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));removeManaged(root,file);fs.rmdirSync(root);});
  const url=`http://127.0.0.1:${server.address().port}`;
  const full=await fetch(url);assert.equal(await full.text(),'0123456789');
  const range=await fetch(url,{headers:{range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/10');assert.equal(await range.text(),'2345');
  const suffix=await fetch(url,{headers:{range:'bytes=-3'}});assert.equal(await suffix.text(),'789');
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
  assert.equal((await fetch(url,{headers:{range:'bytes=20-'}})).status,416);
});
