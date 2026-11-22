from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess
import imageio_ffmpeg

root=Path('C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台/assets')
sources=[
 ('D:/SteamLibrary/steamapps/workshop/content/431960/3372718116/小死神备-恢复的 3.mp4','background-intra.mp4'),
 ('D:/SteamLibrary/steamapps/workshop/content/431960/3415581422/完整.mp4','second-intra.mp4'),
]
def encode(item):
    source,name=item
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-i',source,
      '-t','10','-vf','fps=30,scale=1600:-2','-c:v','libx264','-preset','veryfast',
      '-crf','19','-g','1','-pix_fmt','yuv420p','-threads','2','-an','-movflags','+faststart',str(root/name)],check=True)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-i',str(root/name),
      '-vf','scale=960:-2','-c:v','libx264','-preset','veryfast','-crf','19','-g','1',
      '-pix_fmt','yuv420p','-threads','2','-an','-movflags','+faststart',str(root/name.replace('-intra','-preview'))],check=True)
    return {'name':name,'bytes':(root/name).stat().st_size}
with ThreadPoolExecutor(max_workers=2) as executor:
    for result in executor.map(encode,sources):print(result,flush=True)
