# Whisper word JSON -> src/timing_<v>.js (words + caption chunks + duration). Usage: python tools/build_timing.py ref analysis/ref_words.json 84.63
import json, sys, re, unicodedata
v, src, dur = sys.argv[1], sys.argv[2], float(sys.argv[3])
words = json.load(open(src, encoding="utf-8"))
norm = lambda s: "".join(ch for ch in unicodedata.normalize("NFC", s.lower().replace("’", "'")) if ch == "'" or unicodedata.category(ch)[0] in "LMN")
for w in words: w["n"] = norm(w["w"])  # any script, same rule as captions.js norm()
fixed = []  # glue ",000" onto the previous number ("20" ",000" -> "20,000")
for w in words:
    if fixed and ((re.match(r"^,\d{3}", w["w"]) and re.search(r"\d$", fixed[-1]["w"])) or re.match(r"^-[A-Za-z]", w["w"])): fixed[-1]["w"] += w["w"]; fixed[-1]["e"] = w["e"]; fixed[-1]["n"] = norm(fixed[-1]["w"])
    else: fixed.append(w)
words = fixed
merged = []  # glue punctuation-only tokens like "%" onto the previous word
for w in words:
    if not w["n"] and merged: merged[-1]["w"] += w["w"]; merged[-1]["e"] = w["e"]
    else: merged.append(w)
words = merged
chunks, cur = [], []
for i, w in enumerate(words):
    cur.append(i)
    nxt = words[i + 1] if i + 1 < len(words) else None
    end = re.search(r"[.,?!।]$", w["w"]) or len(cur) >= 4 or (nxt and nxt["s"] - w["e"] > 0.3)
    if end or not nxt: chunks.append(cur); cur = []
open(f"src/timing_{v}.js", "w", encoding="utf-8").write(
    f"export const DURATION={dur};\nexport const WORDS={json.dumps(words, ensure_ascii=False)};\nexport const CHUNKS={json.dumps(chunks)};\n")
print(v, len(words), "words", len(chunks), "chunks")
