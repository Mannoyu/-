import {CARD_CUES,CARD_ORDER,INTRO} from './timeline.js';
import {SONG} from './runtime-song.js';
import {normalizeElement} from './scene-editor-model.mjs';
import {createFilmstrip,FILMSTRIP_WIDTH,PREVIEW_CARD_WIDTH,PREVIEW_CARD_HEIGHT} from './filmstrip.js';
import {createGlassFilmstrip,GLASS_CARD_WIDTH,GLASS_CARD_HEIGHT,GLASS_DECK_HEIGHT} from './glass-filmstrip.js';
import {createCardGlassTitle} from './card-glass-title.js';
export const BACKGROUNDS=SONG.videos;
export const cardSourceAt=step=>CARD_ORDER[((step%CARD_ORDER.length)+CARD_ORDER.length)%CARD_ORDER.length];
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const inOut=x=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;};
const lerp=(a,b,t)=>a+(b-a)*t;
const SWAP=1.2;
const STACK=[
  {x:0,y:12,r:-3,s:1,b:1},
  {x:92,y:-18,r:8,s:.96,b:.94},
  {x:-94,y:-25,r:-10,s:.94,b:.9},
  {x:-6,y:-124,r:2.5,s:.95,b:.88},
];
// The back card lifts straight in; the side cards follow their own edges into the fan.
const ENTRY=[
  {x:-16,y:94,r:-5},
  {x:30,y:73,r:5},
  {x:-30,y:73,r:-5},
  {x:6,y:68,r:2},
];
const EXCURSIONS=[
  {x:-92,y:90,r:-7,s:.94,b:.9},
  {x:90,y:96,r:6,s:.94,b:.9},
  {x:-86,y:98,r:-8,s:.94,b:.9},
];
export function drawCover(ctx,video,w,h,focus=.5,view=null,zoom=1){
  const width=video.videoWidth||video.naturalWidth,height=video.videoHeight||video.naturalHeight;
  const scale=Math.max(w/width,h/height)*(view?1.055:1)*zoom;
  const vw=width*scale,vh=height*scale;
  // Overscan reserves crop room on every edge. Interior travel opposes the face tilt.
  const x=(w-vw)*focus-(view?.x||0)*w*.022;
  const y=(h-vh)/2-(view?.y||0)*h*.016;
  ctx.drawImage(video,Math.max(w-vw,Math.min(0,x)),Math.max(h-vh,Math.min(0,y)),vw,vh);
}
export function deckState(t){
  let turn=0;
  for(const cue of CARD_CUES){
    // The swap is centred slightly before the cue so the new card is settled on the downbeat.
    const start=cue.at-SWAP*.7,end=start+SWAP;
    if(t>=end){turn++;continue;}
    const raw=clamp((t-start)/SWAP);
    const backgroundP=smooth((raw-.15)/.7);
    const from=cardSourceAt(turn),to=cue.target;
    return {turn,raw,p:smooth(raw),backgroundP,active:backgroundP>=.5?to:from,from,to};
  }
  const active=cardSourceAt(turn);
  return {turn,raw:0,p:0,backgroundP:0,active,from:active,to:active};
}
export function introAt(time,rank,count){
  const start=INTRO.cardStart+(count-1-rank)*INTRO.cardStagger;
  const progress=clamp((time-start)/INTRO.cardTravel);
  return {
    travel:1-(1-progress)**3,
    opacity:smooth(progress/.62),
  };
}
export function createDeck(videos,{previewEject=false}={}){
  const root=document.getElementById('deck');
  const independent=Array.isArray(SONG.clips);
  const groupSettings=normalizeElement(SONG.elements?.cards,'cards');
  const glass=groupSettings.cardLayout==='glass-filmstrip';
  const count=Math.min(STACK.length,independent&&!glass?new Set(BACKGROUNDS.map(meta=>meta.id)).size:BACKGROUNDS.length);
  if(!count){root.replaceChildren();return ()=>{};}
  const useFilmstrip=groupSettings.cardLayout==='filmstrip';
  const eject=useFilmstrip&&previewEject;
  const filmstrip=glass?createGlassFilmstrip(count):useFilmstrip?createFilmstrip(count,{eject}):null;
  const frostedRim=!filmstrip&&(SONG.titlePersistent===true||SONG.lyrics[0]?.kind==='title');
  if(filmstrip){
    root.parentElement.classList.add('coverGroup--filmstrip');
    root.parentElement.style.setProperty('--filmstrip-width',`${eject?PREVIEW_CARD_WIDTH:FILMSTRIP_WIDTH}px`);
  }
  if(eject){
    root.parentElement.classList.add('coverGroup--eject');
    root.parentElement.style.setProperty('--filmstrip-card-height',`${PREVIEW_CARD_HEIGHT}px`);
  }
  if(glass){
    root.parentElement.classList.add('coverGroup--glass');
    root.parentElement.style.setProperty('--glass-card-width',`${GLASS_CARD_WIDTH}px`);
    root.parentElement.style.setProperty('--glass-card-height',`${GLASS_CARD_HEIGHT}px`);
    root.parentElement.style.setProperty('--glass-deck-height',`${count>1?GLASS_DECK_HEIGHT:GLASS_CARD_HEIGHT}px`);
  }
  root.innerHTML=Array.from({length:count},()=>`<div class="wallCard"><div class="cardSurface"><canvas></canvas><div class="cardShine" aria-hidden="true"></div><div class="cardReflection" aria-hidden="true"></div></div><div class="cardInfo"><span class="cardNumber"></span><span class="cardDiamond" aria-hidden="true"></span><span class="cardSceneName"></span><span class="cardCollection">LIVE COLLECTION</span></div></div>`).join('');
  const cards=[...root.children],contexts=cards.map(el=>el.querySelector('canvas').getContext('2d'));
  const rowCard=(eject||glass)&&count>1?cards[0].cloneNode(true):null;
  if(rowCard){
    rowCard.classList.add('filmstripRowCard');
    rowCard.setAttribute('aria-hidden','true');
    root.append(rowCard);
  }
  function addRim(card){
    const rim=document.createElement('div');
    rim.className='cardFrostedRim';
    rim.setAttribute('aria-hidden','true');
    const canvas=document.createElement('canvas');
    canvas.width=180;
    canvas.height=124;
    rim.append(canvas);
    card.prepend(rim);
    card.classList.add('wallCard--frosted');
    return canvas.getContext('2d');
  }
  const rims=frostedRim?cards.map(addRim):[];
  const rowContext=rowCard?.querySelector('.cardSurface canvas').getContext('2d');
  // The canvas and its visible aperture share the exact same ratio, including the rim inset.
  const surface=cards[0].querySelector('.cardSurface');
  const aperture={w:surface.clientWidth,h:surface.clientHeight};
  const blend=(a,b,u)=>Object.fromEntries(Object.keys(a).map(key=>[key,lerp(a[key],b[key],u)]));
  const dots=document.getElementById('deckDots');
  dots.innerHTML=BACKGROUNDS.map(()=>'<span class="deckDot"></span>').join('');
  const dotEls=[...dots.children];
  function setDot(index,selected){
    dotEls[index].style.background=selected?'var(--accent)':'#ffffff30';
    dotEls[index].style.width=selected?'28px':'12px';
  }
  dotEls.forEach((_,index)=>setDot(index,false));
  let activeDot=-1;
  root.parentElement.querySelector('.memoryRail')?.remove();
  const rail=filmstrip?null:document.createElement('div');
  if(rail){
    rail.className='memoryRail';rail.setAttribute('aria-hidden','true');
    rail.classList.toggle('memoryRail--pair',count===2);
    rail.innerHTML=BACKGROUNDS.slice(0,independent?count:BACKGROUNDS.length).map(()=>'<div class="memoryFrame"><canvas width="240" height="150"></canvas><i></i></div>').join('');
    root.parentElement.append(rail);
  }
  const thumbnails=rail?[...rail.children].map(el=>({el,ctx:el.querySelector('canvas').getContext('2d')})):[];
  const groupIntro=groupSettings.animation==='default';
  const parts=cards.map((el,index)=>{
    const settings=normalizeElement(SONG.elements?.[`card${index}`]);
    const info=el.querySelector('.cardInfo');
    const name=el.querySelector('.cardSceneName');
    if(!settings.captionVisible)info.style.display='none';
    if(settings.cardCollection!=='LIVE COLLECTION')el.querySelector('.cardCollection').textContent=settings.cardCollection;
    return {canvas:el.querySelector('.cardSurface canvas'),shine:el.querySelector('.cardShine'),info,
      number:el.querySelector('.cardNumber'),name,settings,
      glassTitle:glass&&settings.captionVisible?createCardGlassTitle(info,name):null,
      originalIntro:groupIntro&&settings.animation==='default',source:-1};
  });
  function paintFilmCard(el,ctx,source,pose,rasterScale,holdFrame=false){
    if(pose.opacity>0&&!holdFrame){
      const resolution=glass?(pose.scale>.65?1.5:.46):pose.scale>.65?2:pose.scale>.4?1:.62;
      const width=Math.round(aperture.w*resolution*rasterScale),height=Math.round(aperture.h*resolution*rasterScale);
      if(ctx.canvas.width!==width||ctx.canvas.height!==height){ctx.canvas.width=width;ctx.canvas.height=height;}
      const meta=BACKGROUNDS[source];
      if(videos[source])drawCover(ctx,videos[source],width,height,meta.focus,null,meta.zoom);
    }
    let transform=`translate(${pose.x}px,${pose.y}px) scale(${pose.scale})`;
    if(eject&&pose.roll){
      const px=PREVIEW_CARD_WIDTH/2,py=PREVIEW_CARD_HEIGHT*.75;
      const perspective=960*PREVIEW_CARD_WIDTH/498;
      transform+=` translate(${px}px,${py}px) perspective(${perspective}px) translateZ(${pose.z??0}px) rotateX(${pose.pitch??0}deg) rotateY(${pose.yaw??0}deg) rotateZ(${pose.roll}deg) scaleY(${pose.compression??1}) translate(${-px}px,${-py}px)`;
    }
    el.style.transform=transform;
    el.style.opacity=String(pose.opacity);
    el.style.zIndex=String(pose.layer);
    if(!glass)ctx.canvas.style.filter=`brightness(${pose.brightness})`;
  }
  let lastTurn=-1,lastRaw=0;
  return (t,state,rasterScale=1,{continuous=false}={})=>{
    const {turn,active}=state;
    const raw=count>1?state.raw:0;
    const excursion=EXCURSIONS[turn%EXCURSIONS.length];
    const turnover=.53;
    const railOpacity=smooth((t-4)/1.2);
    if(rail)rail.style.opacity=String(railOpacity);
    thumbnails.forEach(({el,ctx},j)=>{
      const source=state.order?.[j]??j;
      if(railOpacity>0&&videos[source])drawCover(ctx,videos[source],240,150,BACKGROUNDS[source].focus,null,BACKGROUNDS[source].zoom);
      el.classList.toggle('isActive',source===active);
    });
    cards.forEach((el,i)=>{
      const rank=(i-turn%count+count)%count;
      const source=state.order?.[rank]??cardSourceAt(turn+rank),meta=BACKGROUNDS[source];
      const part=parts[i];
      const sameSource=part.source===source;
      if(part.source!==source){
        part.source=source;
        el.style.setProperty('--card-accent',`rgb(${meta.accent.join(',')})`);
        part.number.textContent=part.settings.cardNumber||String(source+1).padStart(2,'0');
        part.name.textContent=part.settings.cardTitle||meta.cardTitle||({'teal-3499283619':'TEZCATLIPOCA',violet:'VIOLET DREAM',plana:'PLANA',elaina:'ELAINA'}[meta.id])||meta.name||'';
      }
      if(filmstrip){
        const opening=glass?part.originalIntro:part.originalIntro?i:null;
        const pose=filmstrip.cardPose(t,rank,raw,opening);
        const holdFrame=eject&&rank===0&&raw>0&&continuous&&lastTurn===turn&&lastRaw<=raw&&sameSource&&Number(el.style.opacity)>0;
        paintFilmCard(el,contexts[i],source,pose,rasterScale,holdFrame);
        part.info.style.opacity=String(pose.captionOpacity);
        if(glass){
          el.style.setProperty('--glass-caption',pose.captionOpacity);
          part.info.style.visibility=pose.captionOpacity>0?'visible':'hidden';
          if(pose.opacity>0&&pose.captionOpacity>0)part.glassTitle?.(contexts[i].canvas,aperture.w,aperture.h);
        }
        return;
      }
      let pose=STACK[rank];
      if(raw>0&&rank===0){
        pose=raw<turnover
          ?blend(pose,excursion,smooth(raw/turnover))
          :blend(excursion,STACK[count-1],inOut((raw-turnover)/(1-turnover)));
      }else if(raw>0){
        const advance=inOut((raw-.22)/.78);
        pose=blend(pose,STACK[rank-1],advance);
      }
      const intro=part.originalIntro?introAt(t,i,count):null;
      const alpha=intro?.opacity??1;
      const distance=1-(intro?.travel??1);
      const entry=ENTRY[i];
      const rotation=pose.r+distance*entry.r;
      const tilt=Math.max(-1,Math.min(1,rotation/8));
      const yaw=tilt*4,pitch=-tilt*1.6;
      if(alpha>0){
        const resolution=rank>=2?1:2;
        const rw=Math.round(aperture.w*resolution*rasterScale),rh=Math.round(aperture.h*resolution*rasterScale);
        if(contexts[i].canvas.width!==rw||contexts[i].canvas.height!==rh){contexts[i].canvas.width=rw;contexts[i].canvas.height=rh;}
        drawCover(contexts[i],videos[source],rw,rh,meta.focus,{x:tilt,y:-tilt*.4},meta.zoom);
        const rim=rims[i];
        if(rim)rim.drawImage(contexts[i].canvas,0,0,rim.canvas.width,rim.canvas.height);
      }
      el.style.transform=`translate3d(${pose.x+distance*entry.x}px,${pose.y+distance*entry.y}px,0) perspective(1400px) rotateZ(${rotation}deg) rotateY(${yaw}deg) rotateX(${pitch}deg) scale(${pose.s*(1-.06*distance)})`;
      el.style.setProperty('--edge-x',`${-tilt*2.4}px`);
      el.style.setProperty('--edge-light',`${.22+Math.abs(tilt)*.22}`);
      el.style.setProperty('--foil-x',`${50+tilt*55}%`);
      el.style.setProperty('--foil-y',`${35-tilt*24}%`);
      el.style.setProperty('--foil-angle',`${118+tilt*22}deg`);
      el.style.setProperty('--reflection',String((.1+Math.abs(tilt)*.1)*pose.b));
      el.style.opacity=alpha;
      el.style.zIndex=String(rank===0&&raw>=turnover?1:10-rank);
      parts[i].canvas.style.filter=`brightness(${pose.b}) saturate(${.68+.32*pose.b})`;
      parts[i].info.style.opacity=String(pose.b);
      el.style.boxShadow=`var(--edge-x) 2px 0 #10191e, 0 3px 7px #020a124d, 0 ${10+pose.b*12}px ${22+pose.b*18}px rgb(6 19 30 / ${.24+.2*pose.b})`;
      parts[i].shine.style.opacity=String((.08+Math.abs(tilt)*.06)*pose.b);
    });
    if(rowCard){
      rowCard.hidden=raw===0;
      if(raw>0){
        const pose=filmstrip.rowCard(raw);
        const index=(turn%count+pose.rank)%count;
        const part=parts[index];
        const source=glass&&independent?(turn+count)%BACKGROUNDS.length:
          state.order?.[pose.rank]??cardSourceAt(turn+pose.rank);
        if(!glass){
          rowCard.querySelector('.cardInfo').style.display=part.info.style.display;
          rowCard.querySelector('.cardNumber').textContent=part.number.textContent;
          rowCard.querySelector('.cardSceneName').textContent=part.name.textContent;
          rowCard.querySelector('.cardCollection').textContent=part.info.querySelector('.cardCollection').textContent;
        }
        const rowSettings=glass?parts[turn%count].settings:part.settings;
        const visiblePose={...pose,opacity:rowSettings.visible?pose.opacity*rowSettings.opacity:0};
        paintFilmCard(rowCard,rowContext,source,visiblePose,rasterScale);
      }
    }
    lastTurn=turn;
    lastRaw=raw;
    if(activeDot!==active){
      if(activeDot>=0)setDot(activeDot,false);
      setDot(active,true);
      activeDot=active;
    }
  };
}
