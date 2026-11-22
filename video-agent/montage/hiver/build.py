"""Série MODE HIVER — 5 capsules motion design (soins des cheveux au froid).
usage: python3 build.py v1  → v1/index.html, v1/vo.json, v1/music.json
Lit spec.json (voix), vo/<v>_<i>.wav, broll/*.mp4 (plans Higgsfield)."""
import json, os, sys, shutil, html, subprocess, soundfile as sf
R = os.path.dirname(os.path.abspath(__file__)); V = sys.argv[1]; D = os.path.join(R, V)
S = json.load(open(os.path.join(R, "spec.json")))[V]
SH = os.path.join(R, "..", "serie10", "shared")
e = html.escape

# ---------- icônes (traits) ----------
IC = {
 "drop": '<path d="M50 8 C50 8 18 46 18 64 a32 32 0 0 0 64 0 C82 46 50 8 50 8z"/><path d="M34 66 a16 16 0 0 0 14 14"/>',
 "oil": '<rect x="34" y="30" width="32" height="60" rx="8"/><rect x="42" y="14" width="16" height="16" rx="3"/><path d="M40 60 h20"/>',
 "jar": '<rect x="20" y="38" width="60" height="50" rx="10"/><rect x="16" y="22" width="68" height="16" rx="5"/><path d="M34 62 q16 -12 32 0"/>',
 "beanie": '<path d="M16 70 q0 -48 34 -48 q34 0 34 48z"/><rect x="12" y="68" width="76" height="16" rx="6"/><circle cx="50" cy="16" r="8"/>',
 "wave": '<path d="M8 40 q14 -16 28 0 t28 0 t28 0"/><path d="M8 60 q14 -16 28 0 t28 0 t28 0"/><path d="M8 80 q14 -16 28 0 t28 0 t28 0"/>',
 "moon": '<path d="M64 14 a36 36 0 1 0 22 58 a30 30 0 1 1 -22 -58z"/>',
 "dryer": '<circle cx="40" cy="40" r="26"/><circle cx="40" cy="40" r="10"/><path d="M52 62 l10 28 h-14 l-6 -18"/><path d="M70 32 h18 M70 42 h22 M70 52 h18"/>',
 "shield": '<path d="M50 10 l34 12 v24 c0 24 -16 38 -34 46 c-18 -8 -34 -22 -34 -46 v-24z"/><path d="M36 50 l10 10 l20 -22"/>',
 "clock": '<circle cx="50" cy="52" r="36"/><path d="M50 30 v22 l14 10"/>',
 "braid": '<path d="M38 10 q24 12 0 26 q-24 14 0 26 q24 14 0 26"/><path d="M62 10 q-24 12 0 26 q24 14 0 26 q-24 14 0 26"/>',
 "mist": '<rect x="28" y="56" width="44" height="34" rx="12"/><path d="M40 46 q-8 -10 0 -20 q8 -10 0 -20"/><path d="M60 46 q-8 -10 0 -20 q8 -10 0 -20"/>',
 "glass": '<path d="M26 14 h48 l-6 76 h-36z"/><path d="M30 44 h40"/>',
 "hand": '<path d="M30 90 v-40 q0 -8 8 -8 q8 0 8 8 v-26 q0 -8 8 -8 q8 0 8 8 v26 q0 -6 7 -6 q7 0 7 8 v24 q0 22 -22 22 h-6 q-18 0 -18 -8z"/>',
 "beard": '<path d="M18 30 q0 50 32 62 q32 -12 32 -62 q-10 18 -32 18 q-22 0 -32 -18z"/><path d="M38 66 q12 8 24 0"/>',
 "snow": '<path d="M50 8 v84 M14 29 l72 42 M14 71 l72 -42"/><path d="M42 16 l8 8 l8 -8 M42 84 l8 -8 l8 8"/>',
 "pin": '<path d="M50 92 c-20 -26 -30 -40 -30 -54 a30 30 0 0 1 60 0 c0 14 -10 28 -30 54z"/><circle cx="50" cy="38" r="10"/>',
}
ico = lambda k, cls="ico": f'<svg class="{cls}" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">{IC[k]}</svg>'

