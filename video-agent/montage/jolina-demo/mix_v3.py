"""Mixe musique réelle (baissée sous la voix) + voix off + bruitages réels.
usage: python3 -I mix_v3.py <video_dir> <vo_dir> <sfx_dir> <music.mp3> <music_start> <out.wav>
"""
import json, os, subprocess, sys, numpy as np, soundfile as sf
from scipy.signal import resample_poly

vdir, vodir, sfxdir, music, mstart, out = sys.argv[1:7]
SR = 48000
html = open(os.path.join(vdir, "index.html")).read()
DUR = float(html.split('data-composition-id="main" data-start="0" data-duration="')[1].split('"')[0]); N = int(DUR * SR)
cues = json.load(open(os.path.join(vdir, "cues.json"))); vo = json.load(open(os.path.join(vdir, "vo.json")))
raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", mstart, "-t", f"{DUR + .5}", "-i", music, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True).stdout
mus = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(float)[:N]
mus = np.pad(mus, ((0, N - len(mus)), (0, 0)))
t = np.arange(N) / SR
mus *= (np.minimum(1, t / .05) * np.minimum(1, (DUR - t) / 1.5))[:, None]
mus *= 0.30 / (np.sqrt(np.mean(mus ** 2)) * 4 + 1e-9)

voice = np.zeros(N); active = np.zeros(N)
for v in vo:
    a, sr = sf.read(os.path.join(vodir, v["file"]), always_2d=True); a = a.mean(1)
    if sr != SR: a = resample_poly(a, SR, sr)
    a *= 0.12 / (np.sqrt(np.mean(a[np.abs(a) > 1e-3] ** 2)) + 1e-12)
    s = int(v["t"] * SR); e = min(N, s + len(a)); voice[s:e] += a[:e - s]; active[max(0, s - 4800):e + 7200] = 1
k = int(.2 * SR); env = np.convolve(active, np.ones(k) / k, mode="same")
mus *= (10 ** (-11 * env / 20))[:, None]   # musique -11 dB sous la voix

fx = np.zeros((N, 2)); cache = {}
for c in cues:
    if c["file"] not in cache:
        a, sr = sf.read(os.path.join(sfxdir, c["file"]), always_2d=True)
        cache[c["file"]] = (a if a.shape[1] == 2 else np.repeat(a, 2, 1)) / (np.max(np.abs(a)) + 1e-9)
    a = cache[c["file"]] * c["gain"] * 0.35
    s = max(0, int(c["t"] * SR)); e = min(N, s + len(a)); fx[s:e] += a[:e - s]
mix = mus + voice[:, None] + fx
mix *= min(1, .89 / np.max(np.abs(mix)))
sf.write(out, mix, SR, subtype="PCM_24"); print("ok", DUR, len(cues), "bruitages", len(vo), "voix")
