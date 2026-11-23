export const ELEMENTS=[['background','背景'],['cards','卡片组'],['card0','卡片 1'],['card1','卡片 2'],['card2','卡片 3'],['card3','卡片 4'],['title','右侧标题'],['artist','副标题 / 歌手'],['lyrics','字幕'],['progress','播放进度'],['cardGlow','卡片光晕'],['cardNav','卡片指示器'],['atmosphere','氛围光效'],['shade','背景遮罩'],['vignette','暗角']];
export const ANIMATIONS=[['default','原始动画'],['none','无动画'],['fade','淡入'],['rise','向上进入'],['slide','从右进入'],['zoom','缩放进入']];
const num=(v,a,b,d)=>Number.isFinite(v)?Math.max(a,Math.min(b,v)):d;
export function normalizeElement(v={},elementId){
  return {x:num(v.x,-1920,1920,0),y:num(v.y,-1080,1080,0),scale:num(v.scale,.1,4,1),rotation:num(v.rotation,-180,180,0),opacity:num(v.opacity,0,1,1),visible:v.visible!==false,
    animation:ANIMATIONS.some(([id])=>id===v.animation)?v.animation:'default',delay:num(v.delay,0,3600,0),duration:num(v.duration,1/60,10,.65),
    color:/^#[\da-f]{6}$/i.test(v.color)?v.color:'',fontSize:v.fontSize>0?num(v.fontSize,12,200,0):0,
    ...(elementId==='title'&&v.ink==='flow'?{ink:'flow'}:{}),
    ...(elementId==='cards'&&['filmstrip','glass-filmstrip'].includes(v.cardLayout)?{cardLayout:v.cardLayout}:{}),
    cardTitle:typeof v.cardTitle==='string'?v.cardTitle.slice(0,120):'',cardNumber:typeof v.cardNumber==='string'?v.cardNumber.slice(0,20):'',cardCollection:typeof v.cardCollection==='string'?v.cardCollection.slice(0,80):'LIVE COLLECTION',captionVisible:v.captionVisible!==false};
}
export function normalizeElements(value={}){
  return Object.fromEntries(ELEMENTS.map(([id])=>[id,normalizeElement(value?.[id],id)]));
}
export function entranceAt(value,time){
  const v=normalizeElement(value),p=Math.max(0,Math.min(1,(time-v.delay)/v.duration)),e=1-(1-p)**3;
  if(v.animation==='default'||v.animation==='none')return {alpha:1,x:0,y:0,scale:1};
  return {alpha:e,x:v.animation==='slide'?(1-e)*100:0,y:v.animation==='rise'?(1-e)*80:0,scale:v.animation==='zoom'?.65+.35*e:1};
}
