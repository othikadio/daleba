"""Génère une composition HyperFrames par vidéo à partir de videos.json + durées de voix.

usage: python3 build.py <durees.json>   (durees = {"v1-abonnements_0": 4.2, ...})
"""
import json, os, shutil, sys, html

ROOT = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(ROOT, "shared")
VIDEOS = json.load(open(os.path.join(ROOT, "videos.json")))
DUR = json.load(open(sys.argv[1]))
VO_IN = 0.35  # la voix démarre 0,35 s après le début de la scène
E = html.escape


def min_dur(s):
    t = s["type"]
    if t == "hook": return 3.4
    if t == "list": return 2.4 + 0.38 * len(s["items"]) + 1.6
    if t == "big": return 4.2
    if t == "versus": return 4.6
    return 4.2


def scene_html(i, s, start, dur):
    a = f'id="s{i}" class="scene clip" data-start="{start:.2f}" data-duration="{dur:.2f}" data-track-index="2"'
    t = s["type"]
    if t == "hook":
        lines = "".join(f'<div class="hl"><span class="split{" rainbow" if j == 1 else ""}">{E(l)}</span></div>' for j, l in enumerate(s["lines"]))
        return f'<div {a}><div class="center" style="top:520px"><span class="pill kick">{E(s["kicker"])}</span></div><div class="hook">{lines}</div></div>'
    if t == "list":
        fs = 96 if len(s["title"]) <= 16 else 74
        rows = "".join(
            f'<div class="row"><span class="rn">{E(n)}</span><span class="rp" style="color:{s["color"]}">{E(p)}</span></div>'
            for n, p in s["items"])
        return (f'<div {a}><div class="center" style="top:180px"><span class="pill tag" style="background:{s["color"]}">CLUB KADIO / {E(s["tag"])}</span></div>'
                f'<div class="photo"><img src="photos/{s["photo"]}.jpg" alt="" /></div>'
                f'<div class="title" style="font-size:{fs}px"><span class="split">{E(s["title"])}</span></div>'
                f'<div class="rows">{rows}</div><div class="note">{E(s["note"])}</div></div>')
    if t == "big":
        vfs = 300 if len(s["value"]) <= 5 else (170 if len(s["value"]) <= 9 else 132)
        conf = '<div class="conf"></div>' if s.get("confetti") else ""
        return (f'<div {a}><div class="ring r1" style="border-color:{s["color"]}"></div><div class="ring r2"></div>'
                f'<div class="center" style="top:330px"><span class="pill tag" style="background:{s["color"]}">{E(s["tag"])}</span></div>'
                f'<div class="center btitle"><span class="split">{E(s["title"])}</span></div>'
                f'<div class="center bval" style="font-size:{vfs}px;color:{s["color"]}">{E(s["value"])}</div>'
                f'<div class="center bsub">{E(s["sub"])}</div>{conf}</div>')
    if t == "versus":
        l, r = s["left"], s["right"]
        return (f'<div {a}><div class="center" style="top:330px"><span class="pill tag" style="background:{s["color"]}">{E(s["tag"])}</span></div>'
                f'<div class="vs vl glass"><div class="vh">{E(l[0])}</div><div class="vp">{E(l[1])}</div><div class="strike"></div></div>'
                f'<div class="vsb">VS</div>'
                f'<div class="vs vr glass" style="border-color:{s["color"]}"><div class="vh">{E(r[0])}</div><div class="vp">{E(r[1].split("/")[0].strip())}</div><div class="vm">{"/" + E(r[1].split("/")[1]) if "/" in r[1] else ""}</div></div>'
                f'<div class="center note2">Prix de départ par mois · Taxes incluses</div></div>')
    lines = "".join(f'<div class="cl"><span class="split{" rainbow" if j == 1 else ""}">{E(l)}</span></div>' for j, l in enumerate(s["lines"]))
    return (f'<div {a}><div class="cta">{lines}</div>'
            f'<div class="center" style="top:900px"><span class="site">kadiocoiffure.com</span></div>'
            f'<div class="center" style="top:1060px"><span class="pill phone">📞 514 919-5970</span></div>'
            f'<div class="center" style="top:1180px"><span class="addr">615 Antoinette-Robidoux, Longueuil</span></div></div>')


def build(vid, cfg):
    out = os.path.join(ROOT, vid)
    os.makedirs(os.path.join(out, "photos"), exist_ok=True)
    for f in ["gsap.min.js", "hyperframes.json", "meta.json", "package.json"]:
        shutil.copy(os.path.join(ROOT, "..", "abonnements-kadio", f), out)
    if os.path.exists(os.path.join(out, "fonts")): shutil.rmtree(os.path.join(out, "fonts"))
    shutil.copytree(os.path.join(SHARED, "fonts"), os.path.join(out, "fonts"))
    scenes, t = [], 0.0
    for i, s in enumerate(cfg["scenes"]):
        vo = DUR[f"{vid}_{i}"]
        d = round(max(min_dur(s), vo + VO_IN + 0.55), 2)
        scenes.append({**s, "start": round(t, 2), "dur": d, "vo_t": round(t + VO_IN, 2), "vo_d": vo})
        if s.get("photo"): shutil.copy(os.path.join(SHARED, "photos", s["photo"] + ".jpg"), os.path.join(out, "photos"))
        t += d
    total = round(t, 2)
    body = "\n".join(scene_html(i, s, s["start"], s["dur"]) for i, s in enumerate(scenes))
    tpl = open(os.path.join(ROOT, "template.html")).read()
    page = (tpl.replace("{{TOTAL}}", f"{total:.2f}").replace("{{SCENES}}", body)
            .replace("{{CFG}}", json.dumps({"total": total, "palette": cfg["palette"], "scenes": scenes}, ensure_ascii=False)))
    open(os.path.join(out, "index.html"), "w").write(page)
    json.dump([{"t": s["vo_t"], "file": f"{vid}_{i}.wav"} for i, s in enumerate(scenes)], open(os.path.join(out, "vo.json"), "w"))
    print(vid, total, "s")


for vid, cfg in VIDEOS.items():
    if len(sys.argv) < 3 or vid in sys.argv[2:]:
        build(vid, cfg)
