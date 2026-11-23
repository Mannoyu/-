import {ELEMENTS,ANIMATIONS,normalizeElements} from './scene-editor-model.mjs';
const get=id=>document.getElementById(id);
export function createElementEditor(host){
  let selected='cards',dragging=false,hasSelection=false;
  const draft=()=>host.state()?.draft;
  const current=()=>draft()?.elements?.[selected];
  const nodes=()=>get('preview').contentWindow?.sceneElementNodes??{};
  const run=fn=>Promise.resolve().then(fn).catch(e=>host.notify(e.message,true));
  function paint(){
    if(!draft())return;
    draft().elements=normalizeElements(draft().elements);
    const v=current();get('element-choice').value=selected;
    for(const key of ['x','y','scale','rotation','opacity','animation','delay','duration','fontSize'])get(`element-${key}`).value=key==='fontSize'&&!v[key]?'':typeof v[key]==='number'?Number(v[key].toFixed(3)):v[key];
    get('element-color').value=v.color||'#ffffff';get('element-visible').checked=v.visible;
    get('element-delay').disabled=get('element-duration').disabled=['default','none'].includes(v.animation);
    get('element-title-fields').hidden=!['title','artist'].includes(selected);
    get('element-ink-field').hidden=selected!=='title';
    get('element-ink').value=v.ink??'original';
    get('element-cardLayout-field').hidden=selected!=='cards';
    get('element-cardLayout').value=v.cardLayout??'stack';
    get('element-card-fields').hidden=!/^card\d$/.test(selected);
    const glass=draft().elements.cards.cardLayout==='glass-filmstrip';
    get('element-cardNumber-field').hidden=get('element-cardCollection-field').hidden=glass;
    for(const key of ['cardTitle','cardNumber','cardCollection'])get(`element-${key}`).value=v[key];get('element-captionVisible').checked=v.captionVisible;
    get('element-title').value=draft().title;get('element-artist').value=draft().artist;get('element-persistent').checked=draft().showSongTitle===true;
    get('element-detail').hidden=!['cards','background','lyrics'].includes(selected);
    update();
  }
  function update(){
    if(dragging)return;
    const box=get('scene-box'),node=nodes()[selected];
    box.hidden=!hasSelection||host.playing()||!node||!current()?.visible;
    if(box.hidden)return;
    const r=node.getBoundingClientRect();
    box.hidden=!r.width||!r.height;
    Object.assign(box.style,{left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`});
    get('scene-box-label').textContent=ELEMENTS.find(([id])=>id===selected)[1];
  }
  function choose(id){selected=id;hasSelection=true;host.pause();host.panel('element-settings');paint();}
  function bind(){
    get('element-choice').replaceChildren(...ELEMENTS.map(([id,label])=>new Option(label,id)));
    get('element-animation').replaceChildren(...ANIMATIONS.map(([id,label])=>new Option(label,id)));
    get('element-choice').addEventListener('change',e=>choose(e.target.value));
    for(const key of ['x','y','scale','rotation','opacity','animation','delay','duration','fontSize','color','cardTitle','cardNumber','cardCollection']){
      get(`element-${key}`).addEventListener('change',e=>run(()=>{
        const input=e.target;
        if(key==='fontSize'&&!input.value.trim()){current().fontSize=0;return host.save();}
        if(input.type==='number'&&(!input.value.trim()||!input.validity.valid))throw Error('请输入范围内的数值');
        current()[key]=input.type==='number'?Number(input.value):input.value;return host.save();
      }));
    }
    get('element-ink').addEventListener('change',event=>run(()=>{
      draft().elements.title.ink=event.target.value;
      return host.save();
    }));
    get('element-cardLayout').addEventListener('change',event=>run(()=>{
      draft().elements.cards.cardLayout=event.target.value;
      return host.save();
    }));
    get('element-visible').addEventListener('change',e=>run(()=>{current().visible=e.target.checked;return host.save();}));
    get('element-captionVisible').addEventListener('change',e=>run(()=>{current().captionVisible=e.target.checked;return host.save();}));
    for(const [id,key] of [['element-title','title'],['element-artist','artist'],['element-persistent','showSongTitle']])get(id).addEventListener('change',e=>run(()=>{draft()[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;return host.save();}));
    get('element-reset').addEventListener('click',()=>run(()=>{draft().elements[selected]=normalizeElements()[selected];return host.save();}));
    get('element-replay').addEventListener('click',()=>run(()=>{host.seek(current().animation==='default'?0:current().delay);return host.play();}));
    get('element-detail').addEventListener('click',()=>{
      if(selected==='lyrics')host.selectLyric();
      else {host.selectBackground();host.panel('background-settings');}
    });
    const surface=get('scene-select');
    surface.addEventListener('dblclick',()=>{if(selected==='lyrics')host.selectLyric();else if(['title','artist'].includes(selected))get(selected==='title'?'element-title':'element-artist').focus();});
    surface.addEventListener('pointerdown',e=>{
      if(!draft()||e.button!==0)return;
      const bounds=surface.getBoundingClientRect(),x=e.clientX-bounds.left,y=e.clientY-bounds.top;
      const resize=e.target.id==='scene-resize';
      if(!resize){
        const cardIds=['card0','card1','card2','card3'].sort((a,b)=>Number(nodes()[b]?.style.zIndex||0)-Number(nodes()[a]?.style.zIndex||0));
        const found=['artist','title','lyrics',...cardIds,'cards','progress'].find(id=>{
          const n=nodes()[id];if(!n||!draft().elements[id].visible)return false;
          const r=n.getBoundingClientRect(),css=getComputedStyle(n);
          return css.visibility!=='hidden'&&css.display!=='none'&&Number(css.opacity)>.01&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;
        });choose(found??'background');
      }
      e.preventDefault();host.pause();surface.focus();
      const id=selected,v=structuredClone(current()),node=nodes()[id];if(!node)return;
      const scale=bounds.width/1920,anchorX=e.clientX,anchorY=e.clientY;
      const original={translate:node.style.translate,scale:node.style.scale};let changed=false;
      const base=(node.style.translate||'0 0').split(/\s+/).map(parseFloat);
      dragging=true;surface.setPointerCapture(e.pointerId);
      const move=event=>{
        const dx=(event.clientX-anchorX)/scale,dy=(event.clientY-anchorY)/scale;
        if(Math.abs(dx)+Math.abs(dy)<3&&!changed)return;changed=true;
        const next={...v,...(resize?{scale:Math.max(.1,Math.min(4,v.scale+dx/600))}:{x:Math.max(-1920,Math.min(1920,Math.round(v.x+dx))),y:Math.max(-1080,Math.min(1080,Math.round(v.y+dy)))})};
        draft().elements[id]=next;
        if(resize)node.style.scale=String((parseFloat(original.scale)||1)*next.scale/v.scale);
        else node.style.translate=`${(base[0]||0)+next.x-v.x}px ${(base[1]||0)+next.y-v.y}px`;
        dragging=false;update();dragging=true;
      };
      const finish=event=>{
        surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerup',finish);surface.removeEventListener('pointercancel',cancel);
        if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);dragging=false;
        Object.assign(node.style,original);
        if(changed)run(()=>host.save());paint();
      };
      const cancel=event=>{draft().elements[id]=v;changed=false;finish(event);};
      surface.addEventListener('pointermove',move);surface.addEventListener('pointerup',finish);surface.addEventListener('pointercancel',cancel);
    });
    surface.addEventListener('keydown',e=>{
      if(current()&&['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();current().visible=false;run(()=>host.save());return;}
      if(!current()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
      e.preventDefault();const step=e.shiftKey?10:1;
      current().x+=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;
      current().y+=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;run(()=>host.save());
    });
  }
  return {bind,paint,update};
}
