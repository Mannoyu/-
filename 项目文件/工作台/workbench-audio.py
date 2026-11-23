import json
import sys
import wave

import numpy as np


def analyze(source, batch_size=128):
    sample_rate = source.getframerate()
    length = source.getnframes()
    hop = sample_rate // 30
    window_size = 2048
    frames = max(1, (length + hop - 1) // hop)
    frequency = np.fft.rfftfreq(window_size, 1 / sample_rate)
    edges = np.geomspace(55, 12000, 14)
    filters = [np.flatnonzero((frequency >= low) & (frequency < high)) for low, high in zip(edges[:-1], edges[1:])]
    bass = np.flatnonzero((frequency >= 35) & (frequency < 180))
    window = np.hanning(window_size)
    previous = None
    values = np.empty((frames, 3 + len(filters)))
    for start in range(0, frames, batch_size):
        count = min(batch_size, frames - start)
        first = start * hop - window_size // 2
        samples = np.zeros((count - 1) * hop + window_size, dtype=np.float32)
        begin, end = max(0, first), min(length, first + len(samples))
        source.setpos(begin)
        pcm = np.frombuffer(source.readframes(end - begin), dtype='<i2').reshape(-1, source.getnchannels())
        samples[begin - first:end - first] = pcm.mean(axis=1, dtype=np.float32) / 32768
        group = np.lib.stride_tricks.sliding_window_view(samples, window_size)[::hop]
        spectrum = np.abs(np.fft.rfft(group * window, axis=1))
        logarithm = np.log1p(spectrum)
        onset = np.maximum(0, np.diff(logarithm, axis=0, prepend=logarithm[:1] if previous is None else previous)).mean(axis=1)
        previous = logarithm[-1:].copy()
        energy = np.sqrt((group ** 2).mean(axis=1))
        low = np.sqrt((spectrum[:, bass] ** 2).mean(axis=1))
        bands = [np.log1p(2 * np.sqrt((spectrum[:, indices] ** 2).mean(axis=1))) for indices in filters]
        values[start:start + count] = np.column_stack([energy, low, onset, *bands])
    values /= np.maximum(np.percentile(values, 96, axis=0), 1e-8)
    np.clip(values, 0, 1, out=values)
    np.round(values, 4, out=values)
    return hop / sample_rate, values


def write_features(destination, step, values):
    destination.write('{"step":' + json.dumps(step))
    for key, column in [('energy', 0), ('bass', 1), ('onset', 2), ('bands', slice(3, None))]:
        destination.write(f',"{key}":[')
        for start in range(0, len(values), 512):
            if start:
                destination.write(',')
            batch = values[start:start + 512, column].tolist()
            destination.write(json.dumps(batch, separators=(',', ':'))[1:-1])
        destination.write(']')
    destination.write('}')


if __name__ == '__main__':
    with wave.open(sys.argv[1], 'rb') as source:
        step, values = analyze(source)
    with open(sys.argv[2], 'w', encoding='utf-8') as destination:
        write_features(destination, step, values)
