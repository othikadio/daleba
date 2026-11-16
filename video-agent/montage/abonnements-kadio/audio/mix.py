import json, sys, numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt
SR = 48000; DUR = 28.0; N = int(SR * DUR)
cues = json.load(open(sys.argv[1])); sfxdir = sys.argv[2]; out = sys.argv[3]
rng = np.random.default_rng(7)

# --- fond musical : pop douce 112 BPM, accords Fmaj7 Am7 Dm7 Bbmaj7 ---
bpm = 112; beat = 60 / bpm; t = np.arange(N) / SR
def note(f): return 440 * 2 ** ((f - 69) / 12)
chords = [[53, 57, 60, 64], [57, 60, 64, 67], [50, 53, 57, 60], [46, 50, 53, 57]]
pad = np.zeros(N)
bar = 4 * beat
for k in range(int(DUR / bar) + 1):
    s = int(k * bar * SR); e = min(N, int((k + 1) * bar * SR))
    if s >= N: break
    tt = t[s:e] - t[s]; env = np.minimum(1, tt / 0.25) * np.exp(-tt * 0.35)
    for m in chords[k % 4]:
        for det in (-0.12, 0.12):
            f = note(m + 12) * 2 ** (det / 12)
            pad[s:e] += env * (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)) / 8
    # basse
    f = note(chords[k % 4][0] - 12)
    pad[s:e] += 0.35 * np.sin(2 * np.pi * f * tt) * np.exp(-((tt % beat) * 3))
pad = sosfilt(butter(2, 2200, fs=SR, output='sos'), pad)
# pluck arpège sur les croches
arp = np.zeros(N)
for i in range(int(DUR / (beat / 2))):
    s = int(i * beat / 2 * SR); L = int(0.3 * SR)
    if s + L > N: break
    ch = chords[int(i * beat / 2 / bar) % 4]; f = note(ch[i % 4] + 24)
    tt = np.arange(L) / SR
    arp[s:s + L] += 0.12 * np.sin(2 * np.pi * f * tt) * np.exp(-tt * 14)
# kick + clap + hihat
drums = np.zeros(N)
for i in range(int(DUR / beat)):
    s = int(i * beat * SR); L = int(0.25 * SR)
    if s + L > N: break
    tt = np.arange(L) / SR
    drums[s:s + L] += 0.55 * np.sin(2 * np.pi * (50 + 90 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 12)
    if i % 2 == 1:
        drums[s:s + L] += 0.18 * rng.standard_normal(L) * np.exp(-tt * 25)
    h = s + int(beat / 2 * SR); Lh = int(0.05 * SR)
    if h + Lh < N:
        drums[h:h + Lh] += 0.06 * sosfilt(butter(2, 7000, 'hp', fs=SR, output='sos'), rng.standard_normal(Lh)) * np.exp(-np.arange(Lh) / SR * 60)
music = pad + arp + drums
music *= np.minimum(1, t / 0.4) * np.minimum(1, (DUR - t) / 1.2)
music = np.stack([music, music], 1)
music *= 10 ** (-20 / 20) / (np.max(np.abs(music)) + 1e-9)

# --- effets sonores ---
fx = np.zeros((N, 2)); cache = {}
for c in cues:
    fn = c['id'].replace('/', '_') + '.wav'
    if fn not in cache:
        a, sr = sf.read(f"{sfxdir}/{fn}", always_2d=True)
        if a.shape[1] == 1: a = np.repeat(a, 2, 1)
        cache[fn] = a[:, :2]
    a = cache[fn] * 10 ** ((c['db'] + rng.uniform(-1.5, 1.5)) / 20)
    pan = rng.uniform(-0.25, 0.25) if 'typing' in fn else 0
    a = a * np.array([1 - pan, 1 + pan])
    s = int(c['t'] * SR)
    if s < 0: a = a[-s:]; s = 0
    e = min(N, s + len(a)); fx[s:e] += a[:e - s]
mix = music + fx
peak = np.max(np.abs(mix)); mix *= min(1, 0.89 / peak)
sf.write(out, mix, SR, subtype='PCM_24')
print('peak', round(float(peak), 3), 'cues', len(cues))
