# Picks a background the brand has not used yet and writes it into the episode.
# Usage: python tools/look.py <video folder> [--list]     Reads brand/looks.json and every other video's episode.json.
# Every set is used once before any set repeats, and no set + light pair repeats until all of them have run.
import sys, os, json, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ep = os.path.abspath(sys.argv[1]); L = json.load(open(os.path.join(ROOT, "brand", "looks.json"), encoding="utf-8"))
used = []
for f in sorted(glob.glob(os.path.join(os.path.dirname(ep), "*", "episode.json")), key=os.path.getmtime):
    if os.path.dirname(os.path.abspath(f)) == ep or os.path.basename(os.path.dirname(f)) == "demo" or os.path.basename(os.path.dirname(f)).startswith("sample"): continue
    e = json.load(open(f, encoding="utf-8")); used.append((e.get("set"), e.get("light")))
pairs = [(s, l) for s in L["sets"] for l in L["lights"]]
if "--list" in sys.argv: print("used:", used); print("all:", pairs); sys.exit()
free = [p for p in pairs if p not in used] or pairs
count = {s: sum(1 for u in used if u[0] == s) for s in L["sets"]}
last = used[-1][0] if used else None
free.sort(key=lambda p: (p[0] == last, count[p[0]], pairs.index(p)))
s, l = free[0]
f = os.path.join(ep, "episode.json"); e = json.load(open(f, encoding="utf-8")); e["set"] = s; e["light"] = l
json.dump(e, open(f, "w", encoding="utf-8"), indent=2, ensure_ascii=False); print("set:", s, "light:", l)
