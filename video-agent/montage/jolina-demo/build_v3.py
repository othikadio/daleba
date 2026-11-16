"""Jolina Coiffure v3 : motion design coloré + prestations sous plusieurs angles + voix off.
usage: python3 build_v3.py <vo_dir>   -> écrit v3/index.html et v3/vo.json
"""
import json, os, shutil, sys, soundfile as sf

ROOT = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(ROOT, "v3"); VO = sys.argv[1]
os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)
for f in ["gsap.min.js", "hyperframes.json", "meta.json", "package.json"]: shutil.copy(os.path.join(ROOT, f), OUT)
if not os.path.exists(os.path.join(OUT, "fonts")): shutil.copytree(os.path.join(ROOT, "fonts"), os.path.join(OUT, "fonts"))
for j in ("j1", "j2", "j3"): shutil.copy(os.path.join(ROOT, "assets", f"{j}.mp4"), os.path.join(OUT, "assets"))

MIN = [3.6, 4.0, 3.6, 4.4, 5.6, 4.6, 4.6]
scenes, t = [], 0.0
for i, m in enumerate(MIN):
    d = sf.info(os.path.join(VO, f"vo_{i}.wav")).duration
    dur = round(max(m, d + 0.35 + 0.7), 2); scenes.append((round(t, 2), dur)); t += dur
TOTAL = round(t, 2)
json.dump([{"t": round(s + 0.35, 2), "file": f"vo_{i}.wav"} for i, (s, _) in enumerate(scenes)], open(os.path.join(OUT, "vo.json"), "w"))


def A(i, inner):
    s, d = scenes[i]
    return f'<div id="s{i}" class="scene clip" data-start="{s}" data-duration="{d}" data-track-index="3">{inner}</div>'


def vcard(vid, j, i, cls, style):
    s, d = scenes[i]
    return (f'<div class="vcard {cls}" id="c_{vid}" style="{style}"><video id="{vid}" class="clip" src="assets/{j}.mp4" muted '
            f'data-start="{s}" data-duration="{d}" data-media-start="0" data-track-index="{2}"></video></div>')

# les vidéos doivent être des éléments temporisés à la racine : on les sort des scènes
videos = [
    vcard("v1", "j3", 1, "big", "left:200px;top:300px;width:680px;height:1000px"),
    vcard("v2", "j2", 2, "big", "left:200px;top:300px;width:680px;height:1000px"),
    vcard("v3", "j1", 3, "big", "left:200px;top:300px;width:680px;height:1000px"),
    vcard("t1", "j3", 4, "mini", "left:60px;top:250px;width:300px;height:440px"),
    vcard("t2", "j2", 4, "mini", "left:390px;top:230px;width:300px;height:440px"),
    vcard("t3", "j1", 4, "mini", "left:720px;top:250px;width:300px;height:440px"),
]
body = "\n".join([
    A(0, '<div class="center" style="top:560px"><span class="pill kick" style="background:#ffc76b">JOLINA COIFFURE</span></div>'
         '<div class="hook"><div class="hl"><span class="split">Des nattes</span></div><div class="hl"><span class="split rainbow">impeccables</span></div>'
         '<div class="hl"><span class="split">à Montréal.</span></div></div>'),
    A(1, '<div class="center" style="top:170px"><span class="pill tag" style="background:#ff7ac0">ANGLE 1 · DE FACE</span></div>'
         '<div class="title" style="top:1350px"><span class="split">Nattes design</span></div>'
         '<div class="center" style="top:1480px"><span class="chip c1" style="background:#3ee0d0">Lignes nettes</span><span class="chip c2" style="background:#ffd23d">Précision</span></div>'),
    A(2, '<div class="center" style="top:170px"><span class="pill tag" style="background:#3ee0d0">ANGLE 2 · DE DOS</span></div>'
         '<div class="title" style="top:1350px"><span class="split">Le même soin</span></div>'
         '<div class="center" style="top:1480px"><span class="chip c1" style="background:#ff7ac0">Du début</span><span class="chip c2" style="background:#a46bff;color:#fff">à la fin</span></div>'),
    A(3, '<div class="center" style="top:170px"><span class="pill tag" style="background:#ffd23d">ANGLE 3 · LE DÉTAIL</span></div>'
         '<div class="title" style="top:1350px"><span class="split">Raies en vague</span></div>'
         '<div class="center" style="top:1480px"><span class="chip c1" style="background:#3ee07a">Tracées avec précision</span></div>'),
    A(4, '<div class="center num" style="top:760px" id="num">0,0</div>'
         '<div class="center" style="top:1060px" id="stars"><span class="star">★</span><span class="star">★</span><span class="star">★</span><span class="star">★</span><span class="star">★</span></div>'
         '<div class="center" style="top:1190px;font-size:44px;font-weight:800" id="avis">13 avis Google</div>'
         '<div class="quote glass" id="quote"><div class="q">« Les gens adorent la qualité des tresses et des nattes réalisées ici »</div><div class="s">— Résumé des avis Google</div></div>'),
    A(5, '<div class="center" style="top:300px"><span class="pill tag" style="background:#ffc76b">LE SALON</span></div>'
         '<div class="title" style="top:420px;font-size:120px"><span class="split rainbow">Jolina Coiffure</span></div>'
         '<div class="rows">'
         '<div class="row"><span class="rn">✂️ Spécialité</span><span class="rp" style="color:#ff9ac8">Tresses · Nattes</span></div>'
         '<div class="row"><span class="rn">📍 Adresse</span><span class="rp" style="color:#7dffcf">Av. Papineau, Montréal</span></div>'
         '<div class="row"><span class="rn">💳 Gamme de prix</span><span class="rp" style="color:#ffd23d">50 – 200 $</span></div>'
         '<div class="row"><span class="rn">⭐ Note Google</span><span class="rp" style="color:#ffc76b">4,8 (13 avis)</span></div>'
         '</div>'),
    A(6, '<div class="cta"><div class="cl"><span class="split">Réserve</span></div><div class="cl"><span class="split rainbow">ta place</span></div></div>'
         '<div class="center" style="top:920px"><span class="site">📞 263 550-1630</span></div>'
         '<div class="center" style="top:1090px"><span class="pill" style="background:#ffc76b;font-size:44px">JOLINA COIFFURE</span></div>'
         '<div class="center" style="top:1200px;font-size:40px;font-weight:800" id="addr">📍 Avenue Papineau · Montréal</div>'),
] + videos)

tpl = open(os.path.join(ROOT, "template_v3.html")).read()
open(os.path.join(OUT, "index.html"), "w").write(tpl.replace("{{TOTAL}}", str(TOTAL)).replace("{{SCENES}}", body)
                                                  .replace("{{CFG}}", json.dumps({"total": TOTAL, "scenes": scenes})))
print("total", TOTAL, scenes)
