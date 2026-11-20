"""KADIO CITY — 5 épisodes (un par service / formule). usage: python3 episodes.py <id>  → ep/<id>/index.html"""
import json, os, sys, shutil, html
R = os.path.dirname(os.path.abspath(__file__)); e = html.escape
EP = {
 "nattes": dict(sky=("#1b1446", "#5b2a86", "#e8508a", "#ff9f45", "#ffe08a"), acc="#ff3d7f", gold="#ffd36b",
   panels=["k7", "k5", "k1", "b-tresses-contour"], mission=("LES", "NATTES"), mbg="k5",
   play=[("img", "k1", "SECTIONNER ✓", "Trace des raies nettes."), ("img", "k5", "DESIGN EN CROISÉ ✓", "Dessine le motif."), ("img", "k7", "NATTES BIEN NETTES ✓", "Serre ferme, jamais trop.")],
   shop=[("NATTES BIEN NETTES", "DÈS 40 $"), ("DESIGNS EN CROISÉ", "DÈS 60 $")], win="k7", end="k5", music=("street", 30)),
 "twists": dict(sky=("#0f1a3d", "#1f4e8c", "#2ec4b6", "#ffb347", "#ffe8a3"), acc="#2ec4ff", gold="#ffd36b",
   panels=["twists-final", "k3", "vrai-salon-gestes", "b-degrade"], mission=("LES", "TWISTS"), mbg="twists-final",
   play=[("vid", "g_s1", "SÉPARER ✓", "Sépare et démêle."), ("vid", "g_s2", "LES RAIES ✓", "Au peigne à queue."), ("vid", "g_s3", "TWISTER ✓", "Ferme, jamais serré.")],
   shop=[("TWISTS BIEN NETS", "DÈS 55 $"), ("TWISTS + CONTOUR", "SUR DEMANDE")], win="vid:g_rev", end="twists-final", music=("street", 52)),
 "locks": dict(sky=("#13261a", "#1f6b4a", "#c9a227", "#ff7a3d", "#ffe0a0"), acc="#38d39f", gold="#ffd36b",
   panels=["vrai-locks", "k6", "b-profil-barbe", "twists-final"], mission=("LE CASSE", "DES LOCKS"), mbg="vrai-locks",
   play=[("img", "k6", "RACINES REPÉRÉES ✓", "Six semaines de repousse."), ("img", "vrai-locks", "RETWIST ✓", "Une par une. Précision."), ("img", "vrai-salon-gestes", "FINITIONS ✓", "Propre, net, durable.")],
   shop=[("RETWIST AU GEL · TÊTE COMPLÈTE", "150 $"), ("CLUB · ENTRETIEN DES LOCS", "65 $ / MOIS")], win="vrai-locks", end="k6", music=("street", 74)),
 "barbier": dict(sky=("#160b24", "#3a1c6e", "#ff3d3d", "#ff8a3d", "#ffd36b"), acc="#ff4d4d", gold="#ffd36b",
   panels=["b-degrade", "b-profil-barbe", "b-contour-allonge", "b-tresses-contour"], mission=("LE DÉGRADÉ", "PARFAIT"), mbg="b-profil-barbe",
   play=[("img", "b-degrade", "DÉGRADÉ ✓", "Zéro marque visible."), ("img", "b-contour-allonge", "CONTOURS ✓", "Ligne bien droite."), ("img", "b-profil-barbe", "BARBE ✓", "Bien dessinée.")],
   shop=[("COUPE", "50 $"), ("COUPE + BARBE", "60 $"), ("CONTOURS", "30 $")], win="b-degrade", end="b-profil-barbe", music=("street", 8)),
 "club": dict(sky=("#1a0b2e", "#4b1d78", "#b14fd8", "#ff6fb5", "#ffd1ec"), acc="#c06bff", gold="#ffd36b",
   panels=["b-profil-barbe", "vrai-locks", "k7", "twists-final"], mission=("REJOINS", "LE CLUB"), mbg="sortie-4",
   play=[("img", "b-degrade", "FRAIS TOUT LE MOIS ✓", "Prix fixe, chaque mois."), ("img", "k7", "0 $ DE DÉPÔT ✓", "Réserve sans dépôt."), ("img", "vrai-locks", "−15 % PRODUITS ✓", "Privilèges membres.")],
   shop=[("COUPE + BARBE", "19,99 $ / MOIS"), ("ENTRETIEN DES LOCS", "65 $ / MOIS"), ("TRESSES & COIFFAGE", "DÈS 39,99 $"), ("BARBIER ENFANT", "11,99 $ / MOIS")], win="sortie-4", end="b-profil-barbe", music=("street", 96), note="Taxes incluses. Détails au salon."),
}
K = sys.argv[1]; C = EP[K]; D = os.path.join(R, "ep", K)
for sub in ("art", "real", "fonts", "sfx", "clips"):
    if os.path.exists(os.path.join(D, sub)): shutil.rmtree(os.path.join(D, sub))
    shutil.copytree(os.path.join(R, sub), os.path.join(D, sub))
