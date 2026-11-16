"""Jolina Coiffure v4 — style ÉDITORIAL (magazine de mode), distinct du style Kadio.
usage: python3 build_v4.py <vo_dir>  -> v4/index.html + v4/vo.json
"""
import json, os, shutil, sys, soundfile as sf

ROOT = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(ROOT, "v4"); VO = sys.argv[1]
os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)
for f in ["gsap.min.js", "hyperframes.json", "meta.json", "package.json"]: shutil.copy(os.path.join(ROOT, f), OUT)
if not os.path.exists(os.path.join(OUT, "fonts")): shutil.copytree(os.path.join(ROOT, "fonts"), os.path.join(OUT, "fonts"))
for j in ("j1", "j2", "j3"): shutil.copy(os.path.join(ROOT, "assets", f"{j}.mp4"), os.path.join(OUT, "assets"))

MIN = [4.2, 5.0, 5.0, 5.6, 7.0, 5.0, 5.2]
SC, t = [], 0.0
for i, m in enumerate(MIN):
    d = sf.info(os.path.join(VO, f"vo_{i}.wav")).duration
    dur = round(max(m, d + .45 + .75), 2); SC.append((round(t, 2), dur)); t += dur
TOTAL = round(t, 2)
json.dump([{"t": round(s + .45, 2), "file": f"vo_{i}.wav"} for i, (s, _) in enumerate(SC)], open(os.path.join(OUT, "vo.json"), "w"))
ACC = ["#c8553d", "#c8553d", "#1f6f5c", "#d99a1e", "#5b2a4e", "#1f6f5c", "#c8553d"]


def sc(i, inner, extra=""):
    s, d = SC[i]
    return f'<div id="s{i}" class="scene clip" data-start="{s}" data-duration="{d}" data-track-index="3" style="--acc:{ACC[i]}{extra}">{inner}</div>'


def vid(id_, j, i, cls, style):
    s, d = SC[i]
    return (f'<div class="frame {cls}" id="f_{id_}" style="{style}"><video id="{id_}" class="clip" src="assets/{j}.mp4" muted '
            f'data-start="{s}" data-duration="{d}" data-media-start="0" data-track-index="2"></video></div>')

MARQ = "TRESSES • NATTES • DESIGN • JOLINA COIFFURE • " * 4
ring = "LE DÉTAIL • RAIES EN VAGUE • PRÉCISION • "
body = [
    sc(0, f'<div class="kicker" style="top:420px">COIFFURE · MONTRÉAL</div>'
          f'<div class="mask" style="top:500px"><div class="giant">Jolina</div></div>'
          f'<div class="rule" style="top:800px"></div>'
          f'<div class="mask" style="top:840px"><div class="lede">Des nattes</div></div>'
          f'<div class="mask" style="top:940px"><div class="lede acc">impeccables.</div></div>'
          f'<div class="band" style="top:1300px"><div class="mq">{MARQ}</div></div>'),
    sc(1, '<div class="num">01</div><div class="cap" style="left:70px;top:1180px"><div class="k">ANGLE 01</div><div class="t">De face</div><div class="s">Nattes design · lignes nettes</div></div>'),
    sc(2, '<div class="num right">02</div><div class="cap right" style="right:70px;top:1180px"><div class="k">ANGLE 02</div><div class="t">De dos</div><div class="s">Le même soin, du début à la fin</div></div>'),
    sc(3, f'<svg class="ring" viewBox="0 0 900 900"><defs><path id="cp" d="M450,450 m-400,0 a400,400 0 1,1 800,0 a400,400 0 1,1 -800,0"/></defs>'
          f'<text><textPath href="#cp">{ring * 3}</textPath></text></svg>'
          '<div class="cap sm" style="left:40px;right:40px;top:1300px;text-align:center"><div class="k">ANGLE 03</div><div class="t">Raies en vague</div><div class="s">Tracées avec précision</div></div>'),
    sc(4, '<div class="strip" id="strip"></div><div class="big" id="note">4,8</div><div class="over5">/ 5 · Google</div>'
          '<div class="dia" id="dia"><i></i><i></i><i></i><i></i><i></i></div>'
          '<div class="quote"><span class="qq">“</span>Les gens adorent la qualité des tresses et des nattes réalisées ici.<div class="src">— Résumé des 13 avis Google</div></div>'),
    sc(5, '<div class="kicker" style="top:300px">SOMMAIRE</div><div class="mask" style="top:360px"><div class="giant" style="font-size:150px">Le salon</div></div>'
          '<div class="toc">'
          '<div class="li"><b>Spécialité</b><span></span><em>Tresses · Nattes</em></div>'
          '<div class="li"><b>Adresse</b><span></span><em>Av. Papineau, Montréal</em></div>'
          '<div class="li"><b>Gamme</b><span></span><em>50 – 200 $</em></div>'
          '<div class="li"><b>Note Google</b><span></span><em>4,8 / 5 (13 avis)</em></div></div>'),
    sc(6, '<div class="cta-bg"></div><div class="kicker light" style="top:470px">JOLINA COIFFURE</div>'
          '<div class="mask" style="top:540px"><div class="giant light" style="font-size:170px">Réserve</div></div>'
          '<div class="mask" style="top:720px"><div class="giant light" style="font-size:170px">ta place.</div></div>'
          '<div class="tel">263 550-1630</div><div class="addr">Avenue Papineau · Montréal</div>'),
    vid("v1", "j3", 1, "arch", "right:70px;top:250px;width:640px;height:900px"),
    vid("v2", "j2", 2, "arch", "left:70px;top:250px;width:640px;height:900px"),
    vid("v3", "j1", 3, "circle", "left:190px;top:330px;width:700px;height:700px"),
    vid("m1", "j3", 4, "arch mini", "left:70px;top:200px;width:290px;height:400px"),
    vid("m2", "j2", 4, "arch mini", "left:395px;top:200px;width:290px;height:400px"),
    vid("m3", "j1", 4, "arch mini", "left:720px;top:200px;width:290px;height:400px"),
]
tpl = open(os.path.join(ROOT, "template_v4.html")).read()
open(os.path.join(OUT, "index.html"), "w").write(tpl.replace("{{TOTAL}}", str(TOTAL)).replace("{{SCENES}}", "\n".join(body))
                                                  .replace("{{CFG}}", json.dumps({"total": TOTAL, "scenes": SC, "acc": ACC})))
print("total", TOTAL)
