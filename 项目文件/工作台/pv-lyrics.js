import {LYRIC_STYLE,LYRIC_LAYOUTS,LYRIC_EFFECTS} from './lyric-layout.js';
const clamp=x=>Math.max(0,Math.min(1,x));
const out=x=>1-Math.pow(1-clamp(x),3);
const escape=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const segments=new Intl.Segmenter('ja',{granularity:'grapheme'});
const glyphs=text=>[...segments.segment(text)].map(({segment})=>segment);

// Phrase grouping is editorial composition, not inferred word-level timing.
export function layoutFor(text,kind,emphasis=[]){
  if(kind==='title'){
    const title=/^(.*?)\s*([（(][^（）()]+[）)])$/.exec(text);
    if(title?.[1])return [{text:title[1],role:'hero'},{text:title[2],role:'lead'}];
    return [{text,role:'hero'}];
  }
  const quoted=/^(.*?)([“"][^”"]+[”"])$/.exec(text);
  if(quoted&&quoted[1].trim())return [{text:quoted[1].trim(),role:'lead'},{text:quoted[2],role:'hero'}];
  if(kind==='credit'&&/[：:]/.test(text)){
    const at=text.search(/[：:]/)+1;
    return [{text:text.slice(0,at),role:'lead'},{text:text.slice(at).trim(),role:'credit'}];
  }
  const clauses=text.split(/　|\s{2,}/).filter(Boolean);
  if(clauses.length>1)return clauses.map((text,i)=>({text,role:i===clauses.length-1?'hero':i===0?'lead':'middle'}));
  for(const key of emphasis){
    const at=text.indexOf(key);
    if(at>=0)return [
      ...(at?[{text:text.slice(0,at),role:'lead'}]:[]),
      {text:key,role:'hero'},
      ...(at+key.length<text.length?[{text:text.slice(at+key.length),role:'tail'}]:[]),
    ];
  }
  const chars=glyphs(text);
  if(chars.length>10){const cut=Math.ceil(chars.length/2);return [{text:chars.slice(0,cut).join(''),role:'lead'},{text:chars.slice(cut).join(''),role:'hero'}];}
  return [{text,role:'hero'}];
}

export function createPvLyrics(root,lyrics,choruses,{emphasis=[],style={},effectMode='glow'}={}){
  let effectStyle=effectMode,effectStrength=1;
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage=document.createElement('div');stage.className='pvStage';root.append(stage);
  const container=root.closest('.lyrics');
  for(const [key,value] of Object.entries(LYRIC_STYLE))container.style.setProperty(`--pv-${key}`,typeof value==='number'?`${value}px`:value);
  const normalize=text=>text.replace(/\s+/g,'');
  const layoutEntries=Object.entries(LYRIC_LAYOUTS);
  const styles=lyrics.map(({style:line})=>({fontSize:line?.fontSize||style.fontSize,align:line?.align||style.align,color:line?.color||style.color,duration:line?.duration??style.duration??.42,delay:line?.delay??style.delay??0,
    effect:line?.effect&&line.effect!=='default'?line.effect:style.effect,emphasis:line?.emphasis?.length?line.emphasis:style.emphasis}));
  const overrides=lyrics.map((line,index)=>styles[index].emphasis?.length?undefined:LYRIC_LAYOUTS[line.text]||layoutEntries.find(([text])=>normalize(text)===normalize(line.text))?.[1]);
  const plans=lyrics.map((line,i)=>overrides[i]?.parts||layoutFor(line.text,line.kind,styles[i].emphasis||emphasis));
  stage.innerHTML=lyrics.map((line,i)=>{
    const semantic=overrides[i]?.semantic||'plain';
    const parts=plans[i],hero=parts.find(part=>part.role==='hero')||parts[parts.length-1];
    const chorus=choruses.some(section=>line.time>=section.start&&line.time<section.end);
    const latin=/^[\x00-\x7f“”]+$/.test(hero.text);
    const focus=overrides[i]?.translationFocus;
    const focusAt=focus?line.translation.indexOf(focus):-1;
    const translation=focusAt<0?escape(line.translation):`${escape(line.translation.slice(0,focusAt))}<strong>${escape(focus)}</strong>${escape(line.translation.slice(focusAt+focus.length))}`;
    return `<article class="pvScene ${chorus?'pvChorus':''} ${latin?'pvLatin':''} ${focusAt>=0?'pvTranslationFocus':''}" data-semantic="${semantic}" data-kind="${line.kind}" aria-label="${escape(line.text)}" aria-hidden="true">
      <div class="pvEcho" aria-hidden="true"></div>
      <div class="pvOrbit" aria-hidden="true"><i></i><i></i><b></b><b></b></div>
      <div class="pvText">${parts.map((part,row)=>`<div class="pvRow pv-${part.role}" data-row="${row}"><span class="pvPart">${glyphs(part.text).map(char=>`<span class="pvGlyph"><span class="pvInk">${escape(char)}</span><span class="pvContourLine" aria-hidden="true">${escape(char)}</span><span class="pvContourEcho" aria-hidden="true">${escape(char)}</span></span>`).join('')}</span></div>`).join('')}
        <div class="pvTranslation"><i></i><span>${translation}</span></div>
        <div class="pvUnderline" aria-hidden="true"></div>
      </div>
      <div class="pvNext" hidden></div>
    </article>`;
  }).join('');
  const scenes=[...stage.children].map((scene,i)=>({
    scene,echo:scene.querySelector('.pvEcho'),translation:scene.querySelector('.pvTranslation'),orbit:scene.querySelector('.pvOrbit'),orbitDots:[...scene.querySelectorAll('.pvOrbit b')],
    next:scene.querySelector('.pvNext'),underline:scene.querySelector('.pvUnderline'),
    rows:[...scene.querySelectorAll('.pvRow')].map(row=>({row,part:row.querySelector('.pvPart'),chars:[...row.querySelectorAll('.pvGlyph')],size:76})),
    chorus:choruses.some(section=>lyrics[i].time>=section.start&&lyrics[i].time<section.end),
  }));
  scenes.forEach(({scene},index)=>{
    scene.style.visibility='hidden';
    const {align}=styles[index];
    if(styles[index].color)scene.querySelectorAll('.pvRow,.pvTranslation,.pvInk').forEach(node=>node.style.color=styles[index].color);
    if(align){
      scene.querySelectorAll('.pvRow, .pvTranslation').forEach(element=>{element.style.textAlign=align;});
      scene.querySelector('.pvTranslation').style.justifyContent={left:'flex-start',center:'center',right:'flex-end'}[align];
    }
  });
  let activeIndex=-1;
  let settledGlyphs=false;
  function fit(){
    scenes.forEach(({rows,echo},index)=>{
      rows.forEach(entry=>{
        const {row,part}=entry;
        row.style.removeProperty('font-size');
        if(styles[index].fontSize)row.style.fontSize=`${styles[index].fontSize}px`;
        const style=getComputedStyle(row),size=parseFloat(style.fontSize);
        const available=row.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-8;
        if(part.scrollWidth>available)row.style.fontSize=`${size*available/part.scrollWidth}px`;
        entry.size=parseFloat(getComputedStyle(row).fontSize);
      });
      const width=echo.scrollWidth,available=stage.clientWidth-12;
      if(width>available)echo.style.fontSize=`${parseFloat(getComputedStyle(echo).fontSize)*available/width}px`;
    });
  }
  function render(time,index,audio={},intensity=.75){
    const line=lyrics[index],local=time-line.time,duration=line.end-line.time;
    const {scene,rows,echo,translation,next,underline,chorus,orbit,orbitDots}=scenes[index];
    if(index!==activeIndex){
      const previous=scenes[activeIndex]?.scene;
      if(previous){previous.style.visibility='hidden';previous.setAttribute('aria-hidden','true');}
      stage.dataset.active=String(index);
      scene.style.visibility='visible';scene.setAttribute('aria-hidden','false');
      activeIndex=index;
      settledGlyphs=false;
    }
    const exit=line.kind==='title'?0:clamp((local-(duration-.15))/.15);
    const semantic=scene.dataset.semantic;
    const contour=effectStyle==='contour'&&line.kind==='lyric';
    const contourStyle=LYRIC_EFFECTS.contour;
    scene.classList.toggle('pvContour',contour);
    const effect=LYRIC_EFFECTS.enabled&&line.kind==='lyric'?clamp(intensity)*LYRIC_EFFECTS.glow:0;
    const sustain=out((local-.35)/.5)*(1-exit)*effect*(contour?0:1);
    const sweep=((local-.55)/LYRIC_EFFECTS.sweepPeriod%1+1)%1;
    const breath=.5+.5*Math.sin(local*Math.PI*2/3.6);
    const pulse=clamp(audio.beat||0);
    scene.style.setProperty('--pv-breath',String(breath*sustain));
    scene.style.setProperty('--pv-spark',`${sweep*100}%`);
    scene.style.setProperty('--pv-spark-opacity',String(sustain*Math.pow(Math.sin(sweep*Math.PI),2)));
    const opening=out(local/.8),separation=out((local-.4)/1.6);
    orbit.style.opacity=String(semantic==='distance'?opening*(1-exit):0);
    orbit.style.transform=`scaleX(${.55+separation*.45}) rotate(-18deg)`;
    const entryEffect=styles[index].effect;
    const customEntry=entryEffect&&entryEffect!=='default';
    const entrance=entryEffect==='none'?1:customEntry?out((local-styles[index].delay)/styles[index].duration):1;
    scene.style.opacity=String((time<line.time||time>=line.end?0:1)*entrance*(1-exit*.8));
    scene.style.translate=entryEffect==='rise'?`0 ${(1-entrance)*16}px`:entryEffect==='slide'?`${(1-entrance)*80}px 0`:'none';
    scene.style.scale=entryEffect==='zoom'?String(.7+.3*entrance):'1';
    const staticGlyphs=!contour&&effect===0&&(semantic==='plain'||semantic==='fracture')&&local>=LYRIC_STYLE.entrance+.18+(rows.length-1)*.085;
    rows.forEach(({row,chars,size},r)=>{
      const direction=1;
      row.style.clipPath=`inset(0 ${exit*100}% 0 0)`;
      row.style.transform='none';
      if(semantic==='fracture'&&r>0){
        const split=out((local-.45)/.85);
        row.style.transform=`translate(${r===1?-split*13:split*24}px,${r===1?-split*4:split*5}px) rotate(${(r===1?-1:1)*split*2}deg)`;
      }
      if(staticGlyphs&&settledGlyphs)return;
      chars.forEach((char,c)=>{
        const enter=customEntry?1:out((local-r*.085-Math.min(c*.012,.18))/LYRIC_STYLE.entrance);
        char.style.opacity=String(enter);
        char.style.transform=`translate3d(0,${(1-enter)*LYRIC_STYLE.travel}px,0)`;
        const cursor=-.35+sweep*1.7;
        const distance=(c+.5)/chars.length-cursor;
        const shine=Math.exp(-Math.pow(distance/LYRIC_EFFECTS.sweepWidth,2));
        const glow=sustain*(shine*(.65+.15*pulse)+.08*breath);
        char.style.setProperty('--pv-glow',String(glow));
        char.style.textShadow=`0 2px 4px #01071199,0 0 ${4+glow*14}px color-mix(in srgb,var(--accent) ${Math.round(glow*70)}%,transparent)`;
        if(contour){
          const phase=local-r*.025-Math.min(c*.003,.035);
          const fill=out((phase-.06)/(contourStyle.reveal-.06));
          const loop=((local-.65)/contourStyle.period%1+1)%1;
          const weight=row.classList.contains('pv-hero')||row.classList.contains('pv-cosmos')?1:.35;
          const strength=LYRIC_EFFECTS.enabled?effectStrength:0;
          const echoAlpha=Math.min(.12,(chorus?contourStyle.chorusAlpha:contourStyle.verseAlpha)*strength)*Math.sin(Math.PI*loop)*out((local-.45)/.3)*weight*(1-exit);
          char.style.opacity=String(out(local/.09));
          char.style.transform='none';
          char.style.textShadow='none';
          char.style.setProperty('--pv-ink-clip',reducedMotion||fill>=1?'none':`inset(0 ${(1-fill)*100}% 0 0)`);
          char.style.setProperty('--pv-line-alpha',String(reducedMotion?0:out(phase/.12)*(.9-.84*fill)*(1-exit)));
          char.style.setProperty('--pv-echo-alpha',String(reducedMotion?0:echoAlpha));
          char.style.setProperty('--pv-echo-scale',String(1+contourStyle.spread*loop/Math.max(size,1)));
        }
        if(semantic==='distance'){
          const spread=row.classList.contains('pv-distance')?(c-(chars.length-1)/2)*separation*13:row.classList.contains('pv-cosmos')?(c-.5)*separation*90:0;
          char.style.transform=`translate(${spread}px,${(1-enter)*12}px)`;
          if(row.classList.contains('pv-distance')){
            const endpoint=c===0||c===2;
            const position=endpoint?(c===0?-1:1)*(80+separation*135):c===1?0:(c-4)*30;
            char.style.transform=`translate(calc(-50% + ${position}px),${c>=3?58:0}px)`;
          }
        }
        if(semantic==='puzzle'){
          const assemble=out((local-c*.09)/.9);
          const missing=line.text.includes('未完成')&&r===0&&c===chars.length-1;
          char.style.opacity=String(.25+.75*assemble);
          char.style.transform=`translate(${(1-assemble)*(c%2?60:-45)+(missing?12:0)}px,${(1-assemble)*(c%2?-55:45)+(missing?-14:0)}px) rotate(${(1-assemble)*(c%2?12:-12)+(missing?9:0)}deg)`;
        }
        if(semantic==='farewell'){
          const leave=out((local-(duration-.65))/.65);
          const held=r===rows.length-1;
          char.style.opacity=String(enter*(held?1-leave*.35:1-leave));
          char.style.transform=`translate(${(1-enter)*-22+leave*(held?14:65)}px,0)`;
          if(held)row.style.clipPath='none';
        }
      });
    });
    settledGlyphs=staticGlyphs;
    const subtitle=out((local-.24)/.3);
    translation.style.opacity=String(subtitle*(1-exit));
    translation.style.transform=`translateX(${(1-subtitle)*8}px)`;
    echo.style.opacity=String(semantic==='plain'?out(local/.5)*(chorus?.12:.075):0);
    echo.style.transform=`translateX(${(1-out(local/.55))*-24}px)`;
    next.style.opacity=String(index===lyrics.length-1?0:out((local-.5)/.35)*.45*(1-exit));
    underline.style.transform=`scaleX(${out(local/.55)*(1-exit)})`;
    orbitDots.forEach((dot,dotIndex)=>{
      const angle=local*.65+dotIndex*Math.PI;
      dot.style.left=`${50+50*Math.cos(angle)}%`;
      dot.style.top=`${50+50*Math.sin(angle)}%`;
      dot.style.right='auto';
    });
  }
  function setEffectStyle(mode,strength=1){
    effectStyle=mode==='contour'?'contour':'glow';
    effectStrength=Number.isFinite(strength)?Math.max(0,Math.min(1.4,strength)):1;
  }
  return {fit,render,plans,setEffectStyle};
}
