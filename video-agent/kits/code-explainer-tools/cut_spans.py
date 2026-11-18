# Cut spans out of a wav with 20 ms fades. Usage: python tools/cut_spans.py in.wav out.wav s1-e1 s2-e2 ...
import sys, numpy as np, scipy.io.wavfile as wf
sr, a = wf.read(sys.argv[1]); a = a.astype(np.float32)
spans = [tuple(map(float, s.split('-'))) for s in sys.argv[3:]]
keep, pos, f = [], 0, int(0.02 * sr)
for s, e in sorted(spans):
    keep.append(a[pos:int(s * sr)].copy()); pos = int(e * sr)
keep.append(a[pos:].copy())
ramp = np.linspace(0, 1, f).reshape(-1, *([1] * (a.ndim - 1)))
for i, k in enumerate(keep):
    if i > 0 and len(k) > f: k[:f] *= ramp
    if i < len(keep) - 1 and len(k) > f: k[-f:] *= ramp[::-1]
out = np.concatenate(keep)
wf.write(sys.argv[2], sr, np.clip(out, -32768, 32767).astype(np.int16))
print(sys.argv[2], round(len(out) / sr, 2), 's')
