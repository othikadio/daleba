# Mixe une piste de base (voix/musique) + les effets sonores des cues.
import json, sys, numpy as np, soundfile as sf
base, sr = sf.read(sys.argv[1], always_2d=True); cues = json.load(open(sys.argv[2])); sfxdir = sys.argv[3]; out = sys.argv[4]
fxgain = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
rng = np.random.default_rng(7); fx = np.zeros_like(base); cache = {}
for c in cues:
    fn = c['id'].replace('/', '_') + '.wav'
    if fn not in cache:
        a, _ = sf.read(f"{sfxdir}/{fn}", always_2d=True)
        cache[fn] = np.repeat(a, 2, 1) if a.shape[1] == 1 else a[:, :2]
    a = cache[fn] * 10 ** ((c['db'] + fxgain + rng.uniform(-1.5, 1.5)) / 20)
    s = int(c['t'] * sr)
    if s < 0: a = a[-s:]; s = 0
    e = min(len(fx), s + len(a)); fx[s:e] += a[:e - s]
mix = base + fx; pk = np.max(np.abs(mix)); mix *= min(1, 0.89 / pk)
sf.write(out, mix, sr, subtype='PCM_24'); print('peak', round(float(pk), 3), len(cues), 'cues')
