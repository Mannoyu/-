import { SONG } from '../../song-data.js';
import { createVideoElements, createMediaSampler } from '../../media.js';

const width = 1920;
const height = 1080;
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => 1 - (1 - clamp(value)) ** 3;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sampler = createMediaSampler(createVideoElements(), true);
const stage = document.getElementById('stage');
const context = document.getElementById('image').getContext('2d');
const root = document.getElementById('lyric-stage');
document.getElementById('title').textContent = SONG.title;
document.getElementById('artist').textContent = SONG.artist;

function appendLine(parent, className, text, lang) {
  if (!text?.trim()) return;
  const line = document.createElement('p');
  line.className = className;
  line.textContent = text.trim().replace(/\u3000+/g, ' ');
  line.lang = lang;
  parent.append(line);
}

const lyrics = SONG.lyrics.map(({ text, translation }) => {
  const quote = text.match(/^(.*?)(“[^”]+”|"[^"]+")(.*)$/);
  const article = document.createElement('article');
  article.className = quote ? 'lyric featured' : 'lyric';
  article.setAttribute('aria-hidden', 'true');
  if (quote) {
    appendLine(article, 'lead', quote[1], 'ja');
    appendLine(article, 'headline', quote[2], 'en');
    appendLine(article, 'tail', quote[3], 'ja');
  } else {
    appendLine(article, 'headline', text, 'ja');
  }
  appendLine(article, 'translation', translation, 'zh-CN');
  root.append(article);
  return article;
});

const lowerShade = context.createLinearGradient(0, 400, 0, height);
lowerShade.addColorStop(0, '#130d1c00');
lowerShade.addColorStop(.38, '#130d1c39');
lowerShade.addColorStop(.72, '#130d1ca6');
lowerShade.addColorStop(1, '#130d1ce8');
const topShade = context.createLinearGradient(0, 0, 0, 220);
topShade.addColorStop(0, '#120e1d83');
topShade.addColorStop(1, '#120e1d00');

function drawShot(source, time, sceneStart, focus, cutDistance) {
  const drift = reduced ? 0 : .029 * ease((time - sceneStart) / 12);
  const scale = Math.max(width / source.videoWidth, height / source.videoHeight) * (1.005 + drift);
  const drawnWidth = source.videoWidth * scale;
  const drawnHeight = source.videoHeight * scale;
  context.drawImage(source, (width - drawnWidth) * focus, (height - drawnHeight) * .43, drawnWidth, drawnHeight);
  context.fillStyle = lowerShade;
  context.fillRect(0, 0, width, height);
  context.fillStyle = topShade;
  context.fillRect(0, 0, width, 220);
  if (!reduced && cutDistance < .15) {
    context.fillStyle = `rgba(19, 13, 28, ${.36 * (1 - cutDistance / .15) ** 2})`;
    context.fillRect(0, 0, width, height);
  }
}

let activeLyric = -1;
window.READY = false;
window.render = async time => {
  const position = Math.max(0, Math.min(SONG.duration - .02, time));
  const frames = await sampler.at(position);
  const cueIndex = SONG.cues.findLastIndex(cue => cue <= position);
  const active = (cueIndex + 1) % frames.length;
  const sceneStart = SONG.cues[cueIndex] ?? 0;
  const cutDistance = Math.min(...SONG.cues.map(cue => Math.abs(cue - position)));
  const { accent, focus } = SONG.videos[active];
  const tint = accent.map(channel => Math.round(226 * .6 + channel * .4));
  stage.style.setProperty('--ink-accent', `rgb(${tint.join(',')})`);
  drawShot(frames[active], position, sceneStart, focus, cutDistance);

  const index = Math.max(0, SONG.lyrics.findLastIndex(line => line.time <= position));
  if (index !== activeLyric) {
    if (activeLyric >= 0) {
      lyrics[activeLyric].style.visibility = 'hidden';
      lyrics[activeLyric].setAttribute('aria-hidden', 'true');
    }
    activeLyric = index;
    lyrics[index].style.visibility = 'visible';
    lyrics[index].setAttribute('aria-hidden', 'false');
  }
  const article = lyrics[index];
  const local = position - SONG.lyrics[index].time;
  const featured = article.classList.contains('featured');
  const entrance = reduced ? 1 : ease(local / (featured ? .31 : .2));
  article.style.opacity = String(.25 + entrance * .75);
  article.style.transform = `translateY(${(1 - entrance) * (featured ? 14 : 8)}px)`;
  window.SCENE_STATE = { time: position, index, active };
};

await document.fonts.ready;
await window.render(45.5);
window.READY = true;
