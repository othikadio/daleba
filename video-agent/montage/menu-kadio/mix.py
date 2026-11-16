"""Mixe voix off + musique (baissée sous la voix) + effets sonores.

usage: python3 -I mix.py <video_dir> <vo_dir> <sfx_dir> <out.wav>
"""
import json, os, sys, numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly

vdir, vodir, sfxdir, out = sys.argv[1:5]
SR = 48000
cues = json.load(open(os.path.join(vdir, "cues.json")))
vo = json.load(open(os.path.join(vdir, "vo.json")))
html = open(os.path.join(vdir, "index.html")).read()
DUR = float(html.split('data-composition-id="main" data-start="0" data-duration="')[1].split('"')[0])
N = int(SR * DUR); t = np.arange(N) / SR
rng = np.random.default_rng(11)

# --- musique : pop douce 112 BPM ---
bpm = 112; beat = 60 / bpm; bar = 4 * beat
note = lambda m: 440 * 2 ** ((m - 69) / 12)
chords = [[53, 57, 60, 64], [57, 60, 64, 67], [50, 53, 57, 60], [46, 50, 53, 57]]
mus = np.zeros(N)
for k in range(int(DUR / bar) + 1):
    s = int(k * bar * SR); e = min(N, int((k + 1) * bar * SR))
    if s >= N: break
    tt = t[s:e] - t[s]; env = np.minimum(1, tt / .25) * np.exp(-tt * .35)
    for m in chords[k % 4]:
        for det in (-.12, .12):
            f = note(m + 12) * 2 ** (det / 12)
            mus[s:e] += env * (np.sin(2 * np.pi * f * tt) + .3 * np.sin(4 * np.pi * f * tt)) / 8
    f = note(chords[k % 4][0] - 12); mus[s:e] += .35 * np.sin(2 * np.pi * f * tt) * np.exp(-((tt % beat) * 3))
mus = sosfilt(butter(2, 2200, fs=SR, output="sos"), mus)
for i in range(int(DUR / (beat / 2))):
    s = int(i * beat / 2 * SR); L = int(.3 * SR)
    if s + L > N: break
    ch = chords[int(i * beat / 2 / bar) % 4]; tt = np.arange(L) / SR
    mus[s:s + L] += .12 * np.sin(2 * np.pi * note(ch[i % 4] + 24) * tt) * np.exp(-tt * 14)
for i in range(int(DUR / beat)):
    s = int(i * beat * SR); L = int(.25 * SR)
    if s + L > N: break
    tt = np.arange(L) / SR
    mus[s:s + L] += .55 * np.sin(2 * np.pi * (50 + 90 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 12)
    if i % 2: mus[s:s + L] += .18 * rng.standard_normal(L) * np.exp(-tt * 25)
    h = s + int(beat / 2 * SR); Lh = int(.05 * SR)
    if h + Lh < N:
        mus[h:h + Lh] += .06 * sosfilt(butter(2, 7000, "hp", fs=SR, output="sos"), rng.standard_normal(Lh)) * np.exp(-np.arange(Lh) / SR * 60)
mus *= np.minimum(1, t / .4) * np.minimum(1, (DUR - t) / 1.5)
mus *= 10 ** (-17 / 20) / (np.max(np.abs(mus)) + 1e-9)

# --- voix off ---
voice = np.zeros(N); active = np.zeros(N)
for v in vo:
    a, sr = sf.read(os.path.join(vodir, v["file"]), always_2d=True); a = a.mean(1)
    if sr != SR: a = resample_poly(a, SR, sr)
    a = sosfilt(butter(2, 80, "hp", fs=SR, output="sos"), a)
    rms = np.sqrt(np.mean(a[np.abs(a) > 1e-3] ** 2) + 1e-12); a *= 0.11 / rms  # niveau homogène
    s = int(v["t"] * SR); e = min(N, s + len(a)); voice[s:e] += a[:e - s]; active[max(0, s - 2400):e + 4800] = 1
# ducking : musique -9 dB sous la voix, transitions lissées
k = int(.15 * SR); env = np.convolve(active, np.ones(k) / k, mode="same")
mus *= 10 ** (-9 * env / 20)

# --- effets ---
fx = np.zeros(N); cache = {}
for c in cues:
    fn = c["id"].replace("/", "_") + ".wav"
    if fn not in cache:
        a, _ = sf.read(os.path.join(sfxdir, fn), always_2d=True); cache[fn] = a.mean(1)
    a = cache[fn] * 10 ** ((c["db"] - 3 + rng.uniform(-1.5, 1.5)) / 20)
    s = int(c["t"] * SR)
    if s < 0: a = a[-s:]; s = 0
    e = min(N, s + len(a)); fx[s:e] += a[:e - s]
mix = mus + voice + fx
mix = np.stack([mix, mix], 1); pk = np.max(np.abs(mix)); mix *= min(1, .89 / pk)
sf.write(out, mix, SR, subtype="PCM_24"); print("ok", round(DUR, 2), "s peak", round(float(pk), 2), len(cues), "cues", len(vo), "vo")
