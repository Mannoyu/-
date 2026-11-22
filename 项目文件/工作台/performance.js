import {layoutFor} from './pv-lyrics.js';

const clamp=value=>Math.max(0,Math.min(1,value));
const ease=value=>1-Math.pow(1-clamp(value),3);
const escape=text=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function composition(line,emphasis){
  const broken=/^(.*?)([“"]?)Broken Heart([”"]?)$/.exec(line.text);
  if(broken)return {type:'broken',parts:[
    {text:broken[1].trim(),role:'lead'},
    {text:`${broken[2]}Broken`,role:'broken'},
    {text:`Heart${broken[3]}`,role:'heart'},
  ]};
  if(line.text.includes('横たわる宇宙'))return {type:'cosmos',parts:[
    {text:'君と僕の間に',role:'lead'},
    {text:'横たわる',role:'middle'},
    {text:'宇宙',role:'cosmos'},
  ]};
  return {type:line.text.includes('Goodbye')?'farewell':line.text.includes('未完成')?'unfinished':'verse',parts:layoutFor(line.text,line.kind,emphasis)};
}

export function createPerformance(stage,lyrics,choruses,{enabled=false,emphasis=[]}={}){
  let active=enabled;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root=document.createElement('section');
  root.className='perfStage';root.setAttribute('aria-label','音乐 PV 双语歌词');
  const plans=lyrics.map(line=>composition(line,emphasis));
  root.innerHTML=lyrics.map((line,index)=>{
    const plan=plans[index];
    const chorus=choruses.some(section=>line.time>=section.start&&line.time<section.end);
    return `<article class="perfScene perf-${plan.type} ${chorus?'perfChorus':''}" data-kind="${escape(line.kind)}" aria-hidden="true">
      <div class="perfCopy">${plan.parts.map(part=>`<div class="perfRow perfRole-${part.role}" data-latin="${/^[\x00-\x7f“”]+$/.test(part.text)}"><span class="perfPhrase">${escape(part.text)}</span><span class="perfSlice" aria-hidden="true">${escape(part.text)}</span><span class="perfTrace" aria-hidden="true">${escape(part.text)}</span></div>`).join('')}
      <p class="perfTranslation">${escape(line.translation)}</p>
      <div class="perfSignal" aria-hidden="true">${'<i></i>'.repeat(13)}</div></div>
    </article>`;
  }).join('');
  stage.append(root);
  const scenes=[...root.children].map(scene=>({scene,
    rows:[...scene.querySelectorAll('.perfRow')],
    translation:scene.querySelector('.perfTranslation'),
    signal:[...scene.querySelectorAll('.perfSignal i')],
  }));
  const cover=document.getElementById('coverGroup');
  const legacy=document.querySelector('.lyrics');
  function fit(){
    for(const {rows} of scenes){
      for(const row of rows){
        row.style.removeProperty('font-size');
        const phrase=row.querySelector('.perfPhrase');
        const width=phrase.getBoundingClientRect().width;
        const available=row.getBoundingClientRect().width-32;
        if(width>available&&available>0)row.style.fontSize=`${parseFloat(getComputedStyle(row).fontSize)*available/width}px`;
      }
    }
  }
  function setEnabled(value){
    active=value===true;
    root.hidden=!active;
    stage.classList.toggle('performance-design',active);
    if(!active){
      stage.classList.remove('performance-active');
      root.style.visibility='hidden';legacy.setAttribute('aria-hidden','false');
      cover.style.transform='none';
      cover.style.removeProperty('opacity');
      delete stage.dataset.performanceShot;
    }
  }
  setEnabled(active);
  function render(time,index,audio){
    if(!active)return;
    const line=lyrics[index],isLyric=line.kind==='lyric'||line.kind==='outro';
    stage.classList.toggle('performance-active',isLyric);
    legacy.setAttribute('aria-hidden',String(isLyric));
    root.style.visibility=isLyric?'visible':'hidden';
    scenes.forEach(({scene},sceneIndex)=>{
      scene.style.visibility=isLyric&&sceneIndex===index?'visible':'hidden';
      scene.setAttribute('aria-hidden',String(!isLyric||sceneIndex!==index));
    });
    cover.style.opacity='1';
    if(!isLyric){delete stage.dataset.performanceShot;return;}
    const local=time-line.time,duration=line.end-line.time;
    const {scene,rows,translation,signal}=scenes[index];
    stage.dataset.performanceShot=plans[index].type;
    const immersion=plans[index].type==='cosmos'?Math.min(ease(local/.5),ease((duration-local)/.5)):0;
    cover.style.opacity=String(1-immersion);
    const enter=reduced?1:ease(local/.56),exit=clamp((local-duration+.16)/.16);
    const lift=choruses.reduce((weight,section)=>Math.max(weight,
      Math.min(ease((time-section.start)/.9),ease((section.end-time)/.9))),0);
    cover.style.transform=reduced?'none':`translate(-20px,${118*lift}px) scale(${1-.2*lift})`;
    stage.style.setProperty('--perf-lift',String(lift));
    scene.style.opacity=String(1-exit);
    rows.forEach((row,rowIndex)=>{
      const arrive=reduced?1:ease((local-rowIndex*.055)/.48);
      row.style.clipPath=arrive>=1&&exit===0?'none':`inset(0 0 ${Math.max((1-arrive)*100,exit*100)}% 0)`;
      row.style.transform=`translateY(${(1-arrive)*38}px)`;
      row.style.setProperty('--perf-split',`${(1-enter)*42}px`);
      row.style.setProperty('--perf-slice-alpha',String(reduced?0:(1-enter)*.85));
      const isHeart=row.classList.contains('perfRole-heart');
      const ink=reduced?1:ease((local-(isHeart?.12:0))/.64);
      row.style.setProperty('--perf-fill',`${ink*100}%`);
      const trace=((local-.7)%3.2+3.2)%3.2/3.2;
      row.style.setProperty('--perf-trace',String(reduced?0:ease((local-.7)/.3)*.42));
      row.style.setProperty('--perf-trace-pos',`${-20+trace*170}%`);
    });
    translation.style.opacity=String(reduced?1:ease((local-.18)/.34));
    translation.style.transform='none';
    signal.forEach((bar,band)=>{
      const value=clamp(audio.bands?.[band]??audio.energy??0);
      bar.style.transform=`scaleY(${reduced?.24:.12+value*.88})`;
    });
  }
  return {fit,render,setEnabled};
}