for f in ("gsap.min.js", "hyperframes.json", "package.json"): shutil.copy(os.path.join(R, f), D)
# timeline
TL = dict(L=(0, 3.6), M=(3.6, 2.8))
t = 6.4; P = []
for p in C["play"]: P.append((t, 2.7)); t += 2.7
TL["S"] = (t, 1.6 + .55 * len(C["shop"]) + 1.6); t += TL["S"][1]
TL["W"] = (t, 3.8); t += 3.8
TL["E"] = (t, 4.0); t += 4.0
TOTAL = round(t, 2)
sp = lambda s: "".join(f'<span class="ch">{e(c)}</span>' for c in s)
sky = C["sky"]
grad = f"linear-gradient(180deg,{sky[0]} 0%,{sky[1]} 30%,{sky[2]} 55%,{sky[3]} 74%,{sky[4]} 88%,{sky[0]} 100%)"
pos = [("left:40px;top:150px;width:560px;height:620px", -3), ("left:560px;top:120px;width:480px;height:520px", 4),
       ("left:60px;top:740px;width:470px;height:520px", 2), ("left:500px;top:610px;width:540px;height:660px", -2)]
pans = "".join(f'<div class="pan" id="p{i}" style="{pos[i][0]};background-image:url(art/{n}.jpg);transform:rotate({pos[i][1]}deg)"></div>' for i, n in enumerate(C["panels"]))
plays, steps = "", ""
for i, ((kind, src, lab, obj), (st, du)) in enumerate(zip(C["play"], P)):
    if kind == "vid": plays += f'<video id="g{i}" class="v clip" src="clips/{src}.mp4" muted playsinline data-start="{st}" data-duration="{du}" data-track-index="0"></video>'
    else: plays += f'<div id="g{i}" class="layer clip" data-start="{st}" data-duration="{du}" data-track-index="9"><div class="ph" style="background-image:url(real/{src}.jpg)"></div></div>'
    steps += f'<div id="st{i}" class="layer clip" data-start="{st}" data-duration="{du}" data-track-index="2"><div class="step">{e(lab)}</div></div>'
win = C["win"]
winhtml = (f'<video id="wv" class="v clip" src="clips/{win[4:]}.mp4" muted playsinline data-start="{TL["W"][0]}" data-duration="{TL["W"][1]}" data-track-index="0"></video>' if win.startswith("vid:")
           else f'<div id="wv" class="layer clip" data-start="{TL["W"][0]}" data-duration="{TL["W"][1]}" data-track-index="10"><div class="ph" style="background-image:url(real/{win}.jpg)"></div></div>')
