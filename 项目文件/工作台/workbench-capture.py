import ctypes
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Event

sys.path.insert(0, str(Path(__file__).resolve().parent / 'workspace' / 'capture-deps'))


def select_encoder():
    binary_folder = Path(__file__).resolve().parent.parent / '素材处理工具' / 'bin'
    candidates = [os.environ.get('MUSIC_CAPTURE_FFMPEG'),
                  str(binary_folder / 'ffmpeg810.exe'), str(binary_folder / 'ffmpeg8.exe'),
                  shutil.which('ffmpeg')]
    available = list(dict.fromkeys(candidate for candidate in candidates if candidate and Path(candidate).is_file()))
    for candidate in available:
        result = subprocess.run([candidate, '-nostdin', '-v', 'error', '-f', 'lavfi',
                                 '-i', 'color=size=1920x1080:rate=60', '-frames:v', '4',
                                 '-c:v', 'h264_nvenc', '-f', 'null', '-'],
                                capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode == 0:
            return candidate, ['-c:v', 'h264_nvenc', '-preset', 'p2', '-rc', 'vbr', '-cq', '15', '-b:v', '0']
    if not available:
        raise RuntimeError('找不到视频编码器 FFmpeg')
    return available[0], ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '15', '-threads', '4']


def write_timed_frames(write, frames, initial, started, seconds, fps, closed, metrics=None):
    frame_count = seconds * fps
    deadline = started + seconds
    next_index = 0
    previous = initial
    while not closed.is_set():
        remaining = max(0, deadline - time.monotonic())
        try:
            captured, pixels = frames.get(timeout=remaining)
        except Empty:
            break
        index = min(frame_count, max(0, math.ceil((captured - started) * fps)))
        while next_index < index and not closed.is_set():
            before = time.monotonic()
            write(previous)
            if metrics is not None:
                metrics['maxWriteSeconds'] = max(metrics['maxWriteSeconds'], time.monotonic() - before)
            next_index += 1
        previous = pixels
    while next_index < frame_count and not closed.is_set():
        write(previous)
        next_index += 1
    if closed.is_set():
        raise RuntimeError('采集中壁纸窗口已关闭或改变大小')


