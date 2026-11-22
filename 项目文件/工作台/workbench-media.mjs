import fs from 'node:fs/promises';
import {removeManaged} from './workbench-storage.mjs';
import path from 'node:path';
import os from 'node:os';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execute = promisify(execFile);
const ffmpeg = (args, options) => execute('ffmpeg', ['-nostdin', '-hide_banner', ...args], {windowsHide: true, timeout: 600000, ...options});

async function probe(file) {
  const result = await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {windowsHide: true, timeout: 30000});
  return JSON.parse(result.stdout);
}

function packageEntries(buffer) {
  let cursor = 0;
  function integer() {
    if (cursor + 4 > buffer.length) throw new Error('壁纸场景包目录不完整');
    const value = buffer.readUInt32LE(cursor);
    cursor += 4;
    return value;
  }
  function text() {
    const length = integer();
    if (length > 65536 || cursor + length > buffer.length) throw new Error('壁纸场景包目录不完整');
    const value = buffer.toString('utf8', cursor, cursor + length);
    cursor += length;
    return value;
  }
  if (!/^PKGV\d{4}$/.test(text())) throw new Error('无法识别此 Wallpaper 场景包');
  const count = integer();
  if (count > 50000) throw new Error('壁纸场景包目录过大');
  const entries = Array.from({length: count}, () => ({name: text(), offset: integer(), length: integer()}));
  return new Map(entries.map(({name, offset, length}) => {
    const start = cursor + offset;
    const end = start + length;
    if (end > buffer.length) throw new Error('壁纸场景包内容不完整');
    return [name.replaceAll('\\','/'),buffer.subarray(start,end)];
  }));
}

function videosIn(entries) {
  const videos = [];
  for (const [name,entry] of entries) {
    if (!/\.(tex|mp4|mov)$/i.test(name)) continue;
    const marker = entry.subarray(0, 65536).indexOf('ftyp');
    if (marker >= 4 && entry.readUInt32BE(marker - 4) >= 8) {
      videos.push({name: name.split(/[\\/]/).at(-1), data: entry.subarray(marker - 4)});
    }
  }
  return videos;
}

export function embeddedVideos(buffer) {
  return videosIn(packageEntries(buffer));
}

function textureImage(texture) {
  if (!texture || texture.toString('ascii',0,4)!=='TEXV') return;
  const header=texture.subarray(0,256);
  const block=header.indexOf('TEXB0004\0');
  if (block<0) return;
  const start=block+45;
  if (start>=texture.length) return;
  const length=texture.readUInt32LE(start-4);
  const data=texture.subarray(start,start+length);
  if(data.length!==length) return;
  if(data.subarray(0,8).toString('hex')==='89504e470d0a1a0a') return {data,extension:'png'};
  if(data.subarray(0,3).toString('hex')==='ffd8ff') return {data,extension:'jpg'};
}

