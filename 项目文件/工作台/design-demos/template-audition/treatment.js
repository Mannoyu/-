import {SONG} from '../../song-data.js';

const clamp=v=>Math.max(0,Math.min(1,v));
const ease=v=>1-Math.pow(1-clamp(v),3);
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function words(text){
  const expression=/[“"]([^”"]+)[”"]/g;
  let cursor=0,html='',match;
  while((match=expression.exec(text))){
    html+=escape(text.slice(cursor,match.index))+`<mark>${escape(match[0])}</mark>`;
    cursor=match.index+match[0].length;
  }
  return html+escape(text.slice(cursor));
}
function compose(text){
  return text.split(/(　+)/).map(part=>/^　+$/.test(part)?'<span class="space">　</span><wbr>':`<span class="phrase">${words(part)}</span>`).join('');
}

export async function mountTreatment(target){
  const doc=target.document,stage=doc.getElementById('stage');
  const sheet=doc.createElement('link');sheet.rel='stylesheet';sheet.href=new URL('treatment.css',import.meta.url).href;
  await new Promise((resolve,reject)=>{sheet.onload=resolve;sheet.onerror=()=>reject(new Error('试听样式加载失败'));doc.head.append(sheet);});
  const features=await fetch(new URL('../../audio/features.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('音频特征加载失败');return r.json();});
  const field=doc.createElement('div');field.className='audition-field audition-overlay';field.setAttribute('aria-hidden','true');
  const copy=doc.createElement('section');copy.className='audition-copy audition-overlay';copy.setAttribute('aria-label','歌曲与双语歌词');
  copy.innerHTML=`<header class="audition-song"><strong class="audition-title">${escape(SONG.title)}</strong><span class="audition-artist">${escape(SONG.artist)}</span></header>
    <div class="audition-lines">${SONG.lyrics.map(line=>`<article class="audition-line ${/^[\x00-\x7f“”]+$/.test(line.text)?'latin':''}" aria-hidden="true"><div class="audition-originalbox"><p class="audition-original">${compose(line.text)}</p></div><p class="audition-caption">${escape(line.translation)}</p></article>`).join('')}</div>
    <div class="audition-sound" aria-hidden="true">${'<i></i>'.repeat(41)}</div>`;
  stage.append(field,copy);
  const scenes=[...copy.querySelectorAll('.audition-line')].map(scene=>({scene,original:scene.querySelector('.audition-original'),caption:scene.querySelector('.audition-caption')}));
  const bars=[...copy.querySelectorAll('.audition-sound i')];
  await doc.fonts.ready;
  function fit(){
    for(const {original,caption} of scenes){
      original.style.removeProperty('font-size');
      let size=parseFloat(target.getComputedStyle(original).fontSize);
      while(size>30&&(original.scrollHeight>184||original.scrollWidth>copy.clientWidth+1))original.style.fontSize=`${--size}px`;
      caption.style.removeProperty('font-size');
      let captionSize=34;
      while(captionSize>26&&(caption.scrollHeight>110||caption.scrollWidth>copy.clientWidth+1))caption.style.fontSize=`${--captionSize}px`;
    }
  }
  const reduced=target.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active=true,index=-1;
  const originalRender=target.render;
  function draw(time){
    const next=Math.max(0,SONG.lyrics.findLastIndex(line=>line.time<=time));
    if(next!==index){
      if(index>=0){scenes[index].scene.style.visibility='hidden';scenes[index].scene.setAttribute('aria-hidden','true');}
      index=next;scenes[index].scene.style.visibility='visible';scenes[index].scene.setAttribute('aria-hidden','false');
    }
    const line=SONG.lyrics[index],{scene,original,caption}=scenes[index],local=time-line.time;
    const incoming=reduced?1:ease(local/.38),outgoing=1-clamp((time-(line.end-.15))/.15);
    scene.style.opacity=String(outgoing);
    original.style.opacity=String(incoming);
    original.style.transform=`translateY(${reduced?0:(1-incoming)*9}px)`;
    caption.style.opacity=String(reduced?1:ease((local-.08)/.3));
    caption.style.transform=`translateY(${reduced?0:(1-ease((local-.08)/.3))*5}px)`;
    const frame=Math.max(0,Math.min(features.bands.length-1,Math.floor(time/features.step)));
    bars.forEach((bar,i)=>{
      const band=Math.round(i/(bars.length-1)*12);
      let level=0;
      for(let offset=0;offset<6;offset++)level=Math.max(level,(features.bands[Math.max(0,frame-offset)]?.[band]||0)*Math.exp(-offset*features.step/.12));
      bar.style.transform=`scaleY(${reduced?.2:.1+level*.78})`;
      bar.style.opacity=String(.3+level*.6);
    });
  }
  target.render=async time=>{await originalRender(time);if(active)draw(time);};
  function setMode(mode){
    active=mode==='demo';stage.classList.toggle('audition-demo',active);
    field.hidden=!active;copy.hidden=!active;
    target.setPresentationStyle(active?'demo':'template');
    if(active)fit();
  }
  setMode('demo');
  return {setMode,fit,lyrics:SONG.lyrics};
}