shop = "".join(f'<div class="item"><span class="in">{e(a)}</span><span class="pr">{e(b)}</span></div>' for a, b in C["shop"])
body = f'''
<div id="L" class="layer clip" data-start="0" data-duration="{TL["L"][1]}" data-track-index="1">
  <div class="layer sky"></div><div class="sun"></div><div class="palms"></div>{pans}
  <div class="title" style="top:1300px"><div class="t1">{sp("KADIO CITY")}</div><div class="t2">ÉPISODE · {e(" ".join(C["mission"]))}</div></div>
  <div id="loadT">CHARGEMENT…</div><div id="load"><i></i></div></div>
<div id="M" class="layer clip" data-start="{TL["M"][0]}" data-duration="{TL["M"][1]}" data-track-index="6">
  <div class="layer" style="background:url(art/{C["mbg"]}.jpg) center 35%/cover"></div><div class="layer" style="background:rgba(14,6,30,.55)"></div>
  <div class="mission"><div class="m1">NOUVELLE MISSION</div><div class="m2">{sp(C["mission"][0])}<br>{sp(C["mission"][1])}</div></div></div>
{plays}{steps}
<div id="S" class="layer clip" data-start="{TL["S"][0]}" data-duration="{TL["S"][1]}" data-track-index="7">
  <div class="layer sky"></div><div class="sun" style="top:1150px"></div>
  <div class="shop"><div class="sh">BOUTIQUE KADIO</div>{shop}<div class="note">{e(C.get("note", "Prix à la visite. Détails au salon."))}</div></div></div>
{winhtml}
<div id="W" class="layer clip" data-start="{TL["W"][0] + .5}" data-duration="{TL["W"][1] - .5}" data-track-index="2">
  <div class="bandeau"></div><div class="ok"><div class="o1">{sp("MISSION")}<br>{sp("RÉUSSIE")}</div><div class="o2">+100 STYLE</div></div></div>
<div id="H" class="layer clip" data-start="{TL["M"][0]}" data-duration="{TL["E"][0] - TL["M"][0]}" data-track-index="3">
  <div id="objective"><small>OBJECTIF</small><span id="objT">Rends-toi chez Kadio Coiffure, 615 Antoinette-Robidoux.</span></div>
  <div id="money">$0</div><div id="stars"><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div>
  <div id="style"><b>STYLE</b><div class="bar"><i></i></div></div>
  <div id="map"><div class="route"></div><div class="route2"></div><div class="me"></div><div class="dest">K</div></div></div>
<div id="E" class="layer clip" data-start="{TL["E"][0]}" data-duration="{TL["E"][1]}" data-track-index="8">
  <div class="layer sky"></div><div id="poster" style="background-image:url(art/{C["end"]}.jpg)"></div>
  <div class="endT"><div class="e1">{sp("KADIO CITY")}</div><div class="e2">KADIO COIFFURE · LONGUEUIL</div><div class="e3">514 919-5970</div></div></div>
<div id="FX" class="layer clip" data-start="0" data-duration="{TOTAL}" data-track-index="5"><div id="scan" class="layer"></div><div id="flash" class="layer"></div></div>
'''
cfg = dict(total=TOTAL, TL=TL, P=P, objs=[p[3] for p in C["play"]], nshop=len(C["shop"]), isvid=[p[0] == "vid" for p in C["play"]], winvid=win.startswith("vid:"))
tpl = open(os.path.join(R, "episode.tpl")).read()
for k2, v in {"TOTAL": str(TOTAL), "BODY": body, "CFG": json.dumps(cfg, ensure_ascii=False), "SKY": grad, "ACC": C["acc"], "GOLD": C["gold"]}.items():
    tpl = tpl.replace("{{" + k2 + "}}", v)
open(os.path.join(D, "index.html"), "w").write(tpl)
json.dump({"music": C["music"]}, open(os.path.join(D, "music.json"), "w"))
open(os.path.join(D, "vo.json"), "w").write("[]")
print(K, "total", TOTAL)
