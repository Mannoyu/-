import {CARD_CUES,CARD_ORDER,INTRO} from './timeline.js';
import {SONG} from './runtime-song.js';
export const BACKGROUNDS=SONG.videos;
export const cardSourceAt=step=>CARD_ORDER[((step%CARD_ORDER.length)+CARD_ORDER.length)%CARD_ORDER.length];
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const inOut=x=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;};
const lerp=(a,b,t)=>a+(b-a)*t;
const SWAP=1.2;
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
// Intro progress for each rank: back cards land first, the front card last.
export function introAt(t,rank){
  const landing=INTRO.landings[Math.min(rank,2)];
  return smooth((t-landing+INTRO.fly)/INTRO.fly);
}
export function createDeck(videos){
  const root=document.getElementById('deck');
  // Slot 3 sits exactly behind slot 2, so the card waiting there is never visible.
  const independent=Array.isArray(SONG.clips);
  const count=independent?Math.min(4,new Set(BACKGROUNDS.map(meta=>meta.id)).size):BACKGROUNDS.length;
  if(!count){root.replaceChildren();return ()=>{};}
  const frostedRim=SONG.lyrics[0]?.kind==='title';
  root.innerHTML=Array.from({length:count},()=>`<div class="wallCard"><div class="cardSurface"><canvas></canvas><div class="cardShine" aria-hidden="true"></div><div class="cardReflection" aria-hidden="true"></div></div><div class="cardInfo"><span class="cardNumber"></span><span class="cardDiamond" aria-hidden="true"></span><span class="cardSceneName"></span><span class="cardCollection">LIVE COLLECTION</span></div></div>`).join('');
  const cards=[...root.children],contexts=cards.map(el=>el.querySelector('canvas').getContext('2d'));
  const rims=frostedRim?cards.map(card=>{
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
  }):[];
  // The canvas and its visible aperture share the exact same ratio, including the rim inset.
  const surface=cards[0].querySelector('.cardSurface');
  const aperture={w:surface.clientWidth,h:surface.clientHeight};
  const layouts=[
    [{x:0,y:0,r:-4,s:1,b:1},{x:45,y:-22,r:9,s:.96,b:.86},{x:-35,y:-32,r:-12,s:.92,b:.72}],
    [{x:0,y:0,r:-4,s:1,b:1},{x:45,y:-22,r:9,s:.96,b:.86},{x:-35,y:-32,r:-12,s:.92,b:.72}],
    [{x:0,y:0,r:-4,s:1,b:1},{x:45,y:-22,r:9,s:.96,b:.86},{x:-35,y:-32,r:-12,s:.92,b:.72}],
  ].map(slots=>[...slots,{...slots[2]}]);
  const excursions=[{x:-145,y:-30,r:-13,s:.91,b:.85},{x:18,y:-120,r:7,s:.9,b:.85},{x:-100,y:-42,r:-12,s:.92,b:.85}];
  const blend=(a,b,u)=>Object.fromEntries(Object.keys(a).map(key=>[key,lerp(a[key],b[key],u)]));
  const dots=document.getElementById('deckDots');
  dots.innerHTML=BACKGROUNDS.map(()=>'<span class="deckDot"></span>').join('');
  const dotEls=[...dots.children];
  root.parentElement.querySelector('.memoryRail')?.remove();
  const rail=document.createElement('div');rail.className='memoryRail';rail.setAttribute('aria-hidden','true');
  rail.classList.toggle('memoryRail--pair',count===2);
  rail.innerHTML=BACKGROUNDS.slice(0,independent?count:BACKGROUNDS.length).map(()=>'<div class="memoryFrame"><canvas width="240" height="150"></canvas><i></i></div>').join('');
  root.parentElement.append(rail);
  const thumbnails=[...rail.children].map(el=>({el,ctx:el.querySelector('canvas').getContext('2d')}));
  const parts=cards.map(el=>({canvas:el.querySelector('.cardSurface canvas'),shine:el.querySelector('.cardShine'),info:el.querySelector('.cardInfo'),number:el.querySelector('.cardNumber'),name:el.querySelector('.cardSceneName')}));
  return (t,state,audio={bass:0},rasterScale=1)=>{
    const {turn,raw,active}=state;
    const style=turn%layouts.length,slots=layouts[style],nextSlots=layouts[(style+1)%layouts.length];
    const turnover=style===1?.54:.46;
    const railOpacity=smooth((t-4)/1.2);
    rail.style.opacity=String(railOpacity);
    thumbnails.forEach(({el,ctx},j)=>{
      const source=state.order?.[j]??j;
      if(railOpacity>0&&videos[source])drawCover(ctx,videos[source],240,150,BACKGROUNDS[source].focus,null,BACKGROUNDS[source].zoom);
      el.classList.toggle('isActive',source===active);
    });
    cards.forEach((el,i)=>{
      const rank=(i-turn%count+count)%count;
      const source=state.order?.[rank]??cardSourceAt(turn+rank),meta=BACKGROUNDS[source];
      el.style.setProperty('--card-accent',`rgb(${meta.accent.join(',')})`);
      parts[i].number.textContent=String(source+1).padStart(2,'0');
      parts[i].name.textContent=meta.cardTitle||({'teal-3499283619':'TEZCATLIPOCA',violet:'VIOLET DREAM',plana:'PLANA',elaina:'ELAINA'}[meta.id])||meta.name||'';
      const hidden=rank===3&&raw<=.42;
      el.style.visibility=hidden?'hidden':'visible';
      let pose,alpha=1;
      if(rank===0){
        const depart=inOut(raw/turnover);
        const returnBehind=inOut((raw-turnover)/(1-turnover));
        pose=raw<turnover?blend(slots[0],excursions[style],depart):blend(excursions[style],nextSlots[count-1],returnBehind);
      }else{
        const advance=inOut((raw-.18)/.82);
        pose=blend(slots[rank],nextSlots[rank-1],advance);
        const arc=Math.sin(Math.PI*advance);
        if(style===1){pose.y-=arc*(rank===1?30:12);pose.r+=arc*(rank===1?-3:2);}
        if(style===2){pose.x+=arc*(rank===1?75:-65);pose.r+=arc*(rank===1?7:-6);}
        if(rank===3)alpha*=smooth((raw-.42)/.5);
      }
      // Intro: cards rise from below the frame, back to front.
      const intro=introAt(t,rank);
      if(intro<1){
        pose={...pose,y:pose.y+(1-intro)*110,r:pose.r+(1-intro)*(rank%2?3:-3),x:pose.x+(1-intro)*(rank-1)*18};
        alpha*=smooth(intro*3);
      }
      const arrival=Math.exp(-Math.pow((t-INTRO.landings[Math.min(rank,2)])/.075,2));
      pose.s*=1+arrival*(rank===0?.014:.008);
      const calm=1-Math.sin(Math.PI*raw);
      const sway=Math.sin(t*Math.PI/5+i*1.7)*calm;
      const angle=Math.sin(t*Math.PI/6+i*1.3)*calm;
      const rotation=pose.r+angle*(rank===0?.35:.7);
      const tilt=Math.max(-1,Math.min(1,rotation/8));
      const yaw=tilt*4,pitch=-tilt*1.6;
      if(!hidden&&alpha>0){
        const resolution=rank>=2?1:2;
        const rw=Math.round(aperture.w*resolution*rasterScale),rh=Math.round(aperture.h*resolution*rasterScale);
        if(contexts[i].canvas.width!==rw||contexts[i].canvas.height!==rh){contexts[i].canvas.width=rw;contexts[i].canvas.height=rh;}
        drawCover(contexts[i],videos[source],rw,rh,meta.focus,{x:tilt,y:-tilt*.4},meta.zoom);
        const rim=rims[i];
        if(rim)rim.drawImage(contexts[i].canvas,0,0,rim.canvas.width,rim.canvas.height);
      }
      el.style.transform=`translate3d(${pose.x+sway*(rank===0?3:5)}px,${pose.y}px,0) perspective(1400px) rotateZ(${rotation}deg) rotateY(${yaw}deg) rotateX(${pitch}deg) scale(${pose.s})`;
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
      el.style.boxShadow=`var(--edge-x) 2.4px 0 #10191e, var(--edge-x) 3.2px 0 #526167, 0 4px 8px #020a125c, 0 ${14+14*pose.b}px ${30+24*pose.b}px #06131e80`;
      parts[i].shine.style.opacity=String((.08+Math.abs(tilt)*.06+arrival*.2)*pose.b);
    });
    dotEls.forEach((dot,j)=>{dot.style.background=j===active?'var(--accent)':'#ffffff30';dot.style.width=j===active?'28px':'12px';});
  };
}
