"""Faso Déh — affiche de cirque animée. usage: python3 build.py <vo_dir>"""
import json, os, sys, soundfile as sf
ROOT = os.path.dirname(os.path.abspath(__file__)); VO = sys.argv[1]
MIN = [4.0, 4.6, 6.0, 6.0, 6.0, 7.0, 6.5]
SC, t = [], 0.0
for i, m in enumerate(MIN):
    d = sf.info(os.path.join(VO, f"vo_{i}.wav")).duration
    dur = round(max(m, d + .4 + .8), 2); SC.append((round(t, 2), dur)); t += dur
TOTAL = round(t, 2)
json.dump([{"t": round(s + .4, 2), "file": f"vo_{i}.wav"} for i, (s, _) in enumerate(SC)], open(os.path.join(ROOT, "vo.json"), "w"))


def sc(i, inner, bg=""):
    s, d = SC[i]
    return f'<div id="s{i}" class="scene clip" data-start="{s}" data-duration="{d}" data-track-index="2">{inner}</div>'


def pola(id_, photo, label, style, color):
    return (f'<div class="pola" id="{id_}" style="{style}"><div class="ph" style="background-image:url(photos/{photo}.jpg)"></div>'
            f'<div class="lab" style="color:{color}">{label}</div><i class="tape"></i></div>')


def ticket(id_, name, sub, price, color, style):
    return (f'<div class="tk" id="{id_}" style="{style};--tc:{color}"><div class="tl"><b>{name}</b><span>{sub}</span></div>'
            f'<div class="tr"><em>{price}</em></div></div>')

body = [
    sc(0, '<div class="spot"></div><div class="center pre" style="top:640px">LES FÊTES ARRIVENT</div>'
          '<div class="center poster" style="top:760px"><span class="split">UN SPECTACLE</span></div>'
          '<div class="center poster y" style="top:900px"><span class="split">QUI MARQUE</span></div>'
          '<div class="center poster" style="top:1040px"><span class="split">LES ESPRITS ?</span></div>'
          '<div class="curtain l"></div><div class="curtain r"></div>'),
    sc(1, '<div class="rays"></div><div class="disc" style="background-image:url(photos/p8.jpg)"></div>'
          '<div class="center poster big" style="top:1080px"><span class="split">FASO DÉH</span></div>'
          '<div class="ribbon" style="top:1290px"><span>CIRQUE &amp; CULTURE</span></div>'
          '<div class="center sub" style="top:1430px">Le cirque africain qui transforme vos événements</div>'),
    sc(2, pola("q1", "p6", "ÉCHASSES", "left:40px;top:190px;--r:-7deg", "#e63946")
          + pola("q2", "p7", "JONGLERIE · 7 QUILLES", "left:560px;top:470px;--r:6deg", "#1d3fa6")
          + pola("q3", "p10", "MONOCYCLE", "left:70px;top:900px;--r:-4deg", "#1a8f5a")
          + '<div class="chips" style="top:1560px"><span class="chip" style="background:#ffd23d">TISSU AÉRIEN</span><span class="chip" style="background:#e63946;color:#fff">PERCUSSIONS</span></div>'),
    sc(3, '<div class="wax"></div><div class="flag"><i class="fr"></i><i class="fg"></i><b>★</b></div>'
          '<div class="pola solo" id="q4" style="left:300px;top:300px;--r:3deg"><div class="ph" style="background-image:url(photos/p9.jpg)"></div><div class="lab" style="color:#e63946">BURKINA FASO → CANADA</div><i class="tape"></i></div>'
          '<div class="quote">« On monte sur des échasses pour que les enfants apprennent à <b>viser haut</b>. »</div>'),
    sc(4, pola("q5", "p2", "ATELIERS", "left:60px;top:260px;--r:-5deg", "#1d3fa6")
          + pola("q6", "p1", "TOUT LE MONDE ESSAIE", "left:470px;top:330px;--r:5deg", "#e63946")
          + '<div class="center count" style="top:1100px" id="cnt">0</div><div class="center sub" style="top:1430px">participants initiés au cirque</div>'),
    sc(5, '<div class="center pre" style="top:230px">FORMULES CLÉ EN MAIN</div>'
          + ticket("t1", "ÉCHASSIER JONGLEUR", "Solo · 3 × 30 min", "800 $", "#e63946", "top:380px")
          + ticket("t2", "TABLES DE CIRQUE", "4 ateliers · 120 participants", "1 250 $", "#1d3fa6", "top:640px")
          + ticket("t3", "DUO ÉCHASSES + DJEMBÉ", "Déambulation · 3 × 30 min", "1 500 $", "#1a8f5a", "top:900px")
          + ticket("t4", "TISSU AÉRIEN", "Le clou du spectacle", "2 500 $", "#c97a00", "top:1160px")
          + '<div class="center small" style="top:1440px">Festivals · Écoles · Marchés · Entreprises · Fêtes privées</div>'),
    sc(6, '<div class="spot"></div><div class="center pre" style="top:430px">LES DATES DES FÊTES PARTENT VITE</div>'
          '<div class="center poster y" style="top:540px"><span class="split">RÉSERVEZ</span></div>'
          '<div class="center poster" style="top:690px"><span class="split">VOTRE DATE</span></div>'
          '<div class="center" style="top:900px"><span class="tel">📞 514 995-2276</span></div>'
          '<div class="center sub" style="top:1080px">fasodeh.com · réponse en moins de 24 h</div>'
          '<div class="ribbon" style="top:1220px"><span>CIRQUE &amp; CULTURE</span></div>'),
]
bulbs = "".join(f'<i class="bulb" style="left:{x}px;top:{y}px"></i>' for x, y in
                [(30 + k * 68, 34) for k in range(16)] + [(30 + k * 68, 1872) for k in range(16)] +
                [(14, 100 + k * 72) for k in range(25)] + [(1050, 100 + k * 72) for k in range(25)])
tpl = open(os.path.join(ROOT, "template.tpl")).read()
open(os.path.join(ROOT, "index.html"), "w").write(tpl.replace("{{TOTAL}}", str(TOTAL)).replace("{{SCENES}}", "\n".join(body))
    .replace("{{BULBS}}", bulbs).replace("{{CFG}}", json.dumps({"total": TOTAL, "scenes": SC})))
print("total", TOTAL, SC)