async function composeBaseScene(entries, temporary) {
  const read=name=>{
    const entry=entries.get(typeof name==='string'?name.replaceAll('\\','/'):name);
    return entry ? JSON.parse(entry.toString('utf8').replace(/^\uFEFF/,'')) : undefined;
  };
  const scene=read('scene.json');
  const projection=scene?.general?.orthogonalprojection;
  if(!projection||!Array.isArray(scene.objects))return;
  const {width,height}=projection;
  if(![width,height].every(value=>Number.isInteger(value)&&value>=2&&value<=8192)||width*height>34_000_000)return;
  const vector=(value,fallback)=>typeof value==='string'?value.trim().split(/\s+/).map(Number):fallback;
  const layers=[];
  for(const object of scene.objects){
    const visible=object.visible?.value??object.visible;
    if(typeof object.image!=='string'||visible===false||object.parent)continue;
    const model=read(object.image);
    if(model?.solidlayer)continue;
    const material=read(model?.material);
    const textureName=material?.passes?.[0]?.textures?.[0];
    if(typeof textureName!=='string')continue;
    const source=textureName.replaceAll('\\','/').replace(/^materials\//,'').replace(/\.tex$/i,'');
    const image=textureImage(entries.get(`materials/${source}.tex`));
    if(!image)continue;
    const [sourceWidth,sourceHeight]=vector(object.size,[]);
    const [scaleX,scaleY]=vector(object.scale?.value??object.scale,[1,1]);
    const [originX,originY]=vector(object.origin?.value??object.origin,[width/2,height/2]);
    const layerWidth=Math.round(sourceWidth*scaleX),layerHeight=Math.round(sourceHeight*scaleY);
    if(![layerWidth,layerHeight].every(value=>Number.isInteger(value)&&value>=1&&value<=8192)||![originX,originY].every(Number.isFinite))continue;
    const x=Math.round(originX-layerWidth/2),y=Math.round(height-originY-layerHeight/2);
    const alpha=Number(object.alpha?.value??object.alpha??1);
    if(!Number.isFinite(alpha)||alpha<=0)continue;
    const file=path.join(temporary,`layer-${layers.length}.${image.extension}`);
    await fs.writeFile(file,image.data);
    layers.push({file,width:layerWidth,height:layerHeight,x,y,alpha:Math.min(1,alpha)});
    if(layers.length>=24)break;
  }
  if(!layers.length)return;
  const color=vector(scene.general.clearcolor,[0,0,0]).slice(0,3).map(value=>Math.round(Math.max(0,Math.min(1,value||0))*255).toString(16).padStart(2,'0')).join('');
  const inputs=layers.flatMap(layer=>['-i',layer.file]);
  const filters=[`[0:v]format=rgba[base0]`];
  for(const [index,layer] of layers.entries()){
    const next=index+1;
    filters.push(`[${next}:v]format=rgba,scale=${layer.width}:${layer.height},colorchannelmixer=aa=${layer.alpha}[layer${next}]`);
    filters.push(`[base${index}][layer${next}]overlay=x=${layer.x}:y=${layer.y}:format=rgb[base${next}]`);
  }
  const still=path.join(temporary,'base.png');
  await ffmpeg(['-v','error','-f','lavfi','-i',`color=c=0x${color}:s=${width}x${height}:r=1`,...inputs,
    '-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map',`[base${layers.length}]`,'-frames:v','1','-threads','1',still]);
  const video=path.join(temporary,'base.mp4');
  await ffmpeg(['-v','error','-loop','1','-framerate','30','-i',still,'-t','6','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v','libx264','-preset','ultrafast','-tune','stillimage','-crf','16','-threads','4','-pix_fmt','yuv420p',video]);
  return video;
}

async function receive(request, file) {
  let bytes = 0;
  const limit = new Transform({transform(chunk, encoding, callback) {
    bytes += chunk.length;
    callback(bytes > 512 * 1024 ** 2 ? new Error('单个素材最多 512 MB') : null, chunk);
  }});
  await pipeline(request, limit, createWriteStream(file, {flags: 'wx'}));
}

async function buildVideo(input, root, id, name, kind, {captureFps, captureDiagnostics} = {}) {
  const relative = `workspace/media/${id}`;
  const folder = path.join(root, relative);
  const info = await probe(input);
  const source = info.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (!source) throw new Error('没有找到可用的视频轨道');
  const rate = source.avg_frame_rate === '0/0' ? source.r_frame_rate : source.avg_frame_rate;
  const [numerator, denominator] = rate.split('/').map(Number);
  const sourceFps = numerator / denominator || 30;
  const fps = Math.min(60, Math.max(1, Number(sourceFps.toFixed(6))));
  let duration = Number(source.duration || info.format.duration);
  if (!Number.isFinite(duration) && kind === 'dynamic') {
    const packets = await execute('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','packet=pts_time','-of','csv=p=0',input], {windowsHide:true,timeout:30000});
    const times = packets.stdout.trim().split(/\r?\n/).map(Number).filter(Number.isFinite);
    if (times.length > 1) duration = times.at(-1) - times[0] + 1 / fps;
  }
  duration = Math.min(60, duration);
  if (!Number.isFinite(duration) || duration < .1) throw new Error('视频必须有可读取的时长且至少 0.1 秒');
  let freezeSeconds;
  if (kind === 'dynamic') {
    const diagnostics = await ffmpeg(['-i', input, '-t', String(duration), '-vf', 'freezedetect=n=-55dB:d=0.15', '-f', 'null', '-']);
    const freezes = [...diagnostics.stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map(match => Number(match[1]));
    const lastStart = [...diagnostics.stderr.matchAll(/freeze_start: ([\d.]+)/g)].at(-1);
    if (lastStart && !diagnostics.stderr.slice(lastStart.index).includes('freeze_end:')) {
      freezes.push(Math.max(0, duration - Number(lastStart[1])));
    }
    freezeSeconds = Number(freezes.reduce((total, span) => total + span, 0).toFixed(2));
  }
  await fs.mkdir(folder, {recursive: true});
  const frames = path.join(root, 'assets', 'frames', id);
  try {
    await fs.mkdir(frames, {recursive: true});
    const preview = path.join(folder, 'preview.mp4');
    const outputFps = sourceFps <= 60 && numerator && denominator ? rate : String(fps);
    if (captureFps !== undefined) {
      await fs.copyFile(input, preview);
    } else {
      await ffmpeg(['-v', 'error', '-i', input, '-map', `0:${source.index}`, '-an', '-t', String(duration), '-vf',
        `fps=${outputFps},scale=w='min(1920,iw)':h=-2`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', preview]);
    }
    await ffmpeg(['-v', 'error', '-i', preview, '-q:v', '2', '-start_number', '0', path.join(frames, '%05d.jpg')]);
    const count = (await fs.readdir(frames)).length;
    if (!count) throw new Error('背景取帧失败');
    const output = (await probe(preview)).streams[0];
    let playback;
    if(output.width>960){
      const relativePlayback=`${relative}/playback.mp4`;
      try {
        await ffmpeg(['-v','error','-i',preview,'-an','-vf','scale=960:-2','-c:v','libx264','-preset','ultrafast',
          '-crf','19','-threads','3','-pix_fmt','yuv420p','-movflags','+faststart','-g','30',path.join(root,relativePlayback)]);
        playback=relativePlayback;
      } catch {
        removeManaged(root,relativePlayback);
      }
    }
    let original;
    if (kind === 'basic') {
      original = `${relative}/original.mp4`;
      await ffmpeg(['-v','error','-i',input,'-map',`0:${source.index}`,'-c:v','copy','-an','-movflags','+faststart',path.join(root,original)]);
    }
    return {id, name, kind, fps, duration: count / fps, count, preview: `${relative}/preview.mp4`, playback, focus: .5,
      accent: [206, 220, 235], width: output.width, height: output.height, sourceWidth: source.width, sourceHeight: source.height, sourceFps, freezeSeconds, captureDiagnostics, original};
  } catch (error) {
    removeManaged(root,folder);removeManaged(root,frames);
    throw error;
  }
}

async function buildAudio(input, root, id, name) {
  const relative = `workspace/media/${id}`;
  const folder = path.join(root, relative);
  const audio = `${relative}/audio.wav`;
  const features = `${relative}/features.json`;
  await fs.mkdir(folder, {recursive: true});
  try {
    await ffmpeg(['-v', 'error', '-i', input, '-map', '0:a:0', '-vn', '-t', '3600', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', path.join(root, audio)]);
    const duration = Number((await probe(path.join(root, audio))).format.duration);
    if (!Number.isFinite(duration) || duration < .1) throw new Error('音乐长度至少 0.1 秒');
    await execute('python', [fileURLToPath(new URL('./workbench-audio.py', import.meta.url)), path.join(root, audio), path.join(root, features)], {windowsHide: true, timeout: 300000});
    return {id, name, kind: 'audio', audio, features, duration: Math.floor(duration * 60) / 60, sourceDuration: duration};
  } catch (error) {
    removeManaged(root,folder);
    throw error;
  }
}

export async function importMedia(root, request, kind, name, makeId) {
  if (!['video', 'package', 'dynamic', 'audio'].includes(kind)) throw new Error('不支持的素材类型');
  const temporary = await fs.mkdtemp(path.join(root, 'workspace', 'import-'));
  const input = path.join(temporary, 'input');
  try {
    await receive(request, input);
    if (kind === 'audio') return [await buildAudio(input, root, makeId(), name)];
    if (kind !== 'package') return [await buildVideo(input, root, makeId(), name, kind)];
    const entries = packageEntries(await fs.readFile(input));
    const candidates = videosIn(entries);
    if (!candidates.length) {
      const base=await composeBaseScene(entries,temporary);
      if(!base)throw new Error('场景包没有可提取的视频或受支持的图层。需要保留动态效果时，可用「采集动态效果」。');
      const asset=await buildVideo(base,root,makeId(),`${name} · 静态基础画面`,'basic');
      return [{...asset,staticBase:true}];
    }
    const assets = [];
    for (const candidate of candidates) {
      await fs.writeFile(`${input}.mp4`, candidate.data);
      try {
        assets.push(await buildVideo(`${input}.mp4`, root, makeId(), `${name} · ${candidate.name}`, 'basic'));
      } catch (error) {
        if (candidates.length === 1) throw error;
      }
    }
    if (!assets.length) throw new Error('场景包中的视频无法解码');
    return assets;
  } finally {
    removeManaged(root,temporary);
  }
}

async function wallpaperSource(input) {
  const folder=typeof input.folder==='string'?input.folder.trim().replace(/^"(.*)"$/,'$1'):'';
  if(!/^[a-z]:[\\/]/i.test(folder))throw new Error('请粘贴壁纸文件夹的完整本机路径');
  const resolved=await fs.realpath(folder).catch(()=>null);
  if(!resolved||!/^[a-z]:[\\/]/i.test(resolved))throw new Error('找不到本机壁纸文件夹');
  const project=path.join(resolved,'project.json');
  const info=await fs.stat(project).catch(()=>null);
  if(!info?.isFile()||info.size>1024*1024)throw new Error('请选择包含 project.json 的 Wallpaper 文件夹');
  const metadata=JSON.parse((await fs.readFile(project,'utf8')).replace(/^\uFEFF/,''));
  const type=typeof metadata?.type==='string'?metadata.type.trim().toLowerCase():'';
  if(!['scene','video'].includes(type))throw new Error('目前支持采集 Wallpaper 的场景和视频项目');
  return {resolved,project,metadata,type};
}

async function wallpaperScene(source) {
  if(source.type!=='scene')return {};
  const file=path.join(source.resolved,'scene.pkg');
  const info=await fs.stat(file).catch(()=>null);
  if(!info?.isFile()||info.size>512*1024**2)return {};
  const buffer=await fs.readFile(file);
  const entries=packageEntries(buffer);
  const scene=entries.has('scene.json')?JSON.parse(entries.get('scene.json').toString('utf8')):undefined;
  return {buffer,entries,scene};
}

function availableProperties(metadata) {
  return Object.entries(metadata.general?.properties??{}).flatMap(([key,property])=>{
    if(property?.type==='bool'&&typeof property.value==='boolean')return [{key,label:property.text||key,value:property.value}];
    if(property?.type==='combo'&&Array.isArray(property.options))return [{key,label:property.text||key,value:property.value,options:property.options}];
    return [];
  });
}

export async function inspectWallpaper(input) {
  const source=await wallpaperSource(input);
  const {scene}=await wallpaperScene(source);
  const layers=(scene?.objects??[]).flatMap(object=>{
    const kind=object.particle?'粒子':object.text?'文字':'';
    if(!kind||!Number.isSafeInteger(object.id))return [];
    return [{id:object.id,label:object.name||kind,kind,visible:(object.visible?.value??object.visible)!==false}];
  });
  return {title:source.metadata.title||path.basename(source.resolved),properties:availableProperties(source.metadata),layers};
}

function repackScene(buffer, entries) {
  const header=buffer.subarray(0,4+buffer.readUInt32LE(0));
  const count=Buffer.alloc(4);
  count.writeUInt32LE(entries.size);
  const directory=[];
  let offset=0;
  for(const [key,payload] of entries){
    const name=Buffer.from(key);
    const length=Buffer.alloc(4);
    const range=Buffer.alloc(8);
    length.writeUInt32LE(name.length);
    range.writeUInt32LE(offset);
    range.writeUInt32LE(payload.length,4);
    directory.push(length,name,range);
    offset+=payload.length;
  }
  return Buffer.concat([header,count,...directory,...entries.values()]);
}

async function prepareWallpaper(source, input, temp) {
  const settings=source.metadata.general?.properties??{};
  let changed=false;
  for(const property of availableProperties(source.metadata)){
    if(!Object.hasOwn(input.properties??{},property.key))continue;
    const value=input.properties[property.key];
    const valid=property.options?property.options.some(option=>option.value===value):typeof value==='boolean';
    if(valid&&value!==property.value){settings[property.key].value=value;changed=true;}
  }
  const hidden=new Set(Array.isArray(input.hiddenLayers)?input.hiddenLayers.filter(Number.isSafeInteger):[]);
  if(!changed&&!hidden.size)return source.project;
  const staged=path.join(temp,'wallpaper');
  await fs.cp(source.resolved,staged,{recursive:true,filter:async file=>!(await fs.lstat(file)).isSymbolicLink()});
  if(hidden.size){
    const {buffer,entries,scene}=await wallpaperScene(source);
    if(!scene)throw new Error('无法读取此壁纸的图层');
    for(const object of scene.objects){
      if(hidden.has(object.id)&&(object.particle||object.text))object.visible=false;
    }
    entries.set('scene.json',Buffer.from(JSON.stringify(scene)));
    await fs.writeFile(path.join(staged,'scene.pkg'),repackScene(buffer,entries));
  }
  const project=path.join(staged,'project.json');
  await fs.writeFile(project,JSON.stringify(source.metadata));
  return project;
}

export async function captureWallpaper(root, input, makeId) {
  if(process.platform!=='win32')throw new Error('独立窗口采集需要 Windows');
  const source=await wallpaperSource(input);
  const {resolved,metadata}=source;
  const ancestors=resolved.split(path.sep);
  const steamIndex=ancestors.findIndex(segment=>segment.toLowerCase()==='steamapps');
  const steamApps=steamIndex>=0?ancestors.slice(0,steamIndex+1).join(path.sep):null;
  const engines=[process.env.MUSIC_WALLPAPER_ENGINE,steamApps&&path.join(steamApps,'common','wallpaper_engine','wallpaper64.exe'),
    'D:/SteamLibrary/steamapps/common/wallpaper_engine/wallpaper64.exe','C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe'];
  let engine;
  for(const candidate of engines.filter(Boolean)){
    if((await fs.stat(candidate).catch(()=>null))?.isFile()){engine=candidate;break;}
  }
  if(!engine)throw new Error('找不到 Wallpaper Engine，启动时可用 MUSIC_WALLPAPER_ENGINE 指定程序路径');
  const seconds=Math.max(3,Math.min(60,Math.round(Number(input.seconds)||10)));
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'music-workbench-capture-'));
  try {
    const project=await prepareWallpaper(source,input,temp);
    const script=fileURLToPath(new URL('./workbench-capture.py',import.meta.url));
    const name=typeof metadata.title==='string'?metadata.title.slice(0,110):path.basename(resolved);
    let best;
    let attempts=0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const output=path.join(temp,`window-${attempt}.mp4`);
      const title=`MusicWorkbench-${makeId()}`;
      try {
        attempts++;
        const {stdout}=await execute('python',['-X','utf8',script,engine,project,title,String(seconds),output],{windowsHide:true,timeout:150000});
        const diagnostics=JSON.parse(await fs.readFile(`${output}.json`,'utf8'));
        const captureFps=Number(diagnostics.captureFps??stdout.trim().split(/\r?\n/).at(-1))||0;
        const score=captureFps-Math.min(2,diagnostics.maxGapSeconds||0)*20;
        if(!best||score>best.score)best={output,captureFps,diagnostics,score};
        if(captureFps>=50&&diagnostics.maxGapSeconds<.2&&!diagnostics.queueDrops)break;
      } catch (error) {
        if(!best)throw error;
        break;
      }
    }
    const captureDiagnostics={...best.diagnostics,attempts};
    const asset=await buildVideo(best.output,root,makeId(),`${name} · 动态窗口`,'dynamic',{
      captureFps:best.captureFps,captureDiagnostics,
    });
    const nearlyStatic=asset.freezeSeconds>=asset.duration*.9;
    const captureWarning=best.captureFps<50||best.diagnostics.maxGapSeconds>=.2||best.diagnostics.queueDrops>0
      ?'已保留较流畅的一次录制，但实际采集仍未稳定达到 60 帧。请先试看；减少同时运行的动态预览或降低 Wallpaper 的渲染帧率上限后可重新采集。'
      :undefined;
    return [{...asset,name:nearlyStatic?`${name} · 窗口采集（近静止）`:asset.name,
      captureFps:best.captureFps,nearlyStatic,captureWarning}];
  } finally {
    removeManaged(os.tmpdir(),temp);
  }
}
