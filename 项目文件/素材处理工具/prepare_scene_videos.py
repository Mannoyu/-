from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,json

base=Path('C:/Users/123/Desktop/视频/音乐可视化项目')
assets=base/'项目文件/工作台/assets'
ff=str(base/'项目文件/素材处理工具/bin/ffmpeg.exe')
probe=str(base/'项目文件/素材处理工具/bin/ffprobe.exe')
def run(args):subprocess.run([ff,'-v','error','-y',*args],check=True)
def prepare(name):
    source=base/f'项目文件/素材处理工具/scenes/{name}-native.mp4'
    target=assets/'sources'/f'{name}-loop.mp4'
    target.parent.mkdir(parents=True,exist_ok=True)
    # Plana's clean opening avoids a half-second native capture stall at 9.667s.
    duration=7 if name=='plana' else 20
    expected=duration*60
    graph=f'[0:v]fps=60,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,split=2[a][b];[a]trim=start=1:end={duration+1},setpts=PTS-STARTPTS[a1];[b]trim=start=0:end=1,setpts=PTS-STARTPTS[b1];[a1][b1]xfade=transition=fade:duration=1:offset={duration-1},format=yuv420p[v]'
    run(['-i',str(source),'-filter_complex_threads','1','-filter_complex',graph,'-map','[v]','-t',str(duration),'-r','60','-an','-c:v','libx264','-preset','fast','-crf','14','-threads','3','-movflags','+faststart',str(target)])
    folder=assets/'frames'/name;folder.mkdir(parents=True,exist_ok=True)
    for old in folder.glob('*.jpg'):
        if int(old.stem)>=expected:old.unlink()
    run(['-i',str(target),'-q:v','2','-threads','2','-start_number','0',str(folder/'%05d.jpg')])
    run(['-i',str(target),'-vf','scale=960:-2','-c:v','libx264','-preset','veryfast','-crf','17','-g','1','-threads','2','-an','-movflags','+faststart',str(assets/f'{name}-hq-preview.mp4')])
    count=len(list(folder.glob('*.jpg')));assert count==expected,(name,count)
    info=json.loads(subprocess.check_output([probe,'-v','error','-show_streams','-show_format','-of','json',str(target)]))
    result={'id':name,'fps':60,'duration':duration,'frames':count,'width':1920,'preview':f'{name}-hq-preview.mp4','source':f'sources/{name}-loop.mp4','render':'Wallpaper Engine native scene, Windows Graphics Capture; variable native sampling resampled to 60 fps','loopBlend':1,'stream':info['streams'][0]}
    print(name,'prepared',count,'frames',flush=True)
    return result
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(prepare,['plana','elaina']))
(assets/'scene-sources.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
manifest=assets/'frames/manifest.json'
data=json.loads(manifest.read_text('utf8'))
data=[x for x in data if x['id'] not in ('plana','elaina')]+results
manifest.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
