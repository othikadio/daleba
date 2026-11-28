"""Couvertures (aperçu du fil TikTok / Instagram) : gros mots-clés lisibles, dans la zone sûre centrale.
usage : python3 couverture.py <nom>  -> couvertures/<nom>.jpg (1080x1920)"""
import json, os, sys, asyncio
H = os.path.dirname(os.path.abspath(__file__)); F = os.path.join(H, "..", "montage", "premium", "fonts")
C = {
 "talk1": dict(fond="fond_talk1.jpg", a="#0f5c45", b="#e8b04a", serif="cormorant-garamond-latin-600-italic.woff2",
   l=[("s", "ENTRETIEN"), ("B", "LOCKS"), ("I", "dès 65 $ / mois")], pill="Places limitées"),
 "talk2": dict(fond="fond_talk2.jpg", a="#1f3cff", b="#ffffff", serif="bodoni-moda-latin-700-italic.woff2",
   l=[("s", "DOIS-JE"), ("I", "m'abonner"), ("B", "AVANT DE VENIR ?")], pill="La réponse en 5 s"),
}

PH = "../montage/premium/photos/"
C.update({
 "serv_stitch": dict(fond=PH + "s_stitch.jpg", a="#0e8fa3", b="#7ff0f7", serif="bodoni-moda-latin-700-italic.woff2", l=[("s", "NATTES"), ("B", "DESIGN"), ("I", "croisé")], pill="Dès 60 $"),
 "serv_locks": dict(fond=PH + "s_locks.jpg", a="#8a3b12", b="#f0a36b", serif="cormorant-garamond-latin-600-italic.woff2", l=[("s", "ENTRETIEN"), ("B", "LOCKS"), ("I", "retwist + soin")], pill="65 $ / mois"),
 "serv_creative": dict(fond=PH + "s_creative.jpg", a="#c2185b", b="#ffa3c8", serif="cormorant-garamond-latin-600-italic.woff2", l=[("s", "COUPE"), ("B", "CRÉATIVE"), ("I", "un cœur tracé")], pill="Sur rendez-vous"),
 "serv_design": dict(fond=PH + "s_design.jpg", a="#d4a017", b="#f7dc7c", serif="bodoni-moda-latin-700-italic.woff2", l=[("s", "TWISTS"), ("B", "& CONTOUR"), ("I", "lignes parfaites")], pill="Dès 55 $"),
 "doc_defri": dict(fond=PH + "d_boucles.jpg", a="#b3122a", b="#ffd9de", serif="bodoni-moda-latin-700-italic.woff2", l=[("s", "DÉFRISAGE"), ("B", "MISE EN PLIS"), ("I", "& boucles souples")], pill="Sur rendez-vous"),
 "serv_defri": dict(fond=PH + "d_fin.jpg", a="#a8864a", b="#e9cf9a", serif="bodoni-moda-latin-700-italic.woff2", l=[("s", "DÉFRISAGE"), ("B", "MISE EN PLIS"), ("I", "& boucles souples")], pill="Sur rendez-vous"),
 "serv_network": dict(fond=PH + "s_stitch.jpg", a="#B8922A", b="#f0d488", serif="cormorant-garamond-latin-600-italic.woff2", l=[("s", "KADIO NETWORK"), ("B", "DISPONIBLE"), ("I", "Longueuil · St-Jérôme · Montréal")], pill="Réserve en 60 s"),
 "serv_coupe": dict(fond=PH + "s_coupe.jpg", a="#13294b", b="#9cc2ff", serif="bodoni-moda-latin-700-italic.woff2", l=[("s", "COUPE"), ("B", "& BARBE"), ("I", "nette & dessinée")], pill="50 $ · 60 $"),
})
n = sys.argv[1]; c = C[n]
lines = "".join(f'<div class="{k}"' + (f' style="font-size:{min(190, int(1550 / len(t)))}px;white-space:nowrap"' if k == "B" else f' style="font-size:{min(150, int(1650 / len(t)))}px;white-space:nowrap"' if k == "I" else "") + f'>{t}</div>' for k, t in c["l"])
html = f"""<html><head><meta charset="utf-8"><style>
@font-face {{ font-family: ID; src: url(file://{F}/InterDisplay-Black.otf); font-weight: 900; }}
@font-face {{ font-family: ID; src: url(file://{F}/InterDisplay-Bold.otf); font-weight: 700; }}
@font-face {{ font-family: SR; src: url(file://{F}/{c['serif']}); font-style: italic; }}
body {{ margin: 0; width: 1080px; height: 1920px; position: relative; overflow: hidden; font-family: ID; }}
.bg {{ position: absolute; inset: 0; background: url(file://{H}/{c['fond']}) center/cover; filter: brightness(.62) saturate(.9); }}
.sh {{ position: absolute; inset: 0; background: radial-gradient(80% 40% at 50% 66%, rgba(0,0,0,.55), rgba(0,0,0,0) 75%); }}
.box {{ position: absolute; left: 60px; right: 60px; top: 1260px; transform: translateY(-50%); text-align: center; color: #fff; }}
.s {{ font: 900 64px ID; letter-spacing: .28em; margin-bottom: 18px; text-shadow: 0 4px 24px rgba(0,0,0,.6); }}
.B {{ font: 900 190px/0.92 ID; letter-spacing: -.05em; text-shadow: 0 8px 40px rgba(0,0,0,.6); }}
.I {{ font: italic 700 150px/1.05 SR; color: {c['b']}; text-shadow: 0 6px 30px rgba(0,0,0,.7); }}
.pill {{ display: inline-block; margin-top: 46px; padding: 24px 50px; border-radius: 999px; background: {c['a']}; color: #fff; font: 900 50px ID; }}
.brand {{ margin-top: 30px; color: rgba(255,255,255,.9); font: 900 34px ID; letter-spacing: .3em; }}
</style></head><body><div class="bg"></div><div class="sh"></div>
<div class="box">{lines}<div class="pill">{c["pill"]}</div><div class="brand">KADIO COIFFURE</div></div></body></html>"""
open(os.path.join(H, n + ".html"), "w").write(html)
import subprocess
js = "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});await p.goto(process.argv[1]);await p.waitForTimeout(600);await p.screenshot({path:process.argv[2],type:'jpeg',quality:92});await b.close();})();"
subprocess.run(["node", "-e", js, "file://" + os.path.join(H, n + ".html"), os.path.join(H, n + ".jpg")], check=True, env=dict(os.environ, NODE_PATH=subprocess.check_output(["npm", "root", "-g"]).decode().strip()))
os.remove(os.path.join(H, n + ".html")); print("ok", n)
