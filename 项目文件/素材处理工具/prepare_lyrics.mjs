import fs from 'node:fs';
const root='C:/Users/123/Desktop/视频/音乐可视化项目/项目文件/工作台';
const entries=fs.readFileSync(`${root}/assets/lyrics-source.lrc`,'utf8').split(/\r?\n/).flatMap(line=>{
  const m=/^\[(\d+):(\d+\.\d+)\](.*)$/.exec(line);
  return m&&m[3].trim()?[{time:Number(m[1])*60+Number(m[2]),text:m[3].trim()}]:[];
});
const lyrics=entries.slice(0,3).map((line,i)=>({...line,translation:i===0?'松下優也 · Mr. Broken Heart':i===1?'作词':'作曲',kind:'credit'}));
for(let i=3;i<entries.length;i+=2){
  const original=entries[i],translation=entries[i+1];
  if(!translation||translation.time<=original.time)throw Error(`Invalid bilingual cue ${i}`);
  lyrics.push({...original,translation:translation.text,end:translation.time,kind:'lyric'});
}
lyrics.push({time:207.01,end:218.3333333333,text:'Mr. Broken Heart',translation:'松下優也',kind:'outro'});
lyrics.sort((a,b)=>a.time-b.time);
lyrics.forEach((line,i)=>{line.end=Math.min(line.end??Infinity,lyrics[i+1]?.time??218.3333333333);});
fs.writeFileSync(`${root}/lyrics-data.js`,`// Supplied LRC: translation timestamps mark the END of their corresponding original.\n// Only line timing is supplied; the highlight is a visual sweep, not word alignment.\nexport const LYRICS = ${JSON.stringify(lyrics,null,2)};\n`);
console.log(JSON.stringify({cues:lyrics.length,lyrics:lyrics.filter(x=>x.kind==='lyric').length,first:lyrics[3],last:lyrics.at(-2)}));
