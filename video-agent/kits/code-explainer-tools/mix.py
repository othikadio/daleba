# Mix voice + SFX cues. Each sample's loudest transient (peak) is aligned to the cue time. Usage: python tools/mix.py new <voice> <out.wav>
import json, sys, subprocess, numpy as np
v, voice, out = sys.argv[1:4]
LIB = "../../sound-effects/"
MAP = {  # kind -> sample (customer library)
 "whoosh": ["Whooshes/Smooth Like A Butter Whoosh.wav", "Whooshes/Whoosh Deep Short.wav", "Whooshes/Smooth And Fast Whoosh.wav"], "swoosh": "Whooshes/Simple Whoosh.wav", "sweep": "Whooshes/Data_Whoosh.wav",
 "click": "Clicks/High Click.wav", "tick": "Clicks/Cinematic Click.wav", "pop": "Pop/Premium And Smooth Pop.wav", "kw": "Pop/Normal Pop.wav",
 "riser": ["Risers/Smooth Riser.wav", "Risers/Premium Riser.wav"], "data": "Data Collect -20261023T175320Z-1-001/Data Collect/Data Collect.wav",
 "glitch": "Data Collect -20261023T175320Z-1-001/Data Collect/Cinematic Data Collect 2.wav", "gear": "Gear/Soft Gear 1.wav",
 "shutter": "Camera Shutters/Smooth Cammera Shutter.wav", "shimmer": "Pop/Sweet UI Open.wav", "ring": "Pop/Sweet UI Open.wav",
 "success": "Pop/Sweet UI Open.wav", "type": "Clicks/Click_2.wav", "shatter": "Camera Shutters/Little Bit Hard Cammera Shutter.wav",
 "stopwatch": "Data Collect -20261023T175320Z-1-001/Data Collect/MA_Tuttkile_Stopwatch_3.wav", "drip": "Pop/Slow And Smooth Pop.wav", "rain": None}
SR = 48000
def load(path, dur=None):
    a = ["ffmpeg", "-v", "error", "-i", path] + (["-t", str(dur)] if dur else []) + ["-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    return np.frombuffer(subprocess.run(a, capture_output=True, check=True).stdout, np.float32).reshape(-1, 2).copy()
data = json.load(open(f"cache/cues_{v}.json"))
vo = load(voice); n = max(len(vo), int(data["DURATION"] * SR) + SR)
bus = np.zeros((n, 2), np.float32); cache = {}; seen = {}
for c in data["cues"]:
    f = MAP[c["k"]]
    if isinstance(f, list): f = f[seen.get(c["k"], 0) % len(f)]; seen[c["k"]] = seen.get(c["k"], 0) + 1  # rotate variants
    if f is None:  # procedural rain bed: filtered noise, 3 s fade in/out
        L = 3 * SR; x = np.random.default_rng(1).standard_normal((L, 2)).astype(np.float32)
        x = np.cumsum(x, 0); x -= np.convolve(x[:, 0], np.ones(400) / 400, "same")[:, None]; x /= np.abs(x).max()
        x *= np.sin(np.linspace(0, np.pi, L))[:, None]; s = load_s = x
    else:
        if f not in cache:
            x = load(LIB + f, 4); x = x[:int(2.5 * SR)]  # trim long tails
            fade = min(len(x), int(.3 * SR)); x[-fade:] *= np.linspace(1, 0, fade)[:, None]; cache[f] = x
        x = cache[f]
    pk = int(np.argmax(np.abs(x[:, 0]))) if c["k"] != "rain" else 0
    st = int(c["t"] * SR) - pk
    if st < 0: x = x[-st:]; st = 0
    e = min(n, st + len(x)); bus[st:e] += x[:e - st] * (10 ** (c["g"] / 20)) / max(1e-6, np.abs(x).max())
mix = bus; mix[:len(vo)] += vo
tmp = out + ".raw.f32"; mix.astype(np.float32).tofile(tmp)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", tmp, "-t", str(data["DURATION"]),
                "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR), out], check=True)
import os; os.remove(tmp); print("mixed", out)
