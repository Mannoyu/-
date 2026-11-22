const clamp=value=>Math.max(0,Math.min(1,value));

export function createTemplateFrame(stage){
  let enabled=true,strength=1;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frame=document.createElement('div');
  frame.className='templateFrame';frame.setAttribute('aria-hidden','true');
  frame.innerHTML=`<div class="templateEdgeLight"></div>
    <i class="templateCorner cornerTL"></i><i class="templateCorner cornerTR"></i>
    <i class="templateCorner cornerBL"></i><i class="templateCorner cornerBR"></i>
    <div class="templateTop"><i></i><span></span><b></b><span></span><i></i></div>
    <div class="templateSide sideLeft">${'<i></i>'.repeat(17)}</div>
    <div class="templateSide sideRight">${'<i></i>'.repeat(17)}</div>
    <div class="templateBottom"><i></i><span></span><i></i></div>
    <div class="templateTicks ticksLeft"><i></i><i></i><i></i></div>
    <div class="templateTicks ticksRight"><i></i><i></i><i></i></div>`;
  const spectrum=document.createElement('div');spectrum.className='templateSpectrum';
  spectrum.innerHTML='<i></i>'.repeat(65);frame.append(spectrum);
  stage.append(frame);
  const sides=[...frame.querySelectorAll('.templateSide')].map(side=>[...side.children]);
  const spectrumBars=[...spectrum.children];
  function setEnabled(value){enabled=value===true;frame.hidden=!enabled;}
  function setStrength(value){strength=Number.isFinite(value)?Math.max(.3,Math.min(1.4,value)):1;}
  function render(time,audio){
    if(!enabled)return;
    const opening=clamp((time-3.4)/1.2);
    const pulse=reduced?0:clamp(audio.energy*.5+audio.beat*.5);
    frame.style.opacity=String(opening*Math.min(1,.85*strength));
    frame.style.setProperty('--frame-light',String(.3+pulse*.3));
    sides.forEach(bars=>bars.forEach((bar,band)=>{
      const index=Math.round(band/16*12);
      const value=reduced?.2:clamp(audio.bands?.[index]??audio.energy??0);
      bar.style.transform=`scaleX(${.15+value*.85})`;
      bar.style.opacity=String(.32+value*.48);
    }));
    spectrumBars.forEach((bar,band)=>{
      const position=Math.abs(band-32)/32*12;
      const lower=Math.floor(position),upper=Math.min(12,lower+1),blend=position-lower;
      const value=reduced?.2:clamp((audio.bands?.[lower]??0)*(1-blend)+(audio.bands?.[upper]??0)*blend);
      bar.style.transform=`scaleY(${.06+value*.94})`;
      bar.style.opacity=String(.22+value*.34);
    });
  }
  return {render,setEnabled,setStrength};
}