# ---------- 5 styles différents ----------
T = {
 "v1": dict(mode="givre", font="Anton", ff="anton-latin-400-normal.woff2", bg="#081a3a", bg2="#123a7a", fg="#ffffff", ac="#5be7ff", ac2="#ff5fa2", ink="#081a3a",
            music=("lounging-moonlight", 6), temp=-20, hook=["LE FROID", "ATTAQUE TES", "CHEVEUX."],
            words=["SECS", "TERNES", "CASSANTS"], wicon="snow",
            steps=[("drop", "EAU", "ou spray hydratant"), ("oil", "HUILE", "pour garder l'eau"), ("jar", "CRÈME", "pour tout sceller")], steptitle="3 COUCHES",
            tipbig="2–3×", tipsub="par semaine", tipnote="surtout sur les pointes", tipicon="clock",
            bgs=["v1_0", "v1_0", "v1_1", "v1_1"]),
 "v2": dict(mode="satin", font="Fredoka", ff="fredoka-latin-700-normal.woff2", bg="#2a0f3d", bg2="#6b1f6e", fg="#fff4fb", ac="#ff8fc7", ac2="#c6ff4a", ink="#2a0f3d",
            music=("cat-walk", 4), temp=-12, hook=["TON BONNET", "ABÎME TES", "CHEVEUX ?"],
            words=["LAINE", "ACRYLIQUE", "FROTTEMENT"], wicon="beanie",
            steps=[("beanie", "BONNET", "doublé de satin"), ("wave", "FOULARD", "en satin, en dessous")], steptitle="LA SOLUTION",
            tipbig="LA NUIT", tipsub="aussi", tipnote="taie ou bonnet en satin", tipicon="moon",
            bgs=["v2_0", "v2_0", None, None]),
 "v3": dict(mode="alerte", font="Archivo", ff="archivo-black-latin-400-normal.woff2", bg="#eaf6ff", bg2="#bfe3ff", fg="#0a2a66", ac="#ff6a00", ac2="#1f6bff", ink="#0a2a66",
            music=("midnight-funk", 0), temp=-15, hook=["CHEVEUX", "MOUILLÉS", "DEHORS ?"],
            words=["GEL", "RAIDES", "CASSÉS"], wicon="snow",
            steps=[("moon", "LE SOIR", "lave-les le soir"), ("dryer", "SÈCHE", "jusqu'aux racines"), ("clock", "CHALEUR", "moyenne, jamais au max")], steptitle="LE BON RÉFLEXE",
            tipbig="PROTECTEUR", tipsub="de chaleur", tipnote="toujours avec le séchoir", tipicon="shield",
            bgs=[None, "v1_0", None, None]),
 "v4": dict(mode="pop", font="Bangers", ff="bangers-latin-400-normal.woff2", bg="#ffcf3c", bg2="#ff9a1f", fg="#1a0f0a", ac="#ff3d6e", ac2="#2b59ff", ink="#1a0f0a",
            music=("deep-urban", 2), temp=-18, hook=["TES POINTES", "SOUFFRENT", "EN PREMIER"],
            words=["FOULARD", "MANTEAU", "COL"], wicon="braid",
            steps=[("braid", "NATTES", ""), ("wave", "TWISTS", ""), ("hand", "LOCKS", "")], steptitle="COIFFURE PROTECTRICE",
            prices=[("NATTES", "dès 40 $"), ("TWISTS", "dès 55 $")],
            bgs=[None, "v2_0", None, None]),
 "v5": dict(mode="vapeur", font="Righteous", ff="righteous-latin-400-normal.woff2", bg="#062e33", bg2="#0d5a5a", fg="#eafff8", ac="#3ef0b5", ac2="#ff7a59", ink="#062e33",
            music=("smooth-jazz", 3), temp=22, hook=["CHAUFFAGE", "CUIR CHEVELU", "À SEC ?"],
            words=["ÇA TIRE", "ÇA GRATTE", "ÇA PÈLE"], wicon="beard",
            steps=[("glass", "EAU", "bois plus"), ("mist", "HUMIDIFICATEUR", "dans ta chambre"), ("oil", "HUILE LÉGÈRE", "massage du cuir chevelu")], steptitle="3 GESTES",
            tipbig="19,99 $", tipsub="/ mois", tipnote="Club Kadio · coupe + barbe", tipicon="beard",
            bgs=[None, None, None, None]),
}[V]

# ---------- minutage (voix) ----------
LEAD, TAIL = .3, .45
SCH, t = [], 0.0
for i in range(5):
    d = sf.info(os.path.join(R, "vo", f"{V}_{i}.wav")).duration
    dur = max(3.4, LEAD + d + TAIL) + (2.4 if i == 4 else 0)
    SCH.append((round(t, 2), round(dur, 2))); t += dur
TOTAL = round(t, 2)

