"""Pubs de démonstration pour 5 commerces (prospects Noël). usage: python3 build.py <cle>
Lit spec.json (voix + coordonnées), vo/<cle>_<i>.wav, broll/<cle>_<i>.mp4 → <cle>/index.html, vo.json"""
import json, os, sys, shutil, html, soundfile as sf
R = os.path.dirname(os.path.abspath(__file__)); K = sys.argv[1]; D = os.path.join(R, K)
S = json.load(open(os.path.join(R, "spec.json")))[K]
STY = {
 "lulu": dict(bg="#fff4e6", fg="#3a2414", ac="#e8833a", ac2="#f49ac1", font="Fredoka", ff="fredoka-latin-700-normal.woff2", music=("sun-kissed-skin", 8),
              hook="ÇA SENT LE BEURRE CHAUD", keys=["Dorées", "Moelleuses", "À partager"], offre="Pour le réveillon : gâtez-vous.", deco="❄"),
 "chocolatine": dict(bg="#2b1810", fg="#fbe9d0", ac="#e8b04a", ac2="#c2410c", font="Caladea", ff="Caladea-Bold.ttf", music=("lounging-moonlight", 4),
              hook="PAS LES MAINS VIDES.", keys=["Choisir", "Emballer", "Offrir"], offre="Le cadeau qui se mange.", deco="✦"),
 "istanbul": dict(bg="#7a1120", fg="#fff7ea", ac="#f2c14e", ac2="#2ec4b6", font="Righteous", ff="righteous-latin-400-normal.woff2", music=("island-beat", 10),
              hook="UNE GRANDE TABLE.", keys=["Grillades", "Pain chaud", "Partage"], offre="Réservez votre repas de groupe.", deco="✶"),
 "fiori": dict(bg="#fdf6ec", fg="#1d1d1d", ac="#d62828", ac2="#1f8a4c", font="Archivo", ff="archivo-black-latin-400-normal.woff2", music=("christmas-dance", 2),
              hook="LE PARTY COMMENCE ICI.", keys=["Ça file", "Ça part", "Ça fête"], offre="Pour toute la gang.", deco="★"),
 "vanity": dict(bg="#f9e1e6", fg="#141414", ac="#b76e5d", ac2="#141414", font="Cinzel", ff="cinzel-latin-700-normal.woff2", music=("fashion", 12),
              hook="UN MOMENT POUR VOUS.", keys=["Soin", "Détail", "Éclat"], offre="Brillez tout décembre.", deco="✧"),
}[K]
LEAD, TAIL = .35, .55
SCH, t = [], 0.0
for i in range(4):
    d = sf.info(os.path.join(R, "vo", f"{K}_{i}.wav")).duration
    dur = max(3.6, LEAD + d + TAIL) + (2.6 if i == 3 else 0)
    SCH.append((round(t, 2), round(dur, 2))); t += dur
TOTAL = round(t, 2)
os.makedirs(D, exist_ok=True)
json.dump([{"t": round(s + LEAD, 2), "file": f"{K}_{i}.wav"} for i, (s, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
for sub in ("fonts", "sfx"): shutil.copytree(os.path.join(R, sub), os.path.join(D, sub), dirs_exist_ok=True)
os.makedirs(os.path.join(D, "broll"), exist_ok=True)
for i in range(3): shutil.copy(os.path.join(R, "broll", f"{K}_{i}.mp4"), os.path.join(D, "broll", f"b{i}.mp4"))
for f in ("gsap.min.js", "hyperframes.json", "package.json"): shutil.copy(os.path.join(R, f), D)
e = html.escape
sp = lambda s: " ".join('<span class="w">' + "".join(f'<span class="ch">{e(c)}</span>' for c in w) + '</span>' for w in s.split(" "))
vids = "".join(f'<video id="b{i}" class="v clip" src="broll/b{i}.mp4" muted playsinline data-start="{SCH[i][0]}" data-duration="{min(SCH[i][1], 5.0)}" data-track-index="0"></video>' for i in range(3))
subs = "".join(f'<div class="sub clip" data-start="{SCH[i][0] + LEAD}" data-duration="{SCH[i][1] - LEAD - .1}" data-track-index="3"><span>{e(S["vo"][i])}</span></div>' for i in range(3))
snow = "".join(f'<i class="fl" style="left:{(k * 137) % 1060}px;top:{(k * 293) % 1900}px;font-size:{22 + (k * 11) % 26}px">{STY["deco"]}</i>' for k in range(22))
body = f'''
{vids}
<div id="sh" class="layer clip" data-start="0" data-duration="{SCH[3][0]}" data-track-index="1"><div class="shade layer"></div></div>
<div id="s0" class="layer clip" data-start="{SCH[0][0]}" data-duration="{SCH[0][1]}" data-track-index="2">
  <div class="hook">{sp(" ".join(STY["hook"].split(" ")[:-1]))} <span class="last">{sp(STY["hook"].split(" ")[-1])}</span></div></div>
<div id="s1" class="layer clip" data-start="{SCH[1][0]}" data-duration="{SCH[1][1]}" data-track-index="2">
  <div class="name">{sp(S["nom"])}</div><div class="keys">{"".join(f'<span class="key">{e(k)}</span>' for k in STY["keys"])}</div></div>
<div id="s2" class="layer clip" data-start="{SCH[2][0]}" data-duration="{SCH[2][1]}" data-track-index="2">
  <div class="offre"><span class="tag">FÊTES 2026</span><div class="ot">{e(STY["offre"])}</div></div></div>
<div id="s3" class="layer clip" data-start="{SCH[3][0]}" data-duration="{SCH[3][1]}" data-track-index="1">
  <div class="endbg layer"></div>{snow}
  <div class="end"><div class="eyebrow">Joyeuses Fêtes</div><div class="ename">{sp(S["nom"])}</div><div class="rule"></div>
  <div class="lieu">{e(S["lieu"])}</div>{f'<div class="tel">{e(S["tel"])}</div>' if S["tel"] else ''}</div></div>
{subs}
<div id="ui" class="layer clip" data-start="0" data-duration="{TOTAL}" data-track-index="4"><div class="badge">MAQUETTE · images d'illustration</div></div>
<div id="fx" class="layer clip" data-start="0" data-duration="{TOTAL}" data-track-index="5"><div id="flash" class="layer"></div></div>
'''
tpl = open(os.path.join(R, "template.tpl")).read()
for k2, v in {"TOTAL": str(TOTAL), "BODY": body, "CFG": json.dumps({"total": TOTAL, "scenes": SCH}),
              "BG": STY["bg"], "FG": STY["fg"], "AC": STY["ac"], "AC2": STY["ac2"], "FONT": STY["font"], "FF": STY["ff"]}.items():
    tpl = tpl.replace("{{" + k2 + "}}", v)
open(os.path.join(D, "index.html"), "w").write(tpl)
json.dump({"music": STY["music"]}, open(os.path.join(D, "music.json"), "w"))
print(K, "total", TOTAL, SCH)
