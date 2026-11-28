"""Bibliothèque de plans courts (B-roll) pour le style « montage dynamique ».
Source : Mixkit (licence Mixkit Stock Video Free License : usage commercial permis, sans attribution).
usage : python3 mixkit.py mots.json [max_par_mot]
mots.json : {"effort": ["effort", "gym", ...], ...}  (mot FR -> recherches Mixkit en anglais)
Chaque plan : 3 s, 1280x720, sans son, dans clips/<id>.mp4 ; index.json relie mots FR -> plans.
"""
import json, os, re, subprocess, sys, urllib.request
H = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(H, "clips"); os.makedirs(C, exist_ok=True)
IDX = os.path.join(H, "index.json")
idx = json.load(open(IDX)) if os.path.exists(IDX) else {"clips": {}, "mots": {}}
UA = {"User-Agent": "Mozilla/5.0"}
def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30).read().decode("utf-8", "ignore")
mots = json.load(open(sys.argv[1])); N = int(sys.argv[2]) if len(sys.argv) > 2 else 6
for fr, recherches in mots.items():
    pris = idx["mots"].setdefault(fr, [])
    for q in recherches:
        if len(pris) >= N: break
        try: page = get(f"https://mixkit.co/free-stock-video/{q.replace(' ', '-')}/")
        except Exception as ex: print("x", q, ex); continue
        for slug, vid in re.findall(r'href="/free-stock-video/([a-z0-9-]+)-(\d+)/"', page):
            if len(pris) >= N: break
            if vid in pris: continue
            if not any(w[:4] in slug for w in q.split()): continue  # titre pertinent seulement
            out = os.path.join(C, vid + ".mp4")
            if vid not in idx["clips"]:
                tmp = os.path.join(C, vid + ".src.mp4")
                try:
                    urllib.request.urlretrieve(f"https://assets.mixkit.co/videos/{vid}/{vid}-720.mp4", tmp)
                    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", tmp]).strip() or 0)
                    ss = max(0.0, d / 2 - 1.5) if d > 4 else 0
                    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(ss), "-i", tmp, "-t", "3", "-an", "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30",
                                    "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], check=True)
                except Exception as ex: print("x", vid, ex); continue
                finally:
                    if os.path.exists(tmp): os.remove(tmp)
                idx["clips"][vid] = {"titre": slug.replace("-", " "), "fichier": f"clips/{vid}.mp4", "source": f"https://mixkit.co/free-stock-video/{slug}-{vid}/", "licence": "Mixkit Stock Video Free License"}
            idx["clips"][vid].setdefault("mots", [])
            if fr not in idx["clips"][vid]["mots"]: idx["clips"][vid]["mots"].append(fr)
            pris.append(vid)
        json.dump(idx, open(IDX, "w"), ensure_ascii=False, indent=1)
    print(fr, len(pris), flush=True)
print("total", len(idx["clips"]))
