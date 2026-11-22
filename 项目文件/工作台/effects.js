// Every effect is derived from t; no random values, accumulated state or CSS animations.
const TAU=Math.PI*2;
export function createEffects(){
  const canvas=document.getElementById('atmosphere');canvas.width=1920;canvas.height=1080;
  const c=canvas.getContext('2d');
  const core=document.querySelector('.orbitCore'),glow=document.querySelector('.orbitGlow');
  const spark=document.getElementById('orbitSpark');
  const perimeter=core.getTotalLength();
  const echoes=[...document.querySelectorAll('#echoes rect')];
  const comet=document.getElementById('lyricComet');
  const pvMode=document.querySelector('.lyrics').classList.contains('pv-mode');
  return (t,{beat,bass=0,treble=0,progress,index,k,lines})=>{
    // A slow travelling highlight traces the frame, rather than covering the artwork.
    const loop=t/10;
    core.style.strokeDashoffset=`${-loop}`;
    glow.style.strokeDashoffset=`${-loop+.012}`;
    const point=core.getPointAtLength(((loop+.085)%1)*perimeter);
    spark.setAttribute('cx',point.x);spark.setAttribute('cy',point.y);
    spark.style.opacity=`${.5+.5*beat}`;
    spark.setAttribute('r',(2.6+beat*1.8*k).toFixed(2));
    glow.style.opacity=`${.5+bass*.45*k}`;
    echoes.forEach((el,j)=>{
      const phase=((t+j*1.25)%2.5)/2.5;
      const expand=1+phase*.17;
      el.style.transform=`scale(${expand},${1+phase*.23})`;
      el.style.opacity=`${Math.sin(Math.PI*phase)*Math.pow(1-phase,2)*.48*k}`;
    });
    const lineWidth=pvMode?0:lines[index].querySelector('.base').offsetWidth;
    comet.style.transform=`translateX(${76+lineWidth*progress-100}px)`;
    comet.style.opacity=`${Math.sin(progress*Math.PI)*.65*k}`;
    c.clearRect(0,0,1920,1080);
    c.save();
    // Broken arcs frame the collection; their open side keeps the lyric area clear.
    c.strokeStyle='#ecf5ec';c.lineWidth=.8;c.globalAlpha=.17;
    for(let ring=0;ring<2;ring++){
      const rx=395+ring*25,ry=270+ring*24;
      c.beginPath();c.ellipse(475,455,rx,ry,-.09,Math.PI*1.04,Math.PI*1.86);c.stroke();
      c.beginPath();c.ellipse(475,455,rx,ry,-.09,Math.PI*.15,Math.PI*.46);c.stroke();
    }
    c.globalAlpha=.45;
    for(let i=0;i<5;i++){
      const a=Math.PI*(1.12+i*.16),x=475+420*Math.cos(a),y=455+294*Math.sin(a);
      c.beginPath();c.moveTo(x-3,y);c.lineTo(x+3,y);c.moveTo(x,y-3);c.lineTo(x,y+3);c.stroke();
    }
    c.globalAlpha=1;
    // A quiet field of suspended dust lives around the frame, outside the lyrics.
    for(let i=0;i<22;i++){
      const angle=TAU*(i/22)+Math.sin(t*TAU/10+i)*.07;
      const rx=365+(i%3)*21,ry=265+(i%4)*15;
      const x=473+Math.cos(angle)*rx,y=487+Math.sin(angle)*ry;
      const twinkle=Math.pow(.5+.5*Math.sin(t*TAU/5+i*2.3),3);
      c.fillStyle=`rgba(183,239,222,${(.06+twinkle*(.36+treble*.45))*k})`;
      c.shadowColor='#b6f4e5';c.shadowBlur=8;
      c.beginPath();c.arc(x,y,.7+(i%3)*.4,0,TAU);c.fill();
    }
    c.shadowBlur=0;
    // A few hairline wave filaments connect the cover and the quiet space below the lyrics.
    const color=c.createLinearGradient(695,0,1220,0);
    color.addColorStop(0,'#a6e9df00');color.addColorStop(.3,'#a6e9df55');color.addColorStop(.65,'#a6e9df22');color.addColorStop(1,'#a6e9df00');
    c.strokeStyle=color;c.lineWidth=.8;
    for(let j=0;j<5;j++){
      c.globalAlpha=(.25+j*.1)*k;c.beginPath();
      for(let x=690;x<=1260;x+=4){
        const u=(x-690)/570,envelope=Math.pow(Math.sin(Math.PI*u),2);
        const y=791+j*6+Math.sin(u*TAU*1.4-t*TAU/2.5+j*.4)*(12+beat*15)*envelope;
        if(x===690)c.moveTo(x,y);else c.lineTo(x,y);
      }c.stroke();
    }
    c.restore();
  };
}
