from pathlib import Path
import subprocess, json
import numpy as np
from PIL import Image, ImageDraw

base=Path('C:/Users/123/Desktop/视频/音乐可视化项目')
ffmpeg=str(base/'项目文件/素材处理工具/bin/ffmpeg.exe')
ffprobe=str(base/'项目文件/素材处理工具/bin/ffprobe.exe')
out=base/'项目文件/工作台/archive/qa/v11-diagnosis'
out.mkdir(parents=True,exist_ok=True)
sources={
 'export':str(base/'项目文件/工作台/out/Mr. Broken Heart - 旧导入视频 - 1080p30.mp4'),
 'teal-original':'D:/SteamLibrary/steamapps/workshop/content/431960/3372718116/小死神备-恢复的 3.mp4',
 'violet-original':'D:/SteamLibrary/steamapps/workshop/content/431960/3415581422/完整.mp4',
 'teal-intra':str(base/'项目文件/工作台/assets/background-intra.mp4'),
 'violet-intra':str(base/'项目文件/工作台/assets/second-intra.mp4'),
}
report={}
sheet=Image.new('RGB',(1280,180*len(sources)),(15,21,28))
draw=ImageDraw.Draw(sheet)
for row,(name,path) in enumerate(sources.items()):
 meta=json.loads(subprocess.check_output([ffprobe,'-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,avg_frame_rate,duration,bit_rate','-of','json',path]))['streams'][0]
 frames=[]
 for col,t in enumerate([1,3,5,7]):
  raw=subprocess.check_output([ffmpeg,'-v','error','-ss',str(t),'-i',path,'-frames:v','1','-vf','scale=320:180:force_original_aspect_ratio=increase,crop=320:180','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
  frame=np.frombuffer(raw,dtype=np.uint8).reshape(180,320,3)
  frames.append(frame)
  sheet.paste(Image.fromarray(frame),(col*320,row*180))
  draw.rectangle((col*320,row*180,col*320+200,row*180+20),fill=(0,0,0))
  draw.text((col*320+5,row*180+4),f'{name} {t}s',fill='white')
 # The top-left crop excludes titles, cards and text in the export.
 regions=[f[20:120,:55].astype(float) if name=='export' else f.astype(float) for f in frames]
 report[name]={**meta,'successiveMeanAbsoluteDiff':[round(float(np.abs(b-a).mean()),4) for a,b in zip(regions,regions[1:])]}
sheet.save(out/'source-export-sheet.png')
(out/'media-motion.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
