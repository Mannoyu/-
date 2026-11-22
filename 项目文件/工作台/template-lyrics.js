import {TEMPLATE_STYLE,TEMPLATE_LYRIC_LAYOUTS} from './lyric-layout.js';

const clamp=value=>Math.max(0,Math.min(1,value));
const ease=value=>1-Math.pow(1-clamp(value),3);
const escape=text=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function highlight(text,keys){
  const terms=[...new Set(keys.filter(Boolean))].sort((first,second)=>second.length-first.length);
  let cursor=0,output='';
  while(cursor<text.length){
    const next=terms.map(term=>({term,at:text.indexOf(term,cursor)})).filter(match=>match.at>=0).sort((first,second)=>first.at-second.at)[0];
    if(!next){output+=escape(text.slice(cursor));break;}
    output+=escape(text.slice(cursor,next.at))+`<mark class="templateWord">${escape(next.term)}</mark>`;
    cursor=next.at+next.term.length;
  }
  return output;
}

function compose(text,keys){
  const clauses=text.split(/(　+|\s{2,})/);
  if(clauses.length===1)return highlight(text,keys);
  return clauses.map(clause=>/^(　+|\s{2,})$/.test(clause)?`<span class="templateSpace">${escape(clause)}</span><wbr>`:`<span class="templateClause">${highlight(clause,keys)}</span>`).join('');
}

export function createTemplateLyrics(root,lyrics,{emphasis=[],style={}}={}){
  let enabled=true,strength=1;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const container=root.closest('.lyrics');
  const legacy=root.querySelector('.pvStage');
  const stage=document.createElement('div');
  stage.className='templateLyricStage';stage.setAttribute('aria-label','双语歌词');
  for(const [key,value] of Object.entries(TEMPLATE_STYLE)){
    if(typeof value==='string'||!['entrance','exit'].includes(key))container.style.setProperty(`--template-${key}`,typeof value==='number'?`${value}px`:value);
  }
  stage.innerHTML=lyrics.map(line=>{
    const options={...style,...TEMPLATE_LYRIC_LAYOUTS[line.text]};
    for(const [key,value] of Object.entries(line.style||{}))if(value&&value!=='default')options[key]=value;
    const quoted=[...line.text.matchAll(/[“"]([^”"]+)[”"]/g)].map(match=>match[1]);
    const latin=/^[\x00-\x7f“”]+$/.test(line.text);
    return `<article class="templateLyricScene ${latin?'templateLatin':''}" data-kind="${escape(line.kind)}" data-effect="${options.effect||'default'}" data-align="${options.align||'default'}" aria-hidden="true">
      <div class="templateLyricRule" aria-hidden="true"><i></i><span></span></div>
      <div class="templateOriginalBox"><p class="templateOriginal"${options.fontSize?` style="--template-original:${Number(options.fontSize)}px;--template-latin:${Number(options.fontSize)}px"`:''}>${compose(line.text,options.emphasis||[...emphasis,...quoted])}</p></div>
      <p class="templateCaption">${escape(line.translation)}</p>
      <div class="templateLyricFoot" aria-hidden="true"><i></i><span></span><b></b></div>
    </article>`;
  }).join('');
  root.append(stage);
  const scenes=[...stage.children].map(scene=>({scene,
    original:scene.querySelector('.templateOriginal'),
    originalBox:scene.querySelector('.templateOriginalBox'),
    caption:scene.querySelector('.templateCaption'),
    progress:scene.querySelector('.templateLyricFoot span'),
  }));
  function fit(){
    for(const {original,originalBox,caption} of scenes){
      original.style.removeProperty('font-size');
      let size=parseFloat(getComputedStyle(original).fontSize);
      while((original.scrollHeight>originalBox.clientHeight+1||original.scrollWidth>originalBox.clientWidth+1)&&size>24){
        size-=1;original.style.fontSize=`${size}px`;
      }
      caption.style.removeProperty('font-size');
      let captionSize=parseFloat(getComputedStyle(caption).fontSize);
      const height=parseFloat(getComputedStyle(container).getPropertyValue('--template-translationHeight'));
      while((caption.scrollHeight>height+1||caption.scrollWidth>caption.clientWidth+1)&&captionSize>24){
        captionSize-=1;caption.style.fontSize=`${captionSize}px`;
      }
    }
  }
  function setEnabled(value){
    enabled=value===true;stage.hidden=!enabled;
    container.classList.toggle('template-mode',enabled);
    legacy?.setAttribute('aria-hidden',String(enabled));
  }
  function setStrength(value){strength=Number.isFinite(value)?Math.max(0,Math.min(1.4,value)):1;}
  function render(time,index,audio={}){
    if(!enabled)return;
    scenes.forEach(({scene},sceneIndex)=>{
      scene.style.visibility=sceneIndex===index?'visible':'hidden';
      scene.setAttribute('aria-hidden',String(sceneIndex!==index));
    });
    const line=lyrics[index],local=time-line.time,duration=line.end-line.time;
    const {scene,original,caption,progress}=scenes[index];
    const entrance=reduced?1:ease(local/TEMPLATE_STYLE.entrance);
    scene.style.translate=scene.dataset.effect==='rise'&&!reduced?`0 ${(1-entrance)*22}px`:'';
    const exit=clamp((local-duration+TEMPLATE_STYLE.exit)/TEMPLATE_STYLE.exit);
    scene.style.opacity=String((reduced?1:ease(local/.18))*(1-exit));
    original.style.clipPath=entrance>=1?'none':`inset(-8px ${(1-entrance)*100}% -8px -8px)`;
    caption.style.opacity=String(reduced?1:ease((local-.08)/.28));
    const sweep=((local-.5)%3.8+3.8)%3.8/3.8;
    scene.style.setProperty('--template-sheen',`${-30+sweep*160}%`);
    scene.style.setProperty('--template-key-light',String(reduced?.25:Math.min(.8,(.3+.16*clamp(audio.beat||0))*strength)));
    progress.style.transform=`scaleX(${clamp(local/Math.max(.1,duration))})`;
  }
  setEnabled(true);
  return {fit,render,setEnabled,setStrength};
}
