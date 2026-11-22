import importlib.util
from pathlib import Path
from queue import Queue
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

source = Path(__file__).resolve().parents[2] / '工作台' / 'workbench-capture.py'
spec = importlib.util.spec_from_file_location('workbench_capture', source)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)

frames = Queue()
frames.put((10.05, b'first'))
frames.put((10.35, b'second'))
output = []
with patch.object(capture.time, 'monotonic', return_value=11):
    capture.write_timed_frames(output.append, frames, b'initial', 10, 1, 10, Event())
assert output == [b'initial', b'first', b'first', b'first'] + [b'second'] * 6, output

output = []
with patch.object(capture.time, 'monotonic', return_value=11):
    capture.write_timed_frames(output.append, Queue(), b'still', 10, 1, 60, Event())
assert len(output) == 60 and set(output) == {b'still'}

closed = Event()
closed.set()
try:
    capture.write_timed_frames(output.append, Queue(), b'still', 10, 1, 60, closed)
except RuntimeError:
    pass
else:
    raise AssertionError('Closed windows must not produce successful recordings')

with patch.dict(capture.os.environ, {'MUSIC_CAPTURE_FFMPEG': str(source)}):
    with patch.object(capture.subprocess, 'run', side_effect=[
        SimpleNamespace(returncode=1), SimpleNamespace(returncode=0),
    ]) as probe:
        binary, encoder = capture.select_encoder()
        assert probe.call_count == 2
        assert Path(binary).name == 'ffmpeg810.exe', binary
        assert encoder[1] == 'h264_nvenc', encoder

print('PASS: timing, delayed frames, window closure and hardware encoder compatibility fallback')
