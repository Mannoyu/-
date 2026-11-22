from pathlib import Path
import json, shutil, subprocess
import numpy as np
import imageio_ffmpeg

ROOT = Path('C:/Users/123/Desktop/视频/音乐可视化项目')
PROJECT = ROOT / '项目文件/工作台'
AUDIO = PROJECT / 'audio'
AUDIO.mkdir(exist_ok=True)
BIN = ROOT / '项目文件/素材处理工具/bin'
BIN.mkdir(exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
shutil.copy2(FF, BIN / 'ffmpeg.exe')
shutil.copy2('C:/Users/123/.codex/skills/motion-showreel/scripts/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe', BIN / 'ffprobe.exe')
shutil.copy2(ROOT / '素材/音乐/松下優也 - Mr. Broken Heart.mp3', AUDIO / 'source.mp3')
# A separate listening copy; original supplied MP3 remains untouched.
subprocess.run([FF, '-v', 'error', '-y', '-i', str(AUDIO/'source.mp3'),
                '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,apad', '-t', '218.333333',
                '-ar', '48000', '-ac', '2', str(AUDIO/'final.wav')], check=True)
sr, hop, nfft = 22050, 441, 2048
raw = subprocess.check_output([FF, '-v', 'error', '-i', str(AUDIO/'final.wav'),
                               '-f', 'f32le', '-ac', '1', '-ar', str(sr), '-'])
y = np.frombuffer(raw, dtype='<f4')
centers = np.arange(0, len(y), hop)
yp = np.pad(y, (nfft//2, nfft))
frames = np.stack([yp[i:i+nfft] for i in centers])
rms = np.sqrt((frames*frames).mean(axis=1))
spec = np.abs(np.fft.rfft(frames*np.hanning(nfft), axis=1))
freq = np.fft.rfftfreq(nfft, 1/sr)
edges = np.geomspace(55, 12000, 14)
bands = np.stack([np.sqrt((spec[:, (freq>=a)&(freq<b)]**2).mean(axis=1))
                  for a,b in zip(edges[:-1],edges[1:])], axis=1)
bands = np.log1p(bands*2)
bands = np.clip(bands / np.maximum(np.percentile(bands, 96, axis=0), 1e-8), 0, 1)
flux = np.maximum(0, np.diff(np.log1p(spec), axis=0, prepend=np.log1p(spec[:1]))).mean(axis=1)
flux = np.clip(flux/max(np.percentile(flux, 96), 1e-8),0,1)
energy = np.clip(rms/max(np.percentile(rms, 96), 1e-8),0,1)
low = np.sqrt((spec[:,(freq>=35)&(freq<180)]**2).mean(axis=1))
low = np.clip(low/max(np.percentile(low,96),1e-8),0,1)
data = {'step':hop/sr,'duration':len(y)/sr,'source':'final.wav',
        'energy':np.round(energy,4).tolist(),'onset':np.round(flux,4).tolist(),
        'bass':np.round(low,4).tolist(),'bands':np.round(bands,4).tolist()}
(AUDIO/'features.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
summary=[]
for t in range(0,218,5):
    part=rms[int(t*sr/hop):int((t+5)*sr/hop)]
    summary.append({'start':t,'rms_db':round(float(20*np.log10(max(np.mean(part),1e-8))),2)})
(PROJECT/'qa/song-energy.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps({'duration':data['duration'],'feature_frames':len(centers),'energy_5s':summary}))
