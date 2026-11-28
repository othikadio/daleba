"""Bibliothèque de musiques de fond (sous la voix off). Source : Mixkit (licence Mixkit Free License, usage commercial, sans attribution).
usage : python3 musiques.py [par_ambiance]  -> musiques/m<id>.mp3 (128k, 90 s max) + musiques.json (ambiances par morceau)
"""
import json, os, re, subprocess, sys, urllib.request
H = os.path.dirname(os.path.abspath(__file__)); M = os.path.join(H, "musiques"); os.makedirs(M, exist_ok=True)
IDX = os.path.join(H, "musiques.json"); idx = json.load(open(IDX)) if os.path.exists(IDX) else {}
N = int(sys.argv[1]) if len(sys.argv) > 1 else 4
AMB = {"émotion": "emotional", "réflexion": "reflective", "espoir": "hopeful", "inspirant": "uplifting", "motivation": "motivating",
       "calme": "calm", "rêveur": "dreamy", "atmosphère": "atmospheric", "douceur": "mellow", "tendresse": "tender",
       "confiance": "confident", "détermination": "determined", "élégant": "elegant", "smooth": "smooth", "glamour": "glamorous",
       "nostalgie": "nostalgic", "épique": "epic", "dramatique": "dramatic", "puissant": "powerful", "positif": "positive",
       "triomphe": "triumphant", "mystère": "mysterious", "sensuel": "sensual", "énergie": "energetic"}
UA = {"User-Agent": "Mozilla/5.0"}
for fr, en in AMB.items():
    try: h = urllib.request.urlopen(urllib.request.Request(f"https://mixkit.co/free-stock-music/mood/{en}/", headers=UA), timeout=30).read().decode("utf-8", "ignore")
    except Exception as ex: print("x", fr, ex); continue
    ids = list(dict.fromkeys(re.findall(r"https://assets.mixkit.co/music/(\d+)/\d+\.mp3", h)))
    n = 0
    for i in ids:
        if n >= N: break
        out = os.path.join(M, f"m{i}.mp3")
        if i not in idx:
            try:
                tmp = out + ".src"; urllib.request.urlretrieve(f"https://assets.mixkit.co/music/{i}/{i}.mp3", tmp)
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-t", "90", "-b:a", "128k", "-f", "mp3", out], check=True); os.remove(tmp)
                d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).strip())
            except Exception as ex: print("x", i, ex); continue
            idx[i] = {"fichier": f"musiques/m{i}.mp3", "duree": round(d, 1), "ambiances": [], "source": f"https://mixkit.co/free-stock-music/ (id {i})", "licence": "Mixkit Free License"}
        if fr not in idx[i]["ambiances"]: idx[i]["ambiances"].append(fr)
        n += 1
    json.dump(idx, open(IDX, "w"), ensure_ascii=False, indent=1); print(fr, n, flush=True)
print("total", len(idx))
