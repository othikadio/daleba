"""Série 10 vidéos Kadio — un style différent par vidéo. usage: python3 build.py <video_id>
Lit spec.json (voix), scenes.py (visuels), <video>/vo/vo_i.wav (durées) → <video>/index.html + vo.json"""
import json, os, sys, shutil, html, soundfile as sf
from scenes import SC
R = os.path.dirname(os.path.abspath(__file__)); V = sys.argv[1]; D = os.path.join(R, V)
SPEC = json.load(open(os.path.join(R, "spec.json")))[V]; STY = SPEC["style"]; SCN = SC[V]
assert len(SCN) == len(SPEC["vo"]), "une scène par phrase"
LEAD, TAIL = .45, .55
SCH, t = [], 0.0
for i in range(len(SCN)):
    d = sf.info(os.path.join(D, "vo", f"vo_{i}.wav")).duration
    dur = max(3.2, LEAD + d + TAIL) + (2.2 if i == len(SCN) - 1 else 0)
    SCH.append((round(t, 2), round(dur, 2))); t += dur
TOTAL = round(t, 2)
json.dump([{"t": round(s + LEAD, 2), "file": f"vo_{i}.wav"} for i, (s, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
for sub in ("fonts", "photos"):
    shutil.copytree(os.path.join(R, "shared", sub), os.path.join(D, sub), dirs_exist_ok=True)
shutil.copy(os.path.join(R, "shared", "gsap.min.js"), D); shutil.copy(os.path.join(R, "styles.css"), D)
e = html.escape

BG = {
 "blueprint": '<div id="grid"></div><div class="ring" style="left:-220px;top:1200px;width:640px;height:640px"></div><div class="ring" style="left:760px;top:120px;width:460px;height:460px"></div>'
              '<div id="tblock"><div>KADIO COIFFURE</div><div>FORMATION · LOCKS</div><div>REV A</div></div>',
 "brutal": '<div id="grid"></div><div id="star"></div>',
 "neon": '<div id="haze"></div><div id="frame"></div><div id="frame2"></div>',
 "comic": '<div id="panel"><div id="rays"></div></div>',
 "halftone": '<div id="sun"></div><div id="dots2"></div>',
 "bauhaus": '<div class="sh c1"></div><div class="sh c2"></div><div class="sh c3"></div><div class="sh c4"></div>',
 "clay": '<div class="ball b1"></div><div class="ball b2"></div><div class="ball b3"></div><div class="ball b4"></div>',
 "glass": '<div class="blob o1"></div><div class="blob o2"></div><div class="blob o3"></div>' + "".join(
     f'<div class="flake" style="left:{(k * 197) % 1040}px;top:{(k * 331) % 1900}px;font-size:{26 + (k * 13) % 30}px">❄</div>' for k in range(16)),
 "flap": '<div id="board"></div>',
 "deco": '<div id="rays"></div><div class="corner k1"></div><div class="corner k2"></div><div class="corner k3"></div><div class="corner k4"></div>',
}


def scene(i, s):
    st, du = SCH[i]; parts = []
    if s.get("photo"): parts.append(f'<div class="photo" style="background-image:url(photos/{s["photo"]}.jpg)"></div>')
    if s.get("kick"): parts.append(f'<div class="kick">{e(s["kick"])}</div>')
    if STY == "deco" and s.get("big"): parts.append('<div class="rule"></div>')
    if s.get("big"): parts.append('<div class="big">' + "".join(f'<span class="ln split">{e(l)}</span>' for l in s["big"]) + '</div>')
    if STY == "deco" and s.get("big"): parts.append('<div class="rule"></div>')
    if s.get("items"): parts.append('<div class="items">' + "".join(f'<div class="it">{e(x)}</div>' for x in s["items"]) + '</div>')
    if s.get("sub"): parts.append(f'<div class="sub">{e(s["sub"])}</div>')
    if s.get("cta"): parts.append('<div class="contact"><div class="pill">514 919-5970</div><div class="url">kadiocoiffure.com</div></div>')
    inner = "".join(parts)
    if STY == "glass": inner = f'<div class="card">{inner}</div>'
    if s.get("badge"): inner += f'<div class="badge">{e(s["badge"])}</div>'
    return f'<div id="s{i}" class="scene clip" data-start="{st}" data-duration="{du}" data-track-index="2">{inner}</div>'


tpl = open(os.path.join(R, "template.tpl")).read()
out = (tpl.replace("{{TOTAL}}", str(TOTAL)).replace("{{STYLE}}", STY).replace("{{BG}}", BG[STY])
       .replace("{{SCENES}}", "\n".join(scene(i, s) for i, s in enumerate(SCN)))
       .replace("{{CFG}}", json.dumps({"total": TOTAL, "scenes": SCH, "style": STY})))
open(os.path.join(D, "index.html"), "w").write(out)
for f in ("hyperframes.json", "package.json"):
    shutil.copy(os.path.join(R, "..", "kadio-bento", f), D)
print(V, STY, "total", TOTAL)
