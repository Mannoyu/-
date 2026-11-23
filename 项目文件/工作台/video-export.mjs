import fs from 'node:fs/promises';
import path from 'node:path';
import {availableParallelism, freemem} from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {spawn, execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {holdStorage, maintainStorage, removeManaged} from './workbench-storage.mjs';
import {desktopDirectory,exportName} from './export-location.mjs';
import {loadChromium, launch, serve, parseSize} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/browser.mjs';
import {prepareEditorAudio, runProcess, stopProcess} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/editor-media.mjs';
import {localFile} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/editor-model.mjs';

const timeScale = 60000;
const encodeOptions = {
  h264_nvenc: ['-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '13', '-b:v', '0'],
  libx264: ['-preset', 'veryfast', '-crf', '13', '-threads', '3'],
};

export function exportFrameCount(project, settings) {
  const base = Math.round(project.duration * project.fps);
  const max = project.fps * 3600;
  if (!Number.isSafeInteger(base) || base < 1 || base > max || timeScale % project.fps !== 0) throw new Error('项目导出需在 1 帧至 1 小时之间，且使用受支持的固定帧率');
  if (settings.mode === 'single') return base;
  const count = Number(settings.value);
  if (!Number.isInteger(count) || count < 1) throw new Error('请输入正整数');
  const frames = settings.mode === 'repeat' ? base * count : settings.mode === 'minutes' ? count * 60 * project.fps : 0;
  if (!frames || frames > max) throw new Error('导出总时长最多 1 小时');
  return frames;
}

async function fingerprint(root, project, browserVersion, encoder) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([project.page, project.size, project.fps, project.duration, browserVersion, encoder, encodeOptions[encoder], project.snapshot]));
  const SONG = project.snapshot
    ? JSON.parse(await fs.readFile(path.join(root, 'workspace', 'scenes', `${project.snapshot}.json`), 'utf8'))
    : (await import(`${pathToFileURL(path.join(root, 'song-data.js'))}?v=${randomUUID()}`)).SONG;
  const sourceFiles = (await fs.readdir(root)).filter(name => (/\.(?:css|html|js)$/.test(name)||['clip-editor-model.mjs','scene-editor-model.mjs'].includes(name)) && !/^(video-export-|workbench[-.]|ui-)/.test(name)).sort();
  hash.update(await fs.readFile(new URL(import.meta.url)));
  for (const name of sourceFiles) hash.update(await fs.readFile(path.join(root, name)));
  for (const meta of new Map(SONG.videos.map(meta=>[meta.frameDir??meta.id,meta])).values()) {
    const dir = path.join(root, 'assets', 'frames', meta.frameDir ?? meta.id);
    for (let start = 0; start < meta.count; start += 96) {
      const stats = await Promise.all(Array.from({length: Math.min(96, meta.count - start)}, (_, offset) =>
        fs.stat(path.join(dir, `${String(start + offset).padStart(5, '0')}.jpg`))));
      hash.update(JSON.stringify(stats.map(stat => [stat.size, stat.mtimeMs, stat.ctimeMs])));
    }
  }
  return hash.digest('hex');
}

