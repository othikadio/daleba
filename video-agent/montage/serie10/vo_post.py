"""Nettoie la voix : coupe le charabia après le dernier mot attendu (horodatage whisper) + tonalité.
usage: python3 vo_post.py <video_id>  → <video>/vo/vo_i.wav (48 kHz) et rapport de transcription"""
import json, os, sys, re, subprocess, unicodedata
from faster_whisper import WhisperModel
V = sys.argv[1]; R = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(R, V, "vo")
TXT = json.load(open(os.path.join(R, "spec.json")))[V]["vo"]
m = WhisperModel("small", device="cpu", compute_type="int8")
norm = lambda s: re.sub(r"[^a-z0-9 ]", " ", unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()).split()
AF = ("highpass=f=70,equalizer=f=170:t=q:w=1:g=1.5,equalizer=f=3100:t=q:w=1.2:g=2.5,equalizer=f=10000:t=q:w=1:g=1.5,"
      "acompressor=threshold=-18dB:ratio=2.5:attack=8:release=120,alimiter=limit=0.9")
rep = []
for i, txt in enumerate(TXT):
    raw = os.path.join(D, f"raw_{i}.wav")
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", raw, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
    import numpy as np
    segs, _ = m.transcribe(np.frombuffer(pcm, np.float32), language="fr", word_timestamps=True, vad_filter=False)
    words = [w for s in segs for w in s.words]
    heard = " ".join(w.word.strip() for w in words)
    want = norm(txt); n = len(want); hn = len(norm(heard))
    # par défaut on garde jusqu'au dernier mot entendu ; s'il y a du charabia en trop, on coupe au n-ième mot
    end = words[-1].end if words else None
    if words and hn > n + 1: end = words[min(len(words), n) - 1].end
    end = (end or 30) + .18
    out = os.path.join(D, f"vo_{i}.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-t", f"{end:.2f}", "-af", AF + ",afade=t=out:st=%.2f:d=0.08" % max(0, end - .08), "-ar", "48000", out], check=True)
    extra = len(norm(heard)) - n
    rep.append(f"{i}: {heard}  [coupé à {end:.2f}s{', +%d mots en trop' % extra if extra > 0 else ''}]")
    print(rep[-1], flush=True)
open(os.path.join(D, "transcription.txt"), "w").write("\n".join(rep))
