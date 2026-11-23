import {normalizeElements,entranceAt} from './scene-editor-model.mjs';

// The same time-based properties run in the workbench and the export renderer.
export function createSceneElements(song){
  const settings=normalizeElements(song.elements);
  const nodes={background:document.getElementById('background'),cards:document.getElementById('coverGroup'),title:document.querySelector('#world-title strong'),artist:document.querySelector('#world-title small'),lyrics:document.querySelector('.lyrics'),progress:document.querySelector('footer'),cardGlow:document.getElementById('halo'),cardNav:document.querySelector('.deckNav'),atmosphere:document.getElementById('atmosphere'),shade:document.querySelector('.shade'),vignette:document.querySelector('.vignette')};
  document.querySelectorAll('.wallCard:not(.filmstripRowCard)').forEach((node,i)=>{nodes[`card${i}`]=node;});
  if(nodes.artist&&song.elements?.artist){if(settings.artist.fontSize)nodes.artist.style.fontSize=`${settings.artist.fontSize}px`;if(settings.artist.color){nodes.artist.style.color=settings.artist.color;nodes.artist.style.backgroundImage='none';}}
  const layers=[];
  for(const [id,node] of Object.entries(nodes)){
    if(!node)continue;
    const value=settings[id];
    const animated=!['default','none'].includes(value.animation);
    const replaceChrome=(id==='progress'||id==='atmosphere')&&value.animation!=='default';
    if(animated||replaceChrome||value.x||value.y||value.scale!==1||value.rotation||value.opacity!==1||!value.visible){
      layers.push({style:node.style,value,animated,replaceChrome});
    }
  }
  const neutral={x:0,y:0,alpha:1,scale:1};
  const restore=[];
  function override(style,key,next){
    const before=style[key];
    if(before===next)return;
    restore.push([style,key,before]);
    style[key]=next;
  }
  return {
    reset(){
      for(const [style,key,before] of restore)style[key]=before;
      restore.length=0;
    },
    render(time){
      for(const {style,value,animated,replaceChrome} of layers){
        const entry=animated?entranceAt(value,time):neutral;
        if(value.x||value.y||entry.x||entry.y){
          const [baseX,baseY]=(style.translate||'').split(/\s+/).map(parseFloat);
          override(style,'translate',`${(baseX||0)+value.x+entry.x}px ${(baseY||0)+value.y+entry.y}px`);
        }
        if(value.scale!==1||entry.scale!==1)override(style,'scale',String((parseFloat(style.scale)||1)*value.scale*entry.scale));
        if(value.rotation)override(style,'rotate',`${value.rotation}deg`);
        if(replaceChrome||value.opacity!==1||entry.alpha!==1){
          const base=replaceChrome||style.opacity===''?1:Number(style.opacity);
          override(style,'opacity',String(base*value.opacity*entry.alpha));
        }
        if(!value.visible)override(style,'display','none');
      }
    },
    nodes,
  };
}