function encoderFor(size, fps) {
  if (process.env.MUSIC_EXPORT_ENCODER !== 'nvenc') return 'libx264';
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=s=${size}:r=${fps}`, '-frames:v', '3', '-c:v', 'h264_nvenc', ...encodeOptions.h264_nvenc, '-f', 'null', '-'], {timeout: 10000, windowsHide: true});
    return 'h264_nvenc';
  } catch {
    return 'libx264';
  }
}

function assertRunning(job) {
  if (job.cancelled) throw new Error('任务已取消');
}

function encodePart(output, fps, encoder, job) {
  const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-', '-an',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-filter_threads', '1', '-c:v', encoder, ...encodeOptions[encoder],
    '-bf', '0', '-g', String(fps * 2), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-video_track_timescale', String(timeScale), '-movie_timescale', String(timeScale), output], {stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true});
  job.encoders.add(child);
  let errorLog = '';
  child.stderr.on('data', bytes => { errorLog = (errorLog + bytes).slice(-2500); });
  child.stdin.on('error', () => {});
  const completed = once(child, 'close').then(([code]) => {
    if (code !== 0) throw new Error(errorLog || `编码器退出（${code}）`);
  }).finally(() => job.encoders.delete(child));
  completed.catch(() => {});
  return {child, completed};
}

async function verify(file, frames, project, hasAudio, job) {
  const result = await runProcess('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,nb_read_packets,duration', '-of', 'json', file], job);
  const streams = JSON.parse(result).streams;
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  const [numerator, denominator] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const {w: width, h: height} = parseSize(project.size);
  const duration = frames / project.fps;
  if (video?.width !== width || video?.height !== height || numerator / denominator !== project.fps ||
      Number(video.nb_read_packets) !== frames || Math.abs(Number(video.duration ?? Infinity) - duration) > 1 / project.fps ||
      Boolean(audio) !== hasAudio || (audio && Math.abs(Number(audio.duration ?? Infinity) - duration) > .045)) {
    throw new Error(`输出规格校验失败（${video?.nb_read_packets ?? 0}/${frames} 帧，${video?.avg_frame_rate ?? '无视频'} fps）`);
  }
}

async function renderBase(root, project, frames, job) {
  const encoder = encoderFor(project.size, project.fps);
  const browser = await launch(await loadChromium(root));
  let server;
  try {
    const browserVersion = browser.version();
    const key = await fingerprint(root, project, browserVersion, encoder);
    const cache = path.join(root, '.showreel-editor', 'video-cache', key);
    await fs.mkdir(cache, {recursive: true});
    const accessed=new Date();await fs.utimes(cache,accessed,accessed);
    const base = path.join(cache, 'picture.mp4');
    if (await fs.stat(base).catch(() => null)) {
      job.log += '已复用原尺寸 60 fps 画面缓存。\n';
      return base;
    }
    const http = await serve(root);
    server = http.server;
    const {w: width, h: height} = parseSize(project.size);
    const segmentFrames = 15 * project.fps;
    const segments = Array.from({length: Math.ceil(frames / segmentFrames)}, (_, index) => ({start: index * segmentFrames, file: `part-${index}.mp4`}));
    const pending = [];
    let rendered = 0;
    for (const segment of segments) {
      segment.count = Math.min(segmentFrames, frames - segment.start);
      if (await fs.stat(path.join(cache, segment.file)).catch(() => null)) rendered += segment.count;
      else pending.push(segment);
    }
    job.phase = '渲染画面';
    const workers = Math.min(6, Math.max(1, Math.floor(availableParallelism() / 4)), Math.max(1, Math.floor(freemem() / (1.5 * 1024 ** 3))), pending.length);
    job.log += `${encoder === 'h264_nvenc' ? 'NVIDIA 硬件编码' : 'CPU 编码'} · ${workers} 路并行\n`;
    const worker = async () => {
      const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1});
      try {
        const query = new URLSearchParams({render: '1', w: width, h: height});
        if(project.snapshot)query.set('draft',project.snapshot);
        const scene = await page.goto(`http://127.0.0.1:${http.port}/${encodeURIComponent(project.page)}?${query}`);
        if (!scene?.ok()) throw new Error('导出场景加载失败');
        await page.waitForFunction(() => window.READY === true && typeof window.render === 'function', null, {timeout: 30000});
        await page.evaluate(() => document.fonts.ready.then(() => true));
        while (pending.length) {
          assertRunning(job);
          const segment = pending.shift();
          const partial = path.join(cache, `${segment.file}.${job.id}.tmp.mp4`);
          const {child, completed} = encodePart(partial, project.fps, encoder, job);
          try {
            for (let frame = segment.start; frame < segment.start + segment.count; frame++) {
              assertRunning(job);
              await page.evaluate(async ({time, next}) => {
                await window.render(time);
                if (next !== null) window.prefetchExportFrame?.(next);
              }, {time: frame / project.fps, next: frame + 1 < segment.start + segment.count ? (frame + 1) / project.fps : null});
              const frameImage = await page.screenshot({type: 'jpeg', quality: 95, clip: {x: 0, y: 0, width, height}});
              if (!child.stdin.write(frameImage)) {
                await Promise.race([once(child.stdin, 'drain'), completed.then(() => { throw new Error('编码器提前结束'); })]);
              }
              job.progress = .08 + .78 * ++rendered / frames;
            }
            child.stdin.end();
            await completed;
            const count = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', partial], {windowsHide: true}).toString().trim();
            if (Number(count) !== segment.count) throw new Error(`片段缺帧（${count}/${segment.count}）`);
            assertRunning(job);
            await fs.rename(partial, path.join(cache, segment.file));
          } finally {
            stopProcess(child);
            await completed.catch(() => {});
            removeManaged(root,partial);
          }
        }
      } finally {
        await page.close();
      }
    };
    let failure;
    await Promise.all(Array.from({length: workers}, () => worker().catch(error => {
      failure ??= error;
      job.cancelled = true;
      for (const child of job.encoders) stopProcess(child);
    })));
    if (failure) { job.cancelled = job.userCancelled; throw failure; }
    assertRunning(job);
    if (key !== await fingerprint(root, project, browserVersion, encoder)) throw new Error('导出期间画面素材发生变化，请重试');
    const list = path.join(cache, `${job.id}.ffconcat`);
    const partial = path.join(cache, `${job.id}.tmp.mp4`);
    try {
      await fs.writeFile(list, segments.map(segment => `file '${segment.file}'\nduration ${segment.count / project.fps}\n`).join(''));
      await runProcess('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy',
        '-video_track_timescale', String(timeScale), '-movie_timescale', String(timeScale), partial], job);
      await verify(partial, frames, project, false, job);
      await fs.rename(partial, base);
      for(const segment of segments)removeManaged(root,path.join(cache,segment.file));
    } finally {
      removeManaged(root,list);
      removeManaged(root,partial);
    }
    return base;
  } finally {
    await browser.close();
    server?.close();
  }
}

