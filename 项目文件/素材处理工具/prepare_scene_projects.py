from pathlib import Path
import json,shutil

base=Path('C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/素材处理工具/scenes')
install=Path('D:/SteamLibrary/steamapps/common/wallpaper_engine/projects/myprojects')
for ident in ('3461168300','3302695207'):
    root=base/ident
    scene=json.loads((root/'scene.json').read_text('utf-8-sig'))
    scene['general']['cameraparallax']=False
    for obj in scene['objects']:
        if 'text' in obj or 'sound' in obj or obj.get('id') in (488,269,411,2089,398,42403,432):
            obj['visible']=False
        if 'sound' in obj:obj['volume']=0;obj['muteineditor']=True
    (root/'scene.json').write_text(json.dumps(scene,ensure_ascii=False,indent=2),encoding='utf-8')
    project=json.loads((root/'project.json').read_text('utf-8-sig'))
    project['title']='PV Source '+('Plana' if ident=='3461168300' else 'Elaina')
    for key in ('workshopid','workshopurl','approved'):project.pop(key,None)
    props=project.get('general',{}).get('properties',{})
    flags=('clock','time','week1','day1','newproperty50','newproperty46','newproperty54','newproperty59','tiao','newproperty61','qiehuan','music','shu','hrbigbmouseparallax')
    for key in flags:
        if key in props:props[key]['value']=False
    if ident=='3461168300':props['newproperty14']['value']='0'
    else:props['q']['value']='2';props['newproperty45']['value']=0
    (root/'project.json').write_text(json.dumps(project,ensure_ascii=False,indent=2),encoding='utf-8')
    target=install/('codex-pv-source-'+ident)
    assert not target.exists(),str(target)
    shutil.copytree(root,target)
    print('Staged native editor project:',target,flush=True)
