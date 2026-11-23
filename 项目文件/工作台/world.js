import {INTRO} from './timeline.js';
import {SONG} from './song-data.js';
import {SONG as activeSong} from './runtime-song.js';
import {OPENING_STYLE} from './lyric-layout.js';
import {normalizeElement} from './scene-editor-model.mjs';
const clamp=x=>Math.max(0,Math.min(1,x));
const out=x=>1-Math.pow(1-clamp(x),3);
// Opening only: dark frame, title card, then the deck rises in (deck.js) and the chrome fades up.
export function createWorld(stage){
  const title=document.createElement('div');title.id='world-title';
  const persistent=activeSong.titlePersistent===true||activeSong.lyrics[0]?.kind==='title';
  const editable=normalizeElement(activeSong.elements?.title,'title');
  const flowInk=editable.ink==='flow';
  const custom=editable.animation!=='default'||normalizeElement(activeSong.elements?.artist).animation!=='default';
  title.classList.toggle('world-title-persistent',persistent);
  stage.classList.toggle('instrumental-scene',persistent);
  stage.classList.toggle('title-with-subtitles',persistent&&activeSong.lyrics.some(line=>line.kind==='lyric'));
  const escape=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titleLines=OPENING_STYLE.titleLines.join(' ')===activeSong.title?OPENING_STYLE.titleLines:activeSong.title.split(/\r?\n/);
  title.innerHTML=`<strong>${titleLines.map(text=>`<span>${escape(text)}</span>`).join('')}</strong><small>${escape(activeSong.artist)}${activeSong.subtitle?`<span>${escape(activeSong.subtitle)}</span>`:''}</small>`;
  stage.append(title);
  const heading=title.querySelector('strong');
  if(flowInk)heading.classList.add('title-ink-flow');
  if(editable.fontSize)heading.style.fontSize=`${editable.fontSize}px`;
  if(editable.color){
    heading.style.color=editable.color;
    if(flowInk)heading.style.setProperty('--title-ink-base',editable.color);
    else heading.style.backgroundImage='none';
  }
  const details=[...document.querySelectorAll('.trackInfo,.deckNav,.topline,footer,.lyricLabel,.lyricFoot')];
  const lyrics=document.querySelector('.lyrics');
  const atmosphere=document.getElementById('atmosphere');
  const bg=document.getElementById('background');
  const lyricStart=SONG.lyrics[0]?.kind==='credit'?SONG.lyrics[0].end:INTRO.chrome;
  const openingEnd=OPENING_STYLE.holdUntil+OPENING_STYLE.exitDuration;
  const end=persistent?openingEnd:Math.max(openingEnd,lyricStart+.8);
  if(persistent)lyrics.hidden=!activeSong.lyrics.some(line=>line.kind==='lyric');
  return time=>{
    if(!persistent&&time>=end)title.style.visibility='hidden';
    else title.style.visibility='visible';
    const show=custom?1:out(time/.65);
    const hide=persistent?0:out((time-OPENING_STYLE.holdUntil)/OPENING_STYLE.exitDuration);
    title.style.opacity=String(show*(1-hide));
    title.style.transform=`translateY(${(1-show)*16-hide*12}px)`;
    title.style.letterSpacing=`${(1-show)*6}px`;
    if(flowInk&&(persistent||time<openingEnd)){
      // Ease to a stop at each edge before reversing so the color never snaps back.
      const sweepPosition = 50 * (1 + Math.cos(Math.PI * time / 4.8));
      heading.style.setProperty('--title-ink-position',`${sweepPosition}%`);
    }
    if(persistent){
      const phase = (time % 12) / 6;
      const travel = phase <= 1 ? phase : 2 - phase;
      const flow = travel * travel * (3 - 2 * travel);
      title.style.setProperty('--title-current-blue', `${flow * 100}%`);
      title.style.setProperty('--title-current-violet', `${(1 - flow) * 100}% ${100 - flow * 90}%`);
    }
    if(time>=end){details.forEach(element=>element.style.removeProperty('opacity'));lyrics.style.opacity='1';atmosphere.style.opacity='1';bg.style.opacity='1';return;}
    const chrome=out((time-INTRO.chrome)/1.2);
    details.forEach(e=>e.style.opacity=String(chrome));
    lyrics.style.opacity=String(out((time-lyricStart)/.8));
    atmosphere.style.opacity=String(chrome);
    bg.style.opacity=String(.7+.3*out(time/.65));
  };
}
