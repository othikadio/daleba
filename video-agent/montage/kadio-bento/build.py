"""Kadio Coiffure — style BENTO (noir · violet · citron). usage: python3 build.py <vo_dir>"""
import json, os, sys, soundfile as sf
ROOT = os.path.dirname(os.path.abspath(__file__)); VO = sys.argv[1]
MIN = [4.2, 4.6, 4.6, 4.8, 4.8, 7.2, 6.4]
SC, t = [], 0.0
for i, m in enumerate(MIN):
    d = sf.info(os.path.join(VO, f"vo_{i}.wav")).duration
    dur = round(max(m, d + .35 + .75), 2); SC.append((round(t, 2), dur)); t += dur
TOTAL = round(t, 2)
json.dump([{"t": round(s + .35, 2), "file": f"vo_{i}.wav"} for i, (s, _) in enumerate(SC)], open(os.path.join(ROOT, "vo.json"), "w"))


def sc(i, inner):
    s, d = SC[i]
    return f'<div id="s{i}" class="scene clip" data-start="{s}" data-duration="{d}" data-track-index="2">{inner}</div>'


def tile(cls, photo, style, extra=""):
    return f'<div class="tile {cls}" style="{style};background-image:url(photos/{photo}.jpg)">{extra}</div>'


GRID = [("k1", 40, 210, 490, 620), ("k5", 550, 210, 490, 400), ("k7", 550, 630, 490, 420), ("k3", 40, 850, 490, 520), ("k6", 550, 1070, 490, 300), ("k2", 40, 1390, 1000, 330)]
grid0 = "".join(tile("g", p, f"left:{x}px;top:{y}px;width:{w}px;height:{h}px") for p, x, y, w, h in GRID)
body = [
    sc(0, grid0 + '<div class="hookbox"><div class="hk1">LES FÊTES APPROCHENT</div><div class="hk2"><span class="split">Ta coiffure</span></div><div class="hk2 v"><span class="split">est prête ?</span></div></div>'),
    sc(1, tile("full", "k7", "left:0;top:0;width:1080px;height:1920px") + '<div class="shade"></div>'
          '<div class="mega" style="top:1050px"><span class="split">KADIO</span></div><div class="mega o" style="top:1240px"><span class="split">COIFFURE</span></div>'
          '<div class="stk lime" style="left:80px;top:1480px;--r:-4deg">📍 LONGUEUIL</div><div class="stk vio" style="left:420px;top:1500px;--r:3deg">chaque tête est une œuvre</div>'),
    sc(2, '<div class="idx">01</div><div class="cat">NATTES</div>'
          + tile("card c1", "k1", "left:60px;top:520px;width:470px;height:820px;--r:-3deg") + tile("card c2", "k2", "left:550px;top:600px;width:470px;height:620px;--r:4deg")
          + '<div class="price" style="left:600px;top:1260px"><small>DÈS</small>30 $</div>'),
    sc(3, '<div class="idx">02</div><div class="cat">DESIGN</div>'
          + tile("card c1 flip", "k5", "left:60px;top:520px;width:470px;height:760px;--r:-2deg") + tile("card c2 flip", "k7", "left:550px;top:560px;width:470px;height:470px;--r:3deg")
          + '<div class="tags" style="top:1080px;left:560px"><span>ZIGZAG</span><span>CROISÉ</span></div>'
          + '<div class="price" style="left:600px;top:1260px"><small>DÈS</small>40 $</div>'),
    sc(4, '<div class="idx">03</div><div class="cat">TWISTS · LOCS</div>'
          + tile("card c1 scan", "k3", "left:60px;top:520px;width:470px;height:720px;--r:-3deg", '<i class="bar"></i>') + tile("card c2 scan", "k6", "left:550px;top:620px;width:470px;height:470px;--r:3deg", '<i class="bar"></i>')
          + '<div class="stk lime" style="left:80px;top:1300px;--r:-3deg">TWISTS DÈS 55 $</div><div class="stk vio" style="left:560px;top:1150px;--r:4deg">RETWIST 150 $</div>'),
    sc(5, '<div class="idx">04</div><div class="cat">BARBIER</div>'
          + tile("card c1", "k4", "left:60px;top:500px;width:520px;height:940px;--r:-2deg")
          + '<div class="cmp"><div class="was">COUPE + BARBE<br><s>60 $</s> à la visite</div><div class="now"><small>CLUB KADIO</small><b id="clubp">0,00 $</b><em>/mois · taxes incluses</em></div></div>'),
    sc(6, ''.join(tile("m", p, f"left:{x}px;top:{y}px;width:{w}px;height:{h}px") for p, x, y, w, h in GRID)
          + '<div class="cta"><div class="c1">RÉSERVE AVANT</div><div class="c2"><span class="split">LE RUSH</span></div><div class="c3">📞 514 919-5970</div><div class="c4">kadiocoiffure.com</div></div>'),
]
tpl = open(os.path.join(ROOT, "template.tpl")).read()
open(os.path.join(ROOT, "index.html"), "w").write(tpl.replace("{{TOTAL}}", str(TOTAL)).replace("{{SCENES}}", "\n".join(body))
                                                  .replace("{{CFG}}", json.dumps({"total": TOTAL, "scenes": SC})))
print("total", TOTAL, SC)