os.makedirs(os.path.join(D, "media"), exist_ok=True)
json.dump([{"t": round(s + LEAD, 2), "file": f"{V}_{i}.wav"} for i, (s, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
json.dump({"music": T["music"]}, open(os.path.join(D, "music.json"), "w"))
shutil.copytree(os.path.join(SH, "fonts"), os.path.join(D, "fonts"), dirs_exist_ok=True)
shutil.copytree(os.path.join(SH, "sfx"), os.path.join(D, "sfx"), dirs_exist_ok=True)
for f in ("gsap.min.js", "hyperframes.json", "package.json"): shutil.copy(os.path.join(R, "..", "prospects-noel", f), D)
for f in ("winter-wind.mp3", "swoosh-wind.mp3"):
    w = os.path.join(D, "sfx", f.replace(".mp3", ".wav"))
    if not os.path.exists(w): subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(SH, "music", f), "-ar", "48000", w])

# plans vidéo : regroupe les scènes consécutives qui partagent un plan, étire en aller-retour au ralenti
vids, k = [], 0
while k < 4:
    b = T["bgs"][k]; j = k
    while j + 1 < 4 and T["bgs"][j + 1] == b: j += 1
    if b:
        st, du = SCH[k][0], SCH[j][0] + SCH[j][1] - SCH[k][0]
        src = os.path.join(R, "broll", b + ".mp4"); name = f"{b}_{k}.mp4"; out = os.path.join(D, "media", name)
        if os.path.exists(src):
            f = max(1.0, du / 10.0)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-filter_complex",
                            f"[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1,setpts={f:.3f}*PTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30",
                            "-an", "-t", f"{du:.2f}", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", out], check=True)
            vids.append((name, st, du))
    k = j + 1

def subt(x):
    for a, b in [("kadyo coiffure point com", "kadiocoiffure.com"), ("Kadyo", "Kadio"), ("dix-neuf, quatre-vingt-dix-neuf", "19,99 $"), ("quarante dollars", "40 $"),
                 ("cinquante-cinq", "55 $"), ("Moins vingt", "Moins 20°"), ("moins quinze", "moins 15°"), ("Six cent quinze", "615")]: x = x.replace(a, b)
    return x
sp = lambda s: " ".join('<span class="w">' + "".join(f'<span class="ch">{e(c)}</span>' for c in w) + '</span>' for w in s.split(" "))
flakes = "".join(f'<i class="sn" style="left:{(n * 97) % 1080}px;width:{6 + n % 4 * 4}px;height:{6 + n % 4 * 4}px;opacity:{.35 + (n % 5) * .12:.2f}"></i>' for n in range(44))
steps = "".join(f'<div class="step"><div class="num">{n + 1}</div>{ico(ic)}<div class="st"><b>{e(a)}</b>{f"<small>{e(b)}</small>" if b else ""}</div></div>' for n, (ic, a, b) in enumerate(T["steps"]))
if "prices" in T:
    tip = '<div class="prices">' + "".join(f'<div class="price"><span>{e(a)}</span><b>{e(b)}</b></div>' for a, b in T["prices"]) + '</div><div class="tipnote">chez Kadio Coiffure</div>'
else:
    tip = f'<div class="tip">{ico(T["tipicon"], "tipico")}<div class="tipbig">{e(T["tipbig"])}</div><div class="tipsub">{e(T["tipsub"])}</div><div class="tipnote">{e(T["tipnote"])}</div></div>'
temp = f'{T["temp"]}°'
body = f'''
<div id="bg" class="layer"><div class="grad layer"></div><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>{ico(T["wicon"], "bigico")}</div>
{"".join(f'<video id="vid{n}" class="v clip" src="media/{nm}" muted playsinline data-start="{st}" data-duration="{du:.2f}" data-track-index="{n % 2}"></video>' for n, (nm, st, du) in enumerate(vids))}
<div id="tint" class="layer"></div>
<div id="snow" class="layer">{flakes}</div>
<div id="frost" class="layer"></div>
<div id="s0" class="sc layer"><div class="temp">{temp}</div><div class="hook">{"".join(f'<div class="hl{" acc" if n == 1 else ""}">{sp(l)}</div>' for n, l in enumerate(T["hook"]))}</div></div>
<div id="s1" class="sc layer"><div class="why">POURQUOI ?</div><div class="words">{"".join(f'<div class="word">{e(w)}</div>' for w in T["words"])}</div><svg class="crack" viewBox="0 0 1080 300"><path d="M0 150 L180 120 L260 190 L400 100 L520 170 L640 80 L760 200 L880 120 L1080 160"/></svg></div>
<div id="s2" class="sc layer"><div class="stitle">{e(T["steptitle"])}</div><div class="steps n{len(T["steps"])}">{steps}</div></div>
<div id="s3" class="sc layer">{tip}</div>
<div id="s4" class="sc layer"><div class="end"><div class="eyebrow">MODE HIVER · conseil pro</div><div class="ename">{sp("KADIO")}<br>{sp("COIFFURE")}</div><div class="rule"></div>
  <div class="lieu">{ico("pin", "pin")} 615, Antoinette-Robidoux · Longueuil</div><div class="site">kadiocoiffure.com</div><div class="tel">514 919-5970</div></div></div>
{"".join(f'<div class="sub" id="sub{i}"><span>{e(subt(S["vo"][i]))}</span></div>' for i in range(4))}
<div id="chip"><span>{ico("snow", "cs")} MODE HIVER</span><b>{V[1]}/5</b></div>
{'<div id="ai">Images d’illustration générées par IA</div>' if vids else ''}
<div id="flash" class="layer"></div>
'''
tpl = open(os.path.join(R, "template.tpl")).read()
for k2, v in {"TOTAL": str(TOTAL), "BODY": body, "CFG": json.dumps({"total": TOTAL, "scenes": SCH, "mode": T["mode"], "temp": T["temp"], "vids": [[f"#vid{n}", st] for n, (_, st, _) in enumerate(vids)]}),
              "BG": T["bg"], "BG2": T["bg2"], "FG": T["fg"], "AC": T["ac"], "AC2": T["ac2"], "INK": T["ink"], "FONT": T["font"], "FF": T["ff"]}.items():
    tpl = tpl.replace("{{" + k2 + "}}", v)
open(os.path.join(D, "index.html"), "w").write(tpl)
print(V, "total", TOTAL, SCH, "plans", vids)