export async function exportVideo(root, project, session, settings, job) {
  const release=holdStorage(root);
  try {
  const target = exportFrameCount(project, settings);
  const frames = Math.round(project.duration * project.fps);
  const duration = target / project.fps;
  const picture = await renderBase(root, project, frames, job);
  assertRunning(job);
  const audio = await prepareEditorAudio(root, project, session, job);
  if(audio.file?.startsWith('.showreel-editor/audio/')){
    const accessed=new Date();await fs.utimes(localFile(root,audio.file),accessed,accessed);
  }
  const out = settings.outputDirectory || desktopDirectory();
  await fs.mkdir(out, {recursive: true});
  const name = exportName(project,settings.mode,job.id,duration);
  const output = path.join(out,name);
  const pending = path.join(out, `.${job.id}.tmp.mp4`);
  const padded = path.join(root,'workspace', `.${job.id}.tmp.wav`);
  try {
    job.phase = '封装视频与音轨'; job.progress = .88;
    const soundArgs = [], audioFilters = [];
    if (audio.file && target <= frames) {
      soundArgs.push('-i', localFile(root, audio.file));
      audioFilters.push('-af', 'aresample=48000:osf=s16,apad');
    } else if (audio.file) {
      await runProcess('ffmpeg', ['-v', 'error', '-nostdin', '-i', localFile(root, audio.file), '-af', 'aresample=48000,apad',
        '-t', String(frames / project.fps), '-c:a', 'pcm_s16le', padded], job);
      soundArgs.push('-stream_loop', '-1', '-i', padded);
    }
    const ticks = timeScale / project.fps;
    job.muxDuration = duration;
    await runProcess('ffmpeg', ['-v', 'error', '-nostdin', '-progress', 'pipe:1', '-stats_period', '1', '-stream_loop', '-1', '-i', picture, ...soundArgs,
      '-map', '0:v:0', ...(audio.file ? ['-map', '1:a:0', ...audioFilters, '-c:a', 'aac', '-b:a', '256k'] : []),
      '-c:v', 'copy', '-bsf:v', `setts=pts=N*${ticks}:dts=N*${ticks}:duration=${ticks}`, '-t', String(duration),
      '-video_track_timescale', String(timeScale), '-movie_timescale', String(timeScale), '-moov_size', String(262144 + 64 * target), pending], job);
    job.phase = '校验分辨率、帧率与音轨'; job.progress = .97;
    await verify(pending, target, project, Boolean(audio.file), job);
    assertRunning(job);
    await fs.rename(pending, output);
    return {file:output,name,url:`/api/video-export/file/${job.id}`,duration,frames:target};
  } finally {
    removeManaged(out,pending);
    removeManaged(root,padded);
  }
  } finally {
    release();
    try {maintainStorage(root);} catch(error) {job.log+=`缓存清理未完成：${error.message}\n`;}
  }
}
