import fs from 'node:fs';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {SONG} from './song-data.js';
import {removeImportedFiles, removeManaged, storageBusy, maintainStorage} from './workbench-storage.mjs';
import {initialSession} from 'file:///C:/Users/123/.codex/skills/motion-showreel/scripts/lib/editor-model.mjs';
import {normalizeClips} from './clip-editor-model.mjs';

const defaultLayout = {cardX:0, cardY:0, cardScale:1, lyricX:0, lyricY:0, lyricScale:1};
const baseline = {id:'original', name:'模板 01', layout:defaultLayout, lyricStyle:{}};
const builtin = SONG.videos.map(video=>({...video,kind:'builtin'}));
const copy = structuredClone;
const hash = value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const number = (value,min,max,fallback)=>Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;
const text = (value,fallback='',limit=300)=>typeof value==='string'?value.slice(0,limit):fallback;

function layout(value) {
  return Object.fromEntries(Object.entries(defaultLayout).map(([key,fallback])=>[
    key,key.endsWith('Scale')?number(value?.[key],.5,1.5,fallback):number(value?.[key],-500,500,fallback),
  ]));
}

function style(value) {
  return {
    fontSize:number(value?.fontSize,22,130,0),
    effect:['default','fade','rise'].includes(value?.effect)?value.effect:'default',
    align:['left','center','right'].includes(value?.align)?value.align:undefined,
    emphasis:Array.isArray(value?.emphasis)?value.emphasis.slice(0,12).map(word=>text(word)).filter(Boolean):undefined,
  };
}

