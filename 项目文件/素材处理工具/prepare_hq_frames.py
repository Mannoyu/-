from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,json
base=Path('C:/Users/123/Desktop/视频/音乐可视化项目')
root=base/'项目文件/工作台/assets'
ffmpeg=str(base/'项目文件/素材处理工具/bin/ffmpeg.exe')
jobs=[('teal','D:/SteamLibrary/steamapps/workshop/content/431960/3372718116/小死神备-恢复的 3.mp4',30,10),('violet','D:/SteamLibrary/steamapps/workshop/content/431960/3415581422/完整.mp4',60,20)]
def prepare(job):
 name,source,fps,duration=job
 folder=root/'frames'/name
 folder.mkdir(parents=True,exist_ok=True)
 subprocess.run([ffmpeg,'-v','error','-y','-i',source,'-vf','scale=1920:-2','-q:v','2','-threads','2','-start_number','0',str(folder/'%05d.jpg')],check=True)
 preview=root/f'{name}-hq-preview.mp4'
 subprocess.run([ffmpeg,'-v','error','-y','-i',source,'-vf','scale=960:-2','-c:v','libx264','-preset','veryfast','-crf','17','-g','1','-threads','2','-an','-movflags','+faststart',str(preview)],check=True)
 count=len(list(folder.glob('*.jpg')))
 assert count==fps*duration,(name,count)
 return {'id':name,'fps':fps,'duration':duration,'frames':count,'width':1920,'preview':preview.name}
with ThreadPoolExecutor(max_workers=2) as pool:
 result=list(pool.map(prepare,jobs))
(root/'frames/manifest.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2),flush=True)
