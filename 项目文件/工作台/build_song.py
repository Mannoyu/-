"""Build song-data.js from song.json: audio analysis, LRC parsing, video frames, section cues.

Usage:  python build_song.py [song.json]
Video frames are reused when assets/frames/<frameDir or id> already holds the expected count.
"""
from pathlib import Path
import json, re, subprocess, sys
import numpy as np
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
CONFIG = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'song.json'
song = json.loads(CONFIG.read_text('utf-8'))
FF = imageio_ffmpeg.get_ffmpeg_exe()
ASSETS, AUDIO = ROOT / 'assets', ROOT / 'audio'
AUDIO.mkdir(exist_ok=True)
FPS = 60


def path_of(value):
    p = Path(value)
    return p if p.is_absolute() else (CONFIG.parent / p).resolve()


def ff(*args):
    subprocess.run([FF, '-v', 'error', '-y', *args], check=True)


def probe_duration(file):
    out = subprocess.run([FF, '-i', str(file)], capture_output=True, text=True, encoding='utf-8', errors='ignore').stderr
    h, m, s = re.search(r'Duration: (\d+):(\d+):([\d.]+)', out).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


# ---------- audio ----------
source = path_of(song['audio'])
duration = round(probe_duration(source) * FPS) / FPS
final = AUDIO / 'final.wav'
ff('-i', str(source), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,apad', '-t', f'{duration:.6f}', '-ar', '48000', '-ac', '2', str(final))
sr, hop, nfft = 22050, 441, 2048
raw = subprocess.check_output([FF, '-v', 'error', '-i', str(final), '-f', 'f32le', '-ac', '1', '-ar', str(sr), '-'])
y = np.frombuffer(raw, dtype='<f4')
centers = np.arange(0, len(y), hop)
yp = np.pad(y, (nfft // 2, nfft))
frames = np.stack([yp[i:i + nfft] for i in centers])
rms = np.sqrt((frames * frames).mean(axis=1))
spec = np.abs(np.fft.rfft(frames * np.hanning(nfft), axis=1))
freq = np.fft.rfftfreq(nfft, 1 / sr)
edges = np.geomspace(55, 12000, 14)
bands = np.stack([np.sqrt((spec[:, (freq >= a) & (freq < b)] ** 2).mean(axis=1)) for a, b in zip(edges[:-1], edges[1:])], axis=1)
bands = np.log1p(bands * 2)
bands = np.clip(bands / np.maximum(np.percentile(bands, 96, axis=0), 1e-8), 0, 1)
flux = np.maximum(0, np.diff(np.log1p(spec), axis=0, prepend=np.log1p(spec[:1]))).mean(axis=1)
flux = np.clip(flux / max(np.percentile(flux, 96), 1e-8), 0, 1)
energy = np.clip(rms / max(np.percentile(rms, 96), 1e-8), 0, 1)
low = np.sqrt((spec[:, (freq >= 35) & (freq < 180)] ** 2).mean(axis=1))
low = np.clip(low / max(np.percentile(low, 96), 1e-8), 0, 1)
step = hop / sr
(AUDIO / 'features.json').write_text(json.dumps({
    'step': step, 'duration': len(y) / sr, 'source': 'final.wav',
    'energy': np.round(energy, 4).tolist(), 'onset': np.round(flux, 4).tolist(),
    'bass': np.round(low, 4).tolist(), 'bands': np.round(bands, 4).tolist()}, separators=(',', ':')), encoding='utf-8')

# ---------- lyrics ----------
CREDIT = re.compile(r'作詞|作词|作曲|編曲|编曲|词[:：]|曲[:：]|Lyrics|Composer', re.I)


def parse_lrc(file):
    rows = []
    for line in path_of(file).read_text('utf-8-sig').splitlines():
        stamps = re.findall(r'\[(\d+):(\d+(?:\.\d+)?)\]', line)
        text = re.sub(r'\[[^\]]*\]', '', line).strip()
        for m, s in stamps:
            rows.append((int(m) * 60 + float(s), text))
    return sorted(rows, key=lambda r: r[0])


rows = parse_lrc(song['lyrics'])
mode = song.get('translation', 'none')
lines = []
if mode == 'interleaved':
    # Original line, then its translation stamped at the original's end time.
    i = 0
    while i < len(rows):
        t, text = rows[i]
        if not text:
            i += 1; continue
        nxt = rows[i + 1][1] if i + 1 < len(rows) else ''
        lines.append({'time': t, 'text': text, 'translation': nxt})
        i += 2
else:
    extra = {round(t, 2): x for t, x in parse_lrc(song['translationLyrics'])} if song.get('translationLyrics') else {}
    lines = [{'time': t, 'text': x, 'translation': extra.get(round(t, 2), '')} for t, x in rows if x]
for i, line in enumerate(lines):
    line['end'] = lines[i + 1]['time'] if i + 1 < len(lines) else min(duration, line['time'] + 8)
    line['kind'] = 'credit' if (i == 0 and line['time'] < 1) or CREDIT.search(line['text']) else 'lyric'
if lines and duration - lines[-1]['end'] > 3:
    lines.append({'time': lines[-1]['end'], 'end': duration, 'text': song['title'], 'translation': song.get('artist', ''), 'kind': 'outro'})
elif lines:
    lines[-1]['end'] = duration
if not lines or lines[0]['time'] > .5:
    lines.insert(0, {'time': 0, 'end': lines[0]['time'] if lines else duration, 'text': song['title'], 'translation': song.get('artist', ''), 'kind': 'intro'})
for line in lines:
    line['time'], line['end'] = round(line['time'], 3), round(line['end'], 3)

# ---------- sections: sustained high energy, snapped to lyric line starts ----------
win = int(4 / step)
smooth = np.convolve(energy, np.ones(win) / win, mode='same')
loud = smooth > np.percentile(smooth, song.get('sectionPercentile', 62))
starts = [l['time'] for l in lines if l['kind'] == 'lyric'] + [l['end'] for l in lines if l['kind'] == 'lyric']
snap = lambda t: min(starts, key=lambda s: abs(s - t)) if starts and min(abs(s - t) for s in starts) < 4 else t
raw_sections, open_at = [], None
for k, v in enumerate(np.append(loud, False)):
    if v and open_at is None: open_at = k
    if not v and open_at is not None:
        raw_sections.append([open_at * step, k * step]); open_at = None
merged = []
for a, b in raw_sections:
    if merged and a - merged[-1][1] < 6: merged[-1][1] = b
    else: merged.append([a, b])
sections = song.get('sections') or [{'start': round(snap(a), 3), 'end': round(snap(b), 3)} for a, b in merged if b - a >= 12]

# ---------- cards: change at each section boundary, otherwise every ~30s ----------
cues = sorted({s['start'] for s in sections} | {s['end'] for s in sections if s['end'] < duration - 4})
if len(cues) < 2:
    cues, last = [], 0
    for l in lines:
        if l['kind'] == 'lyric' and l['time'] - last >= 28: cues.append(l['time']); last = l['time']
cues = [c for i, c in enumerate(cues) if c > 4 and (i == 0 or c - cues[i - 1] >= 6)]

# ---------- videos ----------
videos = []
for index, item in enumerate(song['videos']):
    item = {'file': item} if isinstance(item, str) else item
    vid = item.get('id') or f'v{index + 1}'
    folder = ASSETS / 'frames' / item.get('frameDir', vid)
    folder.mkdir(parents=True, exist_ok=True)
    src = path_of(item['file']) if item.get('file') else None
    loop = item.get('loop') or min(20, probe_duration(src))
    fps = item.get('fps') or 60
    count = int(round(loop * fps))
    if len(list(folder.glob('*.jpg'))) != count:
        for old in folder.glob('*.jpg'): old.unlink()
        ff('-i', str(src), '-t', f'{loop}', '-vf', f'fps={fps},scale=1920:-2', '-q:v', '2', '-start_number', '0', str(folder / '%05d.jpg'))
        count = len(list(folder.glob('*.jpg')))
    preview = ASSETS / f'{vid}-preview.mp4'
    if item.get('preview'): preview = ASSETS / item['preview']
    if not preview.exists():
        ff('-framerate', str(fps), '-i', str(folder / '%05d.jpg'), '-vf', 'scale=960:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-g', '1', '-an', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(preview))
    accent = item.get('accent')
    if not accent:
        # Saturated mid-tones of a middle frame, lifted toward white for legible UI tint.
        sample = subprocess.check_output([FF, '-v', 'error', '-i', str(folder / f'{count // 2:05d}.jpg'), '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
        px = np.frombuffer(sample, np.uint8).reshape(-1, 3).astype(float)
        sat = px.max(1) - px.min(1)
        pick = px[sat >= np.percentile(sat, 75)]
        accent = [int(round(c * .45 + 255 * .55)) for c in pick.mean(0)]
    videos.append({'id': vid, 'name': item.get('name', vid), 'fps': fps, 'duration': count / fps, 'count': count,
                   'preview': f'assets/{preview.name}', 'focus': item.get('focus', .5), 'accent': accent})
    if 'frameDir' in item:
        videos[-1]['frameDir'] = item['frameDir']

data = {'title': song['title'], 'artist': song.get('artist', ''), 'subtitle': song.get('subtitle', ''),
        'tagline': song.get('tagline', ''), 'duration': duration, 'audio': 'audio/final.wav',
        'videos': videos, 'lyrics': lines, 'sections': sections, 'cues': cues,
        'emphasis': song.get('emphasis', [])}
(ROOT / 'song-data.js').write_text('// Generated by build_song.py from song.json. Do not edit by hand.\nexport const SONG = ' + json.dumps(data, ensure_ascii=False, indent=1) + ';\n', encoding='utf-8')
(ROOT / 'editor.json').write_text(json.dumps({'duration': duration, 'size': '1920x1080', 'fps': FPS, 'audio': 'audio/final.wav',
                                              'tracks': [{'id': 'song', 'kind': 'mix', 'file': 'audio/final.wav', 'gain': 1}]}), encoding='utf-8')
print(json.dumps({'duration': duration, 'lines': len(lines), 'sections': sections, 'cues': cues,
                  'videos': [(v['id'], v['count'], v['accent']) for v in videos]}, ensure_ascii=False, indent=1))
