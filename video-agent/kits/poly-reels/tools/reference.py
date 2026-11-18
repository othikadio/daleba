# Studies a reference video or audio file so a new script can follow its structure.
# Usage: python reference.py <file> <output folder>     Writes transcript.txt (timed lines) and sheet.jpg (frames).
import sys, os, subprocess
import numpy as np
try:
    import torch; os.add_dll_directory(os.path.join(os.path.dirname(torch.__file__), "lib"))
except Exception: pass
import ctranslate2
from faster_whisper import WhisperModel
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True).stdout
pcm = np.frombuffer(raw, np.int16).astype(np.float32) / 32768; dur = len(pcm) / 16000
gpu = ctranslate2.get_cuda_device_count() > 0
m = WhisperModel("large-v3-turbo" if gpu else "small", device="cuda" if gpu else "cpu", compute_type="float16" if gpu else "int8")
segs, info = m.transcribe(pcm, vad_filter=True)
lines = [f"[{s.start:6.1f}] {s.text.strip()}" for s in segs]
open(os.path.join(out, "transcript.txt"), "w", encoding="utf-8").write(f"language {info.language}, {dur:.1f} s, {len(lines)} lines\n" + "\n".join(lines))
try:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"fps={24 / dur:.4f},scale=270:-2,tile=8x3", "-frames:v", "1", os.path.join(out, "sheet.jpg")], check=True)
except subprocess.CalledProcessError: print("No video frames, transcript only.")
print("wrote", out, len(lines), "lines")
