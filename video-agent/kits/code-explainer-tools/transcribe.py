# Word timestamps with faster-whisper. Usage: python tools/transcribe.py <in.wav> <out.json> [lang=en] [model]
# Uses the NVIDIA GPU when available (float16, default model large-v3-turbo: seconds per minute of audio, far better Hindi),
# otherwise CPU int8 with "small". Writes out.json (words) and out.txt (segments).
# Audio is passed as numpy because PyAV open() breaks on some machines.
import sys, os, json
import numpy as np, scipy.io.wavfile as wf
try:  # cuBLAS/cuDNN DLLs ship with the CUDA build of torch; let CTranslate2 find them on Windows
    import torch; os.add_dll_directory(os.path.join(os.path.dirname(torch.__file__), "lib"))
except Exception: pass
import ctranslate2
from faster_whisper import WhisperModel
src, out = sys.argv[1], sys.argv[2]
lang = sys.argv[3] if len(sys.argv) > 3 else "en"
gpu = ctranslate2.get_cuda_device_count() > 0
name = sys.argv[4] if len(sys.argv) > 4 else ("large-v3-turbo" if gpu else "small")
m = WhisperModel(name, device="cuda" if gpu else "cpu", compute_type="float16" if gpu else "int8")
print("whisper", name, "on", "GPU" if gpu else "CPU")
sr, a = wf.read(src); a = a.astype(np.float32) / 32768.0
if a.ndim > 1: a = a.mean(1)
if sr != 16000:  # Whisper expects 16 kHz; a 24 kHz wav otherwise reads 1.5x too long
    import scipy.signal as ss; a = ss.resample_poly(a, 16000, sr)
segs, _ = m.transcribe(a, word_timestamps=True, language=lang, vad_filter=True)
words, lines = [], []
for s in segs:
    lines.append(f"[{s.start:6.2f}-{s.end:6.2f}] {s.text.strip()}")
    for w in s.words: words.append({"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)})
json.dump(words, open(out, "w", encoding="utf-8"), indent=0, ensure_ascii=False)
open(out.replace(".json", ".txt"), "w", encoding="utf-8").write("\n".join(lines))
print(out, len(words), "words")
