import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

export function desktopDirectory() {
  if(process.platform==='win32')return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"],{encoding:'utf8',windowsHide:true}).replace(/^\uFEFF/,'').trim()||path.join(os.homedir(),'Desktop');
  return path.join(os.homedir(),'Desktop');
}

export function exportName(project,mode,id,duration) {
  const label=String(project.title||'音乐视频').replace(/[<>:"/\\|?*#\x00-\x1f]/g,'_').trim().slice(0,80)||'音乐视频';
  const purpose=mode==='single'?'单遍':`循环 ${Math.round(duration)}秒`;
  return `${label} - ${purpose} - ${project.size.split('x')[1]}p${project.fps} - ${id}.mp4`;
}
