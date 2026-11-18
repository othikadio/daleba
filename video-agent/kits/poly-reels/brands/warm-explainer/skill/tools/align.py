# Matches a voiceover to the script. Usage: python tools/align.py <video folder> [--lang en] [--wav voice_en.wav]
# Reads episode.json and writes timing_<lang>.json with each line's start/end and each script word's time.
# Captions always show the script's spelling, so Whisper misspellings never reach the screen.
# For Hindi, lines need a `hi` field in Hinglish; Whisper runs on the audio and script words are spread across each line.
import sys, os, json, re, subprocess, difflib
import numpy as np
try:
    import torch; os.add_dll_directory(os.path.join(os.path.dirname(torch.__file__), "lib"))
except Exception: pass
import ctranslate2
from faster_whisper import WhisperModel
a = sys.argv[1:]
ep = a[0]
opt = lambda k, d: a[a.index(k) + 1] if k in a else d
lang = opt("--lang", "en"); wav = opt("--wav", os.path.join(ep, f"voice_{lang}.wav"))
E = json.load(open(os.path.join(ep, "episode.json"), encoding="utf-8"))
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", wav, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True).stdout
pcm = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
dur = len(pcm) / 16000
gpu = ctranslate2.get_cuda_device_count() > 0
m = WhisperModel("large-v3-turbo" if gpu else "small", device="cuda" if gpu else "cpu", compute_type="float16" if gpu else "int8")
segs, _ = m.transcribe(pcm, word_timestamps=True, language=lang, vad_filter=True)
heard = [{"w": w.word.strip(), "s": float(w.start), "e": float(w.end)} for s in segs for w in s.words]
norm = lambda s: re.sub(r"[^\w]", "", s.lower())
script = []
for i, l in enumerate(E["lines"]):
    # <tags> direct the voice only, so they never reach the captions.
    for w in re.sub(r"<[^>]*>", " ", l.get(lang) or l["text"]).split(): script.append({"w": w, "line": i})
sm = difflib.SequenceMatcher(None, [norm(w["w"]) for w in script], [norm(w["w"]) for w in heard], autojunk=False)
for block in sm.get_matching_blocks():
    for k in range(block.size):
        script[block.a + k]["s"] = heard[block.b + k]["s"]; script[block.a + k]["e"] = heard[block.b + k]["e"]
known = [i for i, w in enumerate(script) if "s" in w]
print(f"matched {len(known)}/{len(script)} script words, heard {len(heard)}, {dur:.1f} s")
tags = {t.strip().lower() for l in E["lines"] for t in re.findall(r"<([^>]*)>", l.get(lang) or l["text"])}
said = [w["w"] for k, w in enumerate(heard) if norm(w["w"]) in {norm(t) for t in tags} and norm(w["w"]) not in {norm(s["w"]) for s in script}]
if said: print("WARNING: tags spoken aloud:", said, "Run tts.py again or cut those words.")
if len(known) < len(script) * .5: print("WARNING: under half of the script matched. Check the voice follows the script.")
# Fill unmatched words by spreading them evenly between their matched neighbours.
for i, w in enumerate(script):
    if "s" in w: continue
    p = next((j for j in range(i - 1, -1, -1) if "e" in script[j]), None); n = next((j for j in range(i + 1, len(script)) if "s" in script[j] and j in known), None)
    a0 = script[p]["e"] if p is not None else 0.0; b0 = script[n]["s"] if n is not None else dur
    gap = (n if n is not None else len(script)) - (p if p is not None else -1); k = i - (p if p is not None else -1)
    w["s"] = a0 + (b0 - a0) * (k - 1) / gap; w["e"] = a0 + (b0 - a0) * k / gap
lines = []
for i, l in enumerate(E["lines"]):
    ws = [{"w": w["w"], "s": round(w["s"], 3), "e": round(w["e"], 3)} for w in script if w["line"] == i]
    lines.append({"start": ws[0]["s"], "end": ws[-1]["e"], "words": ws})
json.dump({"duration": round(dur + .15, 3), "lines": lines}, open(os.path.join(ep, f"timing_{lang}.json"), "w", encoding="utf-8"), indent=0, ensure_ascii=False)
print("wrote", f"timing_{lang}.json")
