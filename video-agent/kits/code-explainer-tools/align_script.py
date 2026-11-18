# Put a clean script onto Whisper timings (for languages where Whisper's spelling is rough, e.g. Hindi).
# Usage: python tools/align_script.py <whisper_words.json> <script.txt> <out.json>
# script.txt: one line per spoken segment, "start-end | clean text" (start/end in seconds, from the Whisper .txt).
# If the clean line has as many words as Whisper heard in that span, each word takes Whisper's time;
# otherwise the span is shared out by word length.
import json, sys, re
src, script, out = sys.argv[1:4]
heard = json.load(open(src, encoding="utf-8"))
words = []
for line in open(script, encoding="utf-8"):
    m = re.match(r"\s*([\d.]+)\s*-\s*([\d.]+)\s*\|\s*(.+)", line)
    if not m: continue
    a, b, toks = float(m[1]), float(m[2]), m[3].split()
    ws = [w for w in heard if w["s"] >= a - .05 and w["e"] <= b + .05]
    if len(ws) == len(toks):
        words += [{"w": t, "s": w["s"], "e": w["e"]} for t, w in zip(toks, ws)]; continue
    s0, s1 = (ws[0]["s"], ws[-1]["e"]) if ws else (a, b)
    if b - s1 > .4: s1 = b  # Whisper heard only part of this line: use the whole segment
    tot, acc = sum(len(t) + 2 for t in toks), 0
    for t in toks:
        d = (len(t) + 2) / tot * (s1 - s0)
        words.append({"w": t, "s": round(s0 + acc, 2), "e": round(s0 + acc + d * .9, 2)}); acc += d
json.dump(words, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(out, len(words), "words")
