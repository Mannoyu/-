from pathlib import Path
import struct, json, shutil

base=Path('C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/素材处理工具/scenes')
for ident in ('3461168300','3302695207'):
    source=Path('D:/SteamLibrary/steamapps/workshop/content/431960')/ident
    target=(base/ident).resolve()
    target.mkdir(parents=True,exist_ok=True)
    data=(source/'scene.pkg').read_bytes()
    pos=0
    def uint():
        global pos
        value=struct.unpack_from('<I',data,pos)[0];pos+=4
        return value
    def string():
        global pos
        n=uint();value=data[pos:pos+n].decode('utf-8');pos+=n
        return value
    assert string()=='PKGV0022'
    entries=[(string(),uint(),uint()) for _ in range(uint())]
    start=pos
    for name,offset,length in entries:
        dest=(target/name.replace('\\','/')).resolve()
        assert dest.is_relative_to(target),name
        assert start+offset+length<=len(data)
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(data[start+offset:start+offset+length])
    for name in ('project.json','preview.gif'):
        shutil.copy2(source/name,target/name)
    if (source/'shaders').exists():shutil.copytree(source/'shaders',target/'shaders',dirs_exist_ok=True)
    scene=json.loads((target/'scene.json').read_text('utf-8-sig'))
    print(ident,'unpacked',len(entries),'objects',len(scene.get('objects',[])),flush=True)
