import json
import sys
import wave

import numpy as np


def normalize(values):
    return np.clip(values / np.maximum(np.percentile(values, 96, axis=0), 1e-8), 0, 1)


with wave.open(sys.argv[1], 'rb') as source:
    sample_rate = source.getframerate()
    samples = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2')
    samples = samples.reshape(-1, source.getnchannels()).mean(axis=1, dtype=np.float32) / 32768

window_size = 2048
hop = sample_rate // 30
padded = np.pad(samples, (window_size // 2, window_size))
windows = np.lib.stride_tricks.sliding_window_view(padded, window_size)[::hop][:max(1, (len(samples) + hop - 1) // hop)]
frequency = np.fft.rfftfreq(window_size, 1 / sample_rate)
edges = np.geomspace(55, 12000, 14)
filters = [np.flatnonzero((frequency >= low) & (frequency < high)) for low, high in zip(edges[:-1], edges[1:])]
bass = np.flatnonzero((frequency >= 35) & (frequency < 180))
window = np.hanning(window_size)
previous = None
envelopes = []
for start in range(0, len(windows), 512):
    group = windows[start:start + 512]
    spectrum = np.abs(np.fft.rfft(group * window, axis=1))
    logarithm = np.log1p(spectrum)
    onset = np.maximum(0, np.diff(logarithm, axis=0, prepend=logarithm[:1] if previous is None else previous)).mean(axis=1)
    previous = logarithm[-1:]
    energy = np.sqrt((group ** 2).mean(axis=1))
    low = np.sqrt((spectrum[:, bass] ** 2).mean(axis=1))
    bands = [np.log1p(2 * np.sqrt((spectrum[:, indices] ** 2).mean(axis=1))) for indices in filters]
    envelopes.append(np.column_stack([energy, low, onset, *bands]))

values = np.round(normalize(np.concatenate(envelopes)), 4)
with open(sys.argv[2], 'w', encoding='utf-8') as destination:
    json.dump(dict(step=hop / sample_rate, energy=values[:, 0].tolist(), bass=values[:, 1].tolist(),
                   onset=values[:, 2].tolist(), bands=values[:, 3:].tolist()), destination, separators=(',', ':'))