def capture_window(engine, project, title, seconds, output):
    try:
        import cv2
        from windows_capture import WindowsCapture
    except ImportError as error:
        raise RuntimeError('缺少 Windows Graphics Capture 依赖 windows-capture 2.0.1') from error
    cv2.setNumThreads(2)
    render_width, render_height = 1920, 1080
    user = ctypes.windll.user32
    user.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    user.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
    user.FindWindowW.restype = wintypes.HWND
    command = [engine, '-control']
    flags = subprocess.CREATE_NO_WINDOW
    session = None
    handle = None
    stop_requested = Event()
    capture_stopped = Event()
    try:
        ffmpeg, encoder = select_encoder()
        subprocess.run(command + ['openWallpaper', '-file', project, '-playInWindow', title,
                                  '-width', str(render_width), '-height', str(render_height), '-activate', '1', '-borderless', '1'],
                       check=True, timeout=15, creationflags=flags)
        deadline = time.monotonic() + 12
        while not handle and time.monotonic() < deadline:
            handle = user.FindWindowW(None, title)
            if not handle:
                time.sleep(.1)
        if not handle:
            raise RuntimeError('没有找到壁纸窗口，请确认 Wallpaper Engine 正在运行')
        user.SetWindowPos(wintypes.HWND(handle), wintypes.HWND(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)
        user.SetForegroundWindow(wintypes.HWND(handle))
        time.sleep(1)
        window = wintypes.RECT()
        client = wintypes.RECT()
        if user.GetWindowRect(handle, ctypes.byref(window)) and user.GetClientRect(handle, ctypes.byref(client)):
            user.SetWindowPos(wintypes.HWND(handle), wintypes.HWND(-1), 0, 0,
                              render_width + window.right - window.left - client.right,
                              render_height + window.bottom - window.top - client.bottom, 0x0002 | 0x0040)
        time.sleep(.5)

        outer = wintypes.RECT()
        client = wintypes.RECT()
        origin = wintypes.POINT()
        dwm = ctypes.windll.dwmapi
        if (dwm.DwmGetWindowAttribute(wintypes.HWND(handle), 9, ctypes.byref(outer), ctypes.sizeof(outer)) or
                not user.GetClientRect(wintypes.HWND(handle), ctypes.byref(client)) or
                not user.ClientToScreen(wintypes.HWND(handle), ctypes.byref(origin))):
            raise RuntimeError('无法读取壁纸窗口的画面范围')
        left, top = origin.x - outer.left, origin.y - outer.top
        width, height = client.right & ~1, client.bottom & ~1

        capture = WindowsCapture(window_hwnd=handle, cursor_capture=False, draw_border=False)
        changed = Event()
        closed = Event()
        latest = None
        updates = 0
        has_picture = False
        frames = Queue(maxsize=60)
        capture_range = None
        metrics = {'callbacks': 0, 'queueDrops': 0, 'maxGapSeconds': 0, 'maxWriteSeconds': 0,
                   'maxConvertSeconds': 0, 'encoder': encoder[1]}
        previous_capture = None

        @capture.event
        def on_frame_arrived(frame, control):
            nonlocal latest, updates, has_picture, previous_capture
            captured = time.monotonic()
            if stop_requested.is_set() or (capture_range is not None and captured >= capture_range[1]):
                stop_requested.set()
                control.stop()
                return
            if (left < 0 or top < 0 or left + width > frame.width or top + height > frame.height):
                closed.set()
                changed.set()
                control.stop()
                return
            pixels = frame.frame_buffer[top:top + height, left:left + width]
            if not has_picture:
                sample = pixels[::24, ::24, :3]
                if float(sample.std()) < 1.5:
                    return
                has_picture = True
            active = capture_range
            if active is None:
                latest = cv2.cvtColor(pixels, cv2.COLOR_BGRA2YUV_I420).tobytes()
                changed.set()
                return
            started, deadline = active
            if started <= captured < deadline:
                metrics['callbacks'] += 1
                metrics['maxGapSeconds'] = max(metrics['maxGapSeconds'], captured - (previous_capture or started))
                previous_capture = captured
                if frames.full():
                    metrics['queueDrops'] += 1
                    return
                try:
                    encoded_pixels = cv2.cvtColor(pixels, cv2.COLOR_BGRA2YUV_I420).tobytes()
                    metrics['maxConvertSeconds'] = max(metrics['maxConvertSeconds'], time.monotonic() - captured)
                    frames.put_nowait((captured, encoded_pixels))
                    updates += 1
                except Full:
                    pass

        @capture.event
        def on_closed():
            if not stop_requested.is_set():
                closed.set()
            capture_stopped.set()
            changed.set()

        session = capture.start_free_threaded()
        if not changed.wait(10) or latest is None or closed.is_set():
            raise RuntimeError('壁纸窗口没有渲染可用画面，采集已停止')
        time.sleep(2)
        if (width, height) != (render_width, render_height):
            raise RuntimeError(f'窗口实际尺寸为 {width}×{height}，无法采集原生 1080p')
        fps = 60
        folder = Path(output).parent
        required = width * height * 3 // 2 * fps * seconds
        if shutil.disk_usage(folder).free < required + 512 * 1024 ** 2:
            raise RuntimeError(f'原生采集需要约 {required / 1024 ** 3:.1f} GiB 临时空间，请缩短录制或释放磁盘空间')
        with tempfile.TemporaryDirectory(dir=folder) as scratch:
            raw = Path(scratch) / 'frames.yuv'
            with raw.open('wb') as stream:
                started = time.monotonic()
                capture_range = (started, started + seconds)
                write_timed_frames(stream.write, frames, latest, started, seconds, fps, closed, metrics)
            stop_requested.set()
            user.PostMessageW(wintypes.HWND(handle), 0x0010, 0, 0)
            handle = None
            capture_stopped.wait(2)
            subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p',
                            '-video_size', f'{width}x{height}', '-framerate', str(fps), '-i', str(raw),
                            *encoder, '-pix_fmt', 'yuv420p', '-colorspace', 'smpte170m', '-color_primaries',
                            'bt709', '-color_trc', 'iec61966-2-1', '-movflags', '+faststart', output],
                           check=True, timeout=max(30, seconds + 15), creationflags=flags)
        metrics['captureFps'] = round(updates / seconds, 2)
        metrics['maxGapSeconds'] = max(metrics['maxGapSeconds'], started + seconds - (previous_capture or started))
        metrics['width'], metrics['height'] = width, height
        Path(output + '.json').write_text(json.dumps(metrics), encoding='utf-8')
        print(round(updates / seconds), flush=True)
        return metrics
    finally:
        stop_requested.set()
        if handle:
            user.PostMessageW(wintypes.HWND(handle), 0x0010, 0, 0)
        if session and not session.is_finished():
            capture_stopped.wait(2)


if __name__ == '__main__':
    engine, project, title, seconds, output, *options = sys.argv[1:]
    try:
        capture_window(engine, project, title, int(seconds), output)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