export function openWorkbench(root, originalProject, originalSession) {
  const folder = path.join(root,'workspace');
  const stateFile = path.join(folder,'state.json');
  fs.mkdirSync(path.join(folder,'scenes'),{recursive:true});
  function write(file,value) {
    const temporary=`${file}.${randomUUID()}.tmp`;
    try {fs.writeFileSync(temporary,JSON.stringify(value));fs.renameSync(temporary,file);}
    finally {removeManaged(root,temporary);}
  }
  function fresh() {
    return {id:randomUUID(), name:SONG.title, title:SONG.title, artist:SONG.artist, audioId:'original', templateId:baseline.id,
      updatedAt:new Date().toISOString(), layout:copy(defaultLayout), lyricStyle:{}, lyrics:copy(SONG.lyrics), cues:[...SONG.cues],
      backgrounds:builtin.map(video=>({assetId:video.id,focus:.5,zoom:1,start:0,end:video.duration})), export:{mode:'single',value:1}};
  }
  let state;
  if(fs.existsSync(stateFile)) state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  else {
    const first=fresh();
    state={active:first.id,drafts:[first],templates:[copy(baseline)],media:[]};
    write(stateFile,state);
  }
  const assets=()=>[...builtin,...state.media.filter(asset=>!asset.removedAt)].map(asset=>{
    const name=Object.hasOwn(state.assetNames??{},asset.id)?state.assetNames[asset.id]:undefined;
    return name?{...asset,name,cardTitle:name}:asset;
  });
  const refresh=()=>{state=JSON.parse(fs.readFileSync(stateFile,'utf8'));};
  const references=(draft,assetId)=>(Array.isArray(draft.clips)?draft.clips:draft.backgrounds??[]).some(slot=>slot.assetId===assetId);
  const uses=assetId=>state.drafts.filter(draft=>draft.audioId===assetId||references(draft,assetId));
  const findAsset=id=>assets().find(asset=>asset.id===id);
  const findDraft=id=>state.drafts.find(draft=>draft.id===id);
  const durationOf=draft=>findAsset(draft.audioId)?.duration||SONG.duration;
  function normalize(input,previous) {
    const audioId=findAsset(input.audioId)?.kind==='audio'?input.audioId:'original';
    const duration=durationOf({audioId});
    const lines=Array.isArray(input.lyrics)?input.lyrics.slice(0,1500):previous.lyrics;
    const lyrics=lines.map(line=>({time:number(line.time,0,3600,0),text:text(line.text),translation:text(line.translation),
      kind:['intro','credit','lyric','instrumental','outro'].includes(line.kind)?line.kind:'lyric',style:style(line.style),
      end:number(line.end,0,3600,duration)})).sort((first,second)=>first.time-second.time);
    for(const [index,line] of lyrics.entries())line.end=Math.min(lyrics[index+1]?.time??3600,Math.max(line.time+.02,line.end));
    const slots=input.backgrounds?.length===2?previous.backgrounds.slice(0,2):previous.backgrounds;
    const backgrounds=slots.map((before,index)=>{
      const selected=input.backgrounds?.[index]||before;
      const asset=findAsset(selected.assetId);
      if(!asset||asset.kind==='audio')return before;
      const minimum=1/asset.fps;
      const start=number(selected.start,0,asset.duration-minimum,0);
      return {assetId:asset.id,focus:number(selected.focus,0,1,.5),zoom:number(selected.zoom,1,3,1),start,
        end:number(selected.end,start+minimum,asset.duration,asset.duration)};
    });
    const cues=Array.isArray(input.cues)?[...new Set(input.cues.filter(cue=>Number.isFinite(cue)&&cue>0&&cue<duration))].sort((first,second)=>first-second).slice(0,100):previous.cues;
    return {...previous,name:text(input.name,previous.name,100).trim()||previous.name,title:text(input.title,previous.title,100),artist:text(input.artist,previous.artist,100),
      updatedAt:new Date().toISOString(),audioId,lyrics,backgrounds,cues,...(Object.hasOwn(input,'clips')?{clips:normalizeClips(input.clips,findAsset)}:{}),layout:layout(input.layout),lyricStyle:style(input.lyricStyle),
      showSongTitle:typeof input.showSongTitle==='boolean'?input.showSongTitle:previous.showSongTitle,
      templateId:state.templates.some(template=>template.id===input.templateId)?input.templateId:baseline.id,
      export:{mode:['single','repeat','minutes'].includes(input.export?.mode)?input.export.mode:'single',value:Math.round(number(input.export?.value,1,3600,1))}};
  }
  function scene(draft) {
    const duration=durationOf(draft);
    const audio=findAsset(draft.audioId);
    const independent=Array.isArray(draft.clips);
    const videos=independent?draft.clips.map(clip=>({...findAsset(clip.assetId),focus:clip.focus,cropFocus:clip.focus,zoom:clip.zoom})):draft.backgrounds.map(slot=>{
      const media=findAsset(slot.assetId);
      const trimmed=slot.start>0||slot.end<media.duration;
      return {...media,...(slot.focus!==.5?{cropFocus:slot.focus,focus:slot.focus}:{}),...(slot.zoom!==1?{zoom:slot.zoom}:{}),
        ...(trimmed?{trimStart:slot.start,trimEnd:slot.end}:{})};
    });
    const visibleLyrics=draft.lyrics.filter(line=>line.time<duration).map(line=>({...line,end:Math.min(line.end,duration)}));
    const firstLine=visibleLyrics[0];
    const opening={time:0,end:firstLine?.time??duration,text:draft.title,translation:draft.artist,kind:'intro'};
    const lyrics=draft.showSongTitle?[{...opening,end:duration,text:draft.title||draft.name,kind:'title'}]:
      firstLine?.time===0?visibleLyrics:[opening,...visibleLyrics];
    return {...SONG,title:draft.title||draft.name,artist:draft.artist,duration,videos,lyrics,cues:draft.cues,
      audio:audio?.audio||SONG.audio,features:audio?.features,sections:audio?[]:SONG.sections,
      ...(independent?{clips:draft.clips}:{}),layout:draft.layout,lyricStyle:draft.lyricStyle,subtitle:audio?'':SONG.subtitle,tagline:audio?'':SONG.tagline,emphasis:audio?[]:SONG.emphasis};
  }
  function snapshot(draft) {
    const data=scene(draft);
    const key=hash(data);
    const file=path.join(folder,'scenes',`${key}.json`);
    if(!fs.existsSync(file))write(file,data);
    else {const now=new Date();fs.utimesSync(file,now,now);}
    return {key,data};
  }
  function view() {
    refresh();
    const draft=findDraft(state.active);
    const {key,data}=snapshot(draft);
    const assetUsage=Object.fromEntries(state.media.filter(asset=>!asset.removedAt).map(asset=>[asset.id,uses(asset.id).map(item=>item.name)]));
    const removedAssets=state.media.filter(asset=>asset.removedAt).map(({id,name})=>({id,name}));
    return {draft, drafts:state.drafts.map(({id,name,updatedAt})=>({id,name,updatedAt})),templates:state.templates,assets:assets(),assetUsage,removedAssets,key,duration:data.duration,audio:data.audio};
  }
  return {
    view,
    addAssets(imported) {
      refresh();
      const next={...state,media:[...state.media,...imported]};
      write(stateFile,next);state=next;
    },
    update(input) {
      refresh();
      const draft=findDraft(input.id||state.active);
      if(!draft)throw new Error('找不到草稿');
      if(input.action==='open')state.active=draft.id;
      else if(input.action==='new'){
        const next={...copy(draft),id:randomUUID(),name:text(input.name,`${draft.name} · 副本`,100).trim()||`${draft.name} · 副本`,updatedAt:new Date().toISOString()};
        state.drafts.unshift(next);state.active=next.id;
      }else if(input.action==='save'){
        const next=normalize(input.draft,draft);
        if(!Array.isArray(draft.clips)&&Array.isArray(next.clips)){
          const backup=path.join(folder,'before-clip-editor.json');
          if(!fs.existsSync(backup))write(backup,state);
        }
        state.drafts[state.drafts.indexOf(draft)]=next;
      }else if(input.action==='asset-rename'){
        const asset=findAsset(input.assetId);
        if(!asset||asset.kind==='audio')throw new Error('找不到可重命名的背景素材');
        const name=text(input.name,'',120).trim();
        if(!name)throw new Error('请输入背景素材名称');
        state.assetNames={...state.assetNames,[asset.id]:name};
      }else if(input.action==='storage-clean'){
        const cleanup=maintainStorage(root,{clearCaches:true});
        if(cleanup.busy)throw new Error('请等待视频导出结束后再清理');
        return {...view(),cleanup};
      }else if(['asset-remove','asset-restore','asset-delete'].includes(input.action)){
        const asset=state.media.find(item=>item.id===input.assetId);
        if(!asset)throw new Error('只能管理自己导入的素材');
        if(input.action!=='asset-restore'){
          const drafts=uses(asset.id);
          if(drafts.length)throw new Error(`请先在这些草稿中替换素材：${drafts.map(item=>item.name).join('、')}`);
          const templates=state.templates.filter(template=>references(template,asset.id));
          if(templates.length)throw new Error(`素材正在被这些模板使用：${templates.map(item=>item.name).join('、')}`);
          if(input.action==='asset-delete'){
            if(!asset.removedAt)throw new Error('请先移除素材，再永久删除');
            if(storageBusy(root))throw new Error('请等待视频导出结束后再删除素材');
            // Keep the record until all files are gone so a failed deletion can be retried.
            removeImportedFiles(root,asset.id);
            const next=copy(state);
            next.media=next.media.filter(item=>item.id!==asset.id);
            delete next.assetNames?.[asset.id];
            write(stateFile,next);state=next;
            return view();
          }
          asset.removedAt=new Date().toISOString();
        }else delete asset.removedAt;
      }else if(input.action==='template-save'||input.action==='template-update'){
        const name=text(input.name,'',100).trim();
        if(!name)throw new Error('请输入模板名称');
        const current=input.action==='template-update'?state.templates.findIndex(template=>template.id===input.templateId&&template.id!==baseline.id):-1;
        if(input.action==='template-update'&&current<0)throw new Error('找不到可更新的模板');
        const next={id:state.templates[current]?.id??randomUUID(),name,layout:copy(draft.layout),lyricStyle:copy(draft.lyricStyle),showSongTitle:draft.showSongTitle};
        if(input.includeBackgrounds===true){next.backgrounds=copy(draft.backgrounds);if(Array.isArray(draft.clips))next.clips=copy(draft.clips);}
        if(current<0)state.templates.push(next);
        else state.templates[current]=next;
        draft.templateId=next.id;
      }else if(input.action==='template-apply'||input.action==='template-preview'){
        const template=state.templates.find(item=>item.id===input.templateId);
        if(!template)throw new Error('找不到模板');
        const next={...draft,templateId:template.id,layout:copy(template.layout),lyricStyle:copy(template.lyricStyle),showSongTitle:template.showSongTitle===true};
        if(template.backgrounds){next.backgrounds=copy(template.backgrounds);delete next.clips;}
        if(Array.isArray(template.clips))next.clips=copy(template.clips);
        if(input.action==='template-preview')return {key:snapshot(next).key};
        state.drafts[state.drafts.indexOf(draft)]={...next,updatedAt:new Date().toISOString()};
      }else throw new Error('不支持的草稿操作');
      write(stateFile,state);
      return view();
    },
    exportDraft(id) {
      refresh();
      const draft=findDraft(id);
      if(!draft)throw new Error('找不到导出草稿');
      const {key,data}=snapshot(draft);
      const audio=findAsset(draft.audioId);
      const project={...originalProject,title:data.title,snapshot:key,duration:data.duration};
      if(!audio)return {project,session:originalSession};
      const track={id:'song',kind:'mix',name:data.title,file:data.audio,sourceDuration:audio.sourceDuration,gain:1,mute:false,
        clips:[{id:'song-1',start:0,in:0,duration:data.duration,gain:1,fadeIn:0,fadeOut:0}]};
      Object.assign(project,{tracks:[track],originalAudio:data.audio,intervals:[],sourceSignature:hash(track)});
      return {project,session:initialSession(project)};
    },
  };
}
