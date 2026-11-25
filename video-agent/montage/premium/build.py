"""Films haut de gamme Kadio Coiffure (photos réelles du salon, sans voix).
usage: python3 build.py maison|signature|bienvenue → <film>/index.html (+ vo.json vide, music.json)"""
import json, os, sys, shutil, html
import numpy as np
from PIL import Image

R = os.path.dirname(os.path.abspath(__file__)); F = sys.argv[1]; D = os.path.join(R, F)
e = html.escape
sp = lambda s: " ".join('<span class="w">' + "".join(f'<span class="ch">{e(c)}</span>' for c in w) + '</span>' for w in s.split(" "))

os.makedirs(D, exist_ok=True)
for sub in ("photos", "fonts", "sfx"): shutil.copytree(os.path.join(R, sub), os.path.join(D, sub), dirs_exist_ok=True)
for f in ("gsap.min.js", "hyperframes.json", "package.json"): shutil.copy(os.path.join(R, "..", "prospects-noel", f), D)
g = os.path.join(D, "grain.png")
if not os.path.exists(g):
    rng = np.random.default_rng(7); n = rng.normal(128, 40, (512, 512)).clip(0, 255).astype(np.uint8)
    Image.fromarray(n, "L").save(g)
json.dump([], open(os.path.join(D, "vo.json"), "w"))

CSS = """
@font-face { font-family: Corm; src: url(fonts/cormorant-garamond-latin-300-normal.woff2); font-weight: 300; }
@font-face { font-family: Corm; src: url(fonts/cormorant-garamond-latin-500-normal.woff2); font-weight: 500; }
@font-face { font-family: Corm; src: url(fonts/cormorant-garamond-latin-600-normal.woff2); font-weight: 600; }
@font-face { font-family: Corm; src: url(fonts/cormorant-garamond-latin-300-italic.woff2); font-weight: 300; font-style: italic; }
@font-face { font-family: Corm; src: url(fonts/cormorant-garamond-latin-500-italic.woff2); font-weight: 500; font-style: italic; }
@font-face { font-family: Outfit; src: url(fonts/outfit-latin-300-normal.woff2); font-weight: 300 500; }
@font-face { font-family: Outfit; src: url(fonts/outfit-latin-700-normal.woff2); font-weight: 600 800; }
@font-face { font-family: Outfit; src: url(fonts/outfit-latin-900-normal.woff2); font-weight: 900; }
@font-face { font-family: Vibes; src: url(fonts/great-vibes-latin-400-normal.woff2); }
@font-face { font-family: Bodoni; src: url(fonts/bodoni-moda-latin-400-normal.woff2); font-weight: 400; }
@font-face { font-family: Bodoni; src: url(fonts/bodoni-moda-latin-700-normal.woff2); font-weight: 700; }
@font-face { font-family: Bodoni; src: url(fonts/bodoni-moda-latin-400-italic.woff2); font-weight: 400; font-style: italic; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: var(--bg); color: var(--fg); }
.layer { position: absolute; inset: 0; }
.ch { display: inline-block; white-space: pre; } .w { display: inline-block; white-space: nowrap; }
.ph { position: absolute; inset: 0; overflow: hidden; visibility: hidden; }
.ph img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; }
#grain { background: url(grain.png); opacity: .07; mix-blend-mode: overlay; pointer-events: none; }
.vig { background: radial-gradient(120% 90% at 50% 50%, transparent 45%, rgba(0,0,0,.75) 100%); pointer-events: none; }
.leak { position: absolute; width: 1600px; height: 1600px; left: -260px; top: 160px; border-radius: 50%; background: radial-gradient(circle, rgba(255,160,70,.75), rgba(255,90,40,.25) 40%, transparent 68%); mix-blend-mode: screen; opacity: 0; pointer-events: none; }
.txt { position: absolute; visibility: hidden; z-index: 30; }
.vig { z-index: 25; } .leak { z-index: 26; } #grain { z-index: 200; }
"""

JS_HEAD = """
const tl = gsap.timeline({ paused: true }); const CUES = [];
const cue = (t, f, g) => CUES.push({ t: +Math.max(0, t).toFixed(3), file: f, gain: g == null ? .5 : g });
function show(sel, t0, t1) { tl.set(sel, { autoAlpha: 0 }, 0); tl.set(sel, { autoAlpha: 1 }, t0); if (t1 != null) tl.set(sel, { autoAlpha: 0 }, t1); }
function fin(sel, t, d, a, b) { tl.fromTo(sel, a, Object.assign({ duration: d, immediateRender: false }, b), t); tl.set(sel, a, 0); }
function kb(sel, t, d, a, b) { tl.fromTo(sel, a, Object.assign({ duration: d, ease: "none", immediateRender: false }, b), t); tl.set(sel, a, 0); }
function grain(T) { let s = 7; for (let k = 0; k * .083 < T; k++) { s = (s * 9301 + 49297) % 233280; const x = s % 512; s = (s * 9301 + 49297) % 233280; tl.set("#grain", { backgroundPosition: x + "px " + (s % 512) + "px" }, k * .083); } }
function leak(t, d) { tl.fromTo(".leak", { opacity: 0, x: -500, scale: .8 }, { opacity: 1, x: 200, scale: 1.1, duration: d * .5, ease: "sine.in", immediateRender: false }, t); tl.to(".leak", { opacity: 0, x: 700, duration: d * .5, ease: "sine.out" }, t + d * .5); }
"""

def page(title, css, body, js, total, music):
    json.dump({"music": music}, open(os.path.join(D, "music.json"), "w"))
    return f"""<!doctype html>
<html lang="fr" data-resolution="portrait"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080, height=1920">
<title>{title}</title><script src="gsap.min.js"></script><style>{CSS}{css}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{total}" data-width="1080" data-height="1920">
{body}
<div id="grain" class="layer"></div>
</div>
<script>{JS_HEAD}
const T = {total};
{js}
grain(T);
window.__cues = CUES; window.__timelines = window.__timelines || {{}}; window.__timelines["main"] = tl; tl.seek(0);
</script></body></html>"""

# =====================================================================
if F == "maison":
    T = 21.0
    css = """
:root { --bg: #070605; --fg: #f3e6cf; --gold: #d9b26f; }
.bar { position: absolute; left: 0; right: 0; height: 250px; background: #000; z-index: 20; }
.bar.t { top: 0; } .bar.b { bottom: 0; }
.ph img { filter: contrast(1.1) saturate(1.08) brightness(.92) sepia(.12); }
.tint { background: linear-gradient(180deg, rgba(20,10,0,.25), rgba(0,0,0,0) 40%, rgba(0,0,0,.55)); }
.title { left: 80px; right: 80px; top: 1180px; text-align: center; font: italic 300 118px/1.02 Corm; color: var(--fg); text-shadow: 0 6px 40px rgba(0,0,0,.6); }
.title b { font-weight: 500; color: var(--gold); }
.cap { left: 0; right: 0; bottom: 330px; text-align: center; font: 600 40px Corm; letter-spacing: .55em; color: var(--fg); text-transform: uppercase; text-indent: .55em; }
.cap i { display: block; margin: 0 auto 22px; width: 70px; height: 2px; background: var(--gold); }
.top { left: 0; right: 0; top: 300px; text-align: center; font: 500 26px Corm; letter-spacing: .6em; text-indent: .6em; color: var(--gold); }
.quote { left: 90px; right: 90px; top: 1200px; text-align: center; font: italic 300 92px/1.05 Corm; color: var(--fg); text-shadow: 0 6px 40px rgba(0,0,0,.6); }
#end { background: radial-gradient(70% 45% at 50% 42%, #2a1608 0%, #070605 70%); visibility: hidden; }
.logo { position: absolute; left: 0; right: 0; top: 640px; text-align: center; font: 190px/1 Vibes; color: #ffd9a0;
  text-shadow: 0 0 8px #ffb35c, 0 0 24px #ff9a2e, 0 0 60px #ff7a00, 0 0 110px rgba(255,120,0,.6); }
.logo2 { top: 830px; }
.ring { position: absolute; left: 190px; top: 540px; width: 700px; height: 700px; border-radius: 50%; border: 6px solid #ffd9a0;
  box-shadow: 0 0 14px #ffb35c, 0 0 40px #ff8a1e, inset 0 0 14px #ffb35c, inset 0 0 40px rgba(255,138,30,.6); }
.info { position: absolute; left: 0; right: 0; top: 1340px; text-align: center; color: var(--fg); }
.info .r { width: 120px; height: 2px; background: var(--gold); margin: 0 auto 40px; }
.info p { font: 500 40px/1.5 Corm; letter-spacing: .12em; }
.info .s { margin-top: 26px; font: 600 30px Corm; letter-spacing: .5em; text-indent: .5em; color: var(--gold); text-transform: uppercase; }
"""
    shots = [("neon_a", 0.0, 5.6), ("h_croises", 5.6, 8.3), ("h_zigzag", 8.3, 11.0), ("h_locks", 11.0, 13.7), ("lounge", 13.7, 16.9)]
    body = "".join(f'<div id="p{i}" class="ph"><img src="photos/{n}.jpg"><div class="layer tint"></div></div>' for i, (n, a, b) in enumerate(shots))
    body += f"""
<div class="layer vig"></div><div class="leak"></div>
<div id="t0" class="txt top">KADIO COIFFURE · LONGUEUIL</div>
<div id="t1" class="txt title">{sp("L'art")}<br><b>{sp("de la tresse.")}</b></div>
<div id="c1" class="txt cap"><i></i>Designs en croisé</div>
<div id="c2" class="txt cap"><i></i>Zigzag</div>
<div id="c3" class="txt cap"><i></i>Locks</div>
<div id="t4" class="txt quote">{sp("Un lieu pensé")}<br>{sp("pour vous.")}</div>
<div id="end" class="layer"><div class="ring"></div><div class="logo">{sp("Kadio")}</div><div class="logo logo2">{sp("Coiffure")}</div>
  <div class="info"><div class="r"></div><p>615, Antoinette-Robidoux · Longueuil</p><p>514 919-5970</p><div class="s">kadiocoiffure.com</div></div></div>
<div class="bar t"></div><div class="bar b"></div>"""
    js = """
const S = %s;
S.forEach(function (s, i) { show("#p" + i, s[1], s[2] + .6); });
// fondus enchaînés
S.forEach(function (s, i) { if (i) fin("#p" + i, s[1], .6, { opacity: 0 }, { opacity: 1, ease: "sine.inOut" }); });
// 0 : le néon s'allume dans le noir
const img0 = "#p0 img";
tl.set(img0, { filter: "brightness(0) contrast(1.1) saturate(1.1)" }, 0);
[[.7, .55], [.78, .05], [.9, .8], [.98, .15], [1.12, 1]].forEach(function (k) { tl.set(img0, { filter: "brightness(" + k[1] + ") contrast(1.1) saturate(1.1) sepia(.12)" }, k[0]); });
cue(.68, "neon_flick.wav", .6); cue(1.0, "neon_hum.wav", .25);
kb(img0, 0, 5.6, { scale: 1.18, y: 40 }, { scale: 1.02, y: 0 });
show("#t0", 1.6, 5.2); fin("#t0", 1.6, 1.2, { opacity: 0, letterSpacing: "1.2em" }, { opacity: 1, letterSpacing: ".6em", ease: "expo.out" });
show("#t1", 2.6, 5.5);
fin("#t1 .ch", 2.6, .9, { opacity: 0, y: 30, filter: "blur(12px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .045, ease: "power3.out" }); cue(2.6, "sparkle.wav", .25);
tl.to("#t1, #t0", { opacity: 0, duration: .5 }, 5.0);
// réalisations : lente montée + légende
[["#p1 img", "#c1"], ["#p2 img", "#c2"], ["#p3 img", "#c3"]].forEach(function (p, i) {
  const s = S[i + 1]; kb(p[0], s[1], s[2] - s[1] + .6, { scale: 1.16, y: 60 }, { scale: 1.04, y: -40 });
  show(p[1], s[1] + .4, s[2] - .1); fin(p[1], s[1] + .4, .9, { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: "power2.out" });
  fin(p[1] + " i", s[1] + .5, .8, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
  leak(s[1] - .35, 1.0); cue(s[1] - .3, "sweep-small.wav", .35);
});
// salon
kb("#p4 img", S[4][1], 3.8, { scale: 1.06, x: 40 }, { scale: 1.16, x: -40 }); leak(S[4][1] - .35, 1.0); cue(S[4][1] - .3, "woosh-air.wav", .3);
show("#t4", S[4][1] + .5, S[4][2]); fin("#t4 .ch", S[4][1] + .5, .8, { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", stagger: .03 });
// fin : enseigne néon
const te = 16.9; show("#end", te, null); fin("#end", te, .6, { opacity: 0 }, { opacity: 1 });
show(".ring, .logo", te + .4, null);
[[.4, .2], [.48, 0], [.6, .9], [.68, .3], [.8, 1]].forEach(function (k) { tl.set(".ring, .logo", { opacity: k[1] }, te + k[0]); });
cue(te + .38, "neon_flick.wav", .6); cue(te + .8, "bass.wav", .35);
fin(".info", te + 1.4, 1, { opacity: 0, y: 20 }, { opacity: 1, y: 0 });
fin(".info .r", te + 1.4, 1, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
""" % json.dumps(shots)
    open(os.path.join(D, "index.html"), "w").write(page("Maison Kadio", css, body, js, T, ("m288", 0)))

# =====================================================================
elif F in ("signature", "galerie_barbier"):
    GB = F == "galerie_barbier"
    looks = [("h_nattes", "Nattes", "dès 40 $", "50% 40%"), ("h_zigzag", "Zigzag", "design · dès 60 $", "50% 45%"),
             ("h_twists", "Twists", "dès 55 $", "50% 45%"), ("h_croises", "Croisés", "design · dès 60 $", "50% 40%"),
             ("h_locks", "Locks", "retwist · 150 $", "50% 45%"), ("h_chignon", "Chignon tressé", "nattes · dès 40 $", "50% 40%")]
    if GB: looks = [("b2", "Taper fade", "coupe · 50 $", "55% 40%"), ("b6", "Drop fade", "coupe · 50 $", "50% 40%"),
                    ("b4", "Fade & barbe", "coupe + barbe · 60 $", "55% 45%"), ("b9", "Burst taper", "coupe · 50 $", "50% 45%"),
                    ("b13", "Contour", "contours · 30 $", "45% 40%"), ("b3", "Taper bouclé", "coupe · 50 $", "55% 40%"),
                    ("b12", "Coupe enfant", "club enfant · 11,99 $/mois", "45% 40%")]
    C0, LD = 3.2, 3.3; TE = C0 + LD * len(looks); T = round(TE + 4.2, 2)
    css = """
:root { --bg: #f2ebe0; --fg: #17130f; --ac: #b8532a; }
.pg { position: absolute; inset: 0; background: var(--bg); visibility: hidden; box-shadow: -30px 0 60px rgba(0,0,0,.25); }
.frame { position: absolute; left: 90px; right: 90px; top: 330px; height: 1150px; overflow: hidden; background: #ddd; }
.frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: contrast(1.06) saturate(.95); transform-origin: 50% 50%; }
.no { position: absolute; left: 90px; top: 150px; font: 400 44px Bodoni; letter-spacing: .1em; }
.no b { font-weight: 700; }
.brand { position: absolute; right: 90px; top: 162px; font: 500 26px Corm; letter-spacing: .45em; text-transform: uppercase; }
.rule { position: absolute; left: 90px; right: 90px; top: 240px; height: 2px; background: var(--fg); transform-origin: 0 50%; }
.name { position: absolute; left: 90px; right: 90px; top: 1520px; font: italic 400 120px/1 Bodoni; white-space: nowrap; }
.price { position: absolute; left: 90px; top: 1690px; font: 600 40px Corm; letter-spacing: .2em; text-transform: uppercase; color: var(--ac); }
.big { position: absolute; right: 60px; top: 1600px; font: 700 220px/1 Bodoni; color: transparent; -webkit-text-stroke: 2px rgba(23,19,15,.18); }
.pg.alt .frame { left: 170px; right: 50px; } .pg.alt .name { text-align: right; } .pg.alt .price { left: auto; right: 90px; } .pg.alt .big { right: auto; left: 40px; }
#cover { position: absolute; inset: 0; background: var(--fg); color: var(--bg); }
.ct { position: absolute; left: 0; right: 0; top: 620px; text-align: center; }
.ct small { display: block; font: 500 30px Corm; letter-spacing: .6em; text-indent: .6em; text-transform: uppercase; }
.ct h1 { margin-top: 40px; font: 400 168px/.95 Bodoni; letter-spacing: -.01em; }
.ct h1 em { font-style: italic; }
.ct .r { width: 160px; height: 3px; background: var(--ac); margin: 60px auto 40px; }
.ct p { font: italic 300 52px Corm; }
#endp { background: var(--fg); color: var(--bg); }
.et { position: absolute; left: 80px; right: 80px; top: 600px; text-align: center; }
.et h2 { font: italic 400 112px/1.05 Bodoni; }
.et .r { width: 160px; height: 3px; background: var(--ac); margin: 60px auto; }
.et p { font: 500 44px/1.6 Corm; letter-spacing: .08em; }
.et .site { margin-top: 30px; font: 600 34px Corm; letter-spacing: .45em; text-indent: .45em; text-transform: uppercase; color: #e6a07c; }
"""
    pages = ""
    for i, (img, nm, pr, pos) in enumerate(looks):
        pages += f"""<div id="g{i}" class="pg{' alt' if i % 2 else ''}"><div class="no">N° <b>0{i + 1}</b></div><div class="brand">{"Barbier · Kadio" if GB else "Kadio · Hiver 26"}</div><div class="rule"></div>
<div class="frame"><img src="photos/{img}.jpg" style="object-position:{pos}"></div><div class="big">0{i + 1}</div><div class="name">{e(nm)}</div><div class="price">{e(pr)}</div></div>"""
    body = f"""<div id="cover"><div class="ct"><small>Kadio Coiffure présente</small><h1>{sp("La" if not GB else "La")}<br><em>{sp("Galerie" if GB else "Signature")}</em></h1><div class="r"></div><p>{"Barbier · coupes, dégradés, barbes" if GB else "Collection hiver 2026"}</p></div></div>
{pages}
<div id="endp" class="pg"><div class="et"><h2>{sp("Réservez")}<br>{sp("votre coupe." if GB else "votre signature.")}</h2><div class="r"></div>{'<p style="margin-bottom:30px">Club Kadio : coupe + barbe <b style="color:#e6a07c">19,99 $/mois</b></p>' if GB else ''}<p>615, Antoinette-Robidoux · Longueuil</p><p>514 919-5970</p><div class="site">kadiocoiffure.com</div></div></div>"""
    js = """
const C0 = %s, LD = %s, N = %d, TE = %s;
fin(".ct small", .2, .8, { opacity: 0, letterSpacing: "1.2em" }, { opacity: 1, letterSpacing: ".6em", ease: "expo.out" }); cue(.2, "type-click.wav", .25);
fin(".ct h1 .ch", .6, .7, { opacity: 0, y: 80 }, { opacity: 1, y: 0, stagger: .05, ease: "power4.out" }); cue(.6, "bass.wav", .35);
fin(".ct .r", 1.4, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin(".ct p", 1.6, .7, { opacity: 0 }, { opacity: 1 });
for (let i = 0; i < N; i++) {
  const t = C0 + i * LD, g = "#g" + i, dir = i %% 2 ? -1 : 1;
  show(g, t, null); tl.set(g, { zIndex: 10 + i }, 0);
  fin(g, t, .55, { x: 1080 * dir }, { x: 0, ease: "power3.inOut" }); cue(t, "sweep-small.wav", .4);
  fin(g + " .rule", t + .4, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
  fin(g + " .frame", t + .35, .8, { clipPath: "inset(100%% 0 0 0)" }, { clipPath: "inset(0%% 0 0 0)", ease: "expo.out" }); cue(t + .4, "shutter-vintage.wav", .3);
  kb(g + " img", t + .35, LD + .6, { scale: 1.18 }, { scale: 1.04 });
  fin(g + " .name", t + .65, .7, { opacity: 0, y: 50 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin(g + " .price", t + .95, .6, { opacity: 0, x: -30 * dir }, { opacity: 1, x: 0, ease: "power3.out" });
  fin(g + " .big", t + .5, LD, { y: 60 }, { y: -40, ease: "none" });
}
show("#endp", TE, null); tl.set("#endp", { zIndex: 99 }, 0); fin("#endp", TE, .55, { x: 1080 }, { x: 0, ease: "power3.inOut" }); cue(TE, "sweep-small.wav", .4);
fin(".et h2 .ch", TE + .5, .7, { opacity: 0, y: 60 }, { opacity: 1, y: 0, stagger: .025, ease: "power4.out" }); cue(TE + .5, "bass.wav", .35);
fin(".et .r", TE + 1.3, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
fin(".et p, .et .site", TE + 1.5, .7, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .2 }); cue(TE + 1.9, "sparkle.wav", .25);
""" % (C0, LD, len(looks), TE)
    open(os.path.join(D, "index.html"), "w").write(page("La Galerie Barbier" if GB else "La Signature", css, body, js, T, ("m1183", 40) if GB else ("m623", 12)))

# =====================================================================
elif F == "bienvenue":
    T = 21.5
    svc = ["Dreads / Locks", "Coupes hommes", "Barbes", "Tresses", "Tissages", "Perruques", "Manucure", "Pédicure"]
    css = """
:root { --bg: #0d0a08; --fg: #fbf1e2; --gold: #e2b46a; }
.ph img { filter: contrast(1.06) saturate(1.1) brightness(.95); }
.shade { background: linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(0,0,0,.75)); }
.side { background: linear-gradient(90deg, rgba(8,5,3,.88) 0%, rgba(8,5,3,.55) 55%, rgba(8,5,3,0) 85%); }
.wel { left: 0; right: 0; top: 1180px; text-align: center; }
.wel .v { font: 200px/1 Vibes; color: var(--gold); text-shadow: 0 4px 30px rgba(0,0,0,.6); }
.wel .s { margin-top: 10px; font: 500 40px Corm; letter-spacing: .5em; text-indent: .5em; text-transform: uppercase; color: var(--fg); }
.svc { left: 90px; top: 520px; }
.svc h3 { font: 600 30px Corm; letter-spacing: .5em; text-transform: uppercase; color: var(--gold); margin-bottom: 40px; }
.svc li { list-style: none; display: flex; align-items: center; gap: 26px; font: italic 500 78px/1.18 Corm; color: var(--fg); }
.svc li i { width: 14px; height: 14px; border-radius: 50%; background: var(--gold); flex: none; }
.big { left: 70px; right: 70px; top: 1300px; text-align: center; font: italic 300 104px/1.05 Corm; color: var(--fg); text-shadow: 0 6px 40px rgba(0,0,0,.7); }
.big b { font-weight: 500; color: var(--gold); }
#end { background: #0d0a08; visibility: hidden; }
#end img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(26px) brightness(.4) saturate(1.2); transform: scale(1.15); }
.ec { position: absolute; left: 70px; right: 70px; top: 620px; text-align: center; color: var(--fg); }
.ec .v { font: 150px/1 Vibes; color: var(--gold); }
.ec .r { width: 140px; height: 2px; background: var(--gold); margin: 50px auto; }
.ec p { font: 500 46px/1.55 Corm; letter-spacing: .06em; }
.ec .site { margin-top: 30px; font: 600 32px Corm; letter-spacing: .45em; text-indent: .45em; color: var(--gold); text-transform: uppercase; }
"""
    shots = [("porte", 0.0, 4.0), ("neon_wide", 4.0, 10.0), ("neon_b", 10.0, 13.0), ("lounge", 13.0, 15.8), ("h_nattes", 15.8, 17.0), ("h_twists", 17.0, 18.2)]
    body = "".join(f'<div id="p{i}" class="ph"><img src="photos/{n}.jpg"><div class="layer shade"></div>{"<div class=\"layer side\"></div>" if n == "neon_wide" else ""}</div>' for i, (n, a, b) in enumerate(shots))
    body += f"""
<div class="layer vig"></div><div class="leak"></div>
<div id="t0" class="txt wel"><div class="v">{sp("Bienvenue")}</div><div class="s">chez Kadio Coiffure</div></div>
<div id="t1" class="txt svc"><h3>Nos services</h3><ul>{"".join(f"<li><i></i>{e(s)}</li>" for s in svc)}</ul></div>
<div id="t2" class="txt big">{sp("Une ambiance")}<br><b>{sp("unique.")}</b></div>
<div id="t3" class="txt big">{sp("Installez-vous.")}</div>
<div id="t4" class="txt big"><b>{sp("Repartez sublimé.")}</b></div>
<div id="end" class="layer"><img src="photos/neon_a.jpg"><div class="ec"><div class="v">{sp("Kadio Coiffure")}</div><div class="r"></div>
<p>615, Antoinette-Robidoux<br>Longueuil</p><p>514 919-5970</p><div class="site">kadiocoiffure.com</div></div></div>"""
    js = """
const S = %s;
S.forEach(function (s, i) { show("#p" + i, s[1], s[2] + .5); if (i) { tl.set("#p" + i, { zIndex: i }, 0); fin("#p" + i, s[1], .5, { xPercent: 100 }, { xPercent: 0, ease: "power3.inOut" }); cue(s[1] - .1, i %% 2 ? "woosh-air.wav" : "sweep-small.wav", .3); } });
cue(.25, "doorbell.wav", .45);
kb("#p0 img", 0, 4.5, { scale: 1.02 }, { scale: 1.2 });
show("#t0", .6, 3.9); fin("#t0 .v .ch", .6, .9, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", stagger: .05, ease: "power2.out" });
fin("#t0 .s", 1.5, .8, { opacity: 0, letterSpacing: "1em" }, { opacity: 1, letterSpacing: ".5em", ease: "expo.out" });
kb("#p1 img", 4.0, 6.5, { scale: 1.12, xPercent: 4 }, { scale: 1.12, xPercent: -4 });
show("#t1", 4.4, 9.9); fin("#t1 h3", 4.4, .6, { opacity: 0, x: -30 }, { opacity: 1, x: 0 });
document.querySelectorAll("#t1 li").forEach(function (li, k) { const t = 4.8 + k * .5; fin(li, t, .5, { opacity: 0, x: -40 }, { opacity: 1, x: 0, ease: "power3.out" }); cue(t, "type-click.wav", .18); });
kb("#p2 img", 10.0, 3.5, { scale: 1.25 }, { scale: 1.1 });
[[10.25, .3], [10.32, 1], [10.42, .5], [10.5, 1]].forEach(function (k) { tl.set("#p2 img", { opacity: k[1] }, k[0]); }); cue(10.2, "neon_buzz.wav", .25);
show("#t2", 10.6, 12.9); fin("#t2 .ch", 10.6, .8, { opacity: 0, y: 30 }, { opacity: 1, y: 0, stagger: .03, ease: "power3.out" });
kb("#p3 img", 13.0, 3.3, { scale: 1.05, y: -30 }, { scale: 1.15, y: 30 });
show("#t3", 13.4, 15.7); fin("#t3 .ch", 13.4, .8, { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", stagger: .035 });
kb("#p4 img", 15.8, 1.7, { scale: 1.2 }, { scale: 1.08 }); kb("#p5 img", 17.0, 1.7, { scale: 1.2 }, { scale: 1.08 });
show("#t4", 16.0, 18.2); fin("#t4 .ch", 16.0, .6, { opacity: 0, y: 30 }, { opacity: 1, y: 0, stagger: .025 }); cue(16.0, "sparkle.wav", .25);
const te = 18.2; show("#end", te, null); tl.set("#end", { zIndex: 50 }, 0); fin("#end", te, .7, { opacity: 0 }, { opacity: 1 }); leak(te - .4, 1.2);
fin(".ec .v .ch", te + .4, .9, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", stagger: .04 }); cue(te + .4, "chime.wav", .35);
fin(".ec .r", te + 1.2, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin(".ec p, .ec .site", te + 1.4, .7, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .2 });
""" % json.dumps(shots)
    open(os.path.join(D, "index.html"), "w").write(page("Bienvenue chez Kadio", css, body, js, T, ("m169", 0)))
# =====================================================================
# Barrel twist : photos bt1..bt5 ; centre de la tête (fraction de l'image) pour la mise au point
BT = {"bt1": (.40, .50), "bt2": (.48, .52), "bt3": (.60, .50), "bt4": (.55, .55), "bt5": (.42, .42),
      "b1": (.55, .45), "b2": (.55, .42), "b3": (.55, .45), "b4": (.55, .45), "b5": (.58, .48), "b6": (.5, .42),
      "b7": (.5, .42), "b8": (.5, .42), "b9": (.5, .45), "b13": (.5, .45), "b14": (.55, .45), "b10": (.45, .42), "b11": (.6, .45), "b12": (.5, .45)}
def dims(name):
    w, h = Image.open(os.path.join(R, "photos", name + ".jpg")).size; sc = max(1080 / w, 1920 / h); return w * sc, h * sc
FOCUS_CSS = """
.fx { position: absolute; inset: 0; transform-origin: 50% 50%; }
.fx img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.fx .bg { filter: blur(18px) brightness(.32) saturate(.55); transform: scale(1.08); }
.fx .fg { filter: contrast(1.1) saturate(1.05) brightness(1.02); }
"""
def focus(i, name, rx=46, ry=30, extra=""):
    cx, cy = BT[name]
    # coordonnées dans le cadre 1080x1920 (photo 3:4 en cover → décalage horizontal de 180 px ; bt5 9:16 → pas de décalage)
    dw, dh = dims(name); fx = cx * dw - (dw - 1080) / 2; fy = cy * dh - (dh - 1920) / 2
    m = f"radial-gradient(ellipse {rx}% {ry}% at {fx / 10.8:.1f}% {fy / 19.2:.1f}%, #000 55%, transparent 100%)"
    return (f'<div id="p{i}" class="ph"><div class="fx"><img class="bg" src="photos/{name}.jpg">'
            f'<img class="fg" src="photos/{name}.jpg" style="-webkit-mask-image:{m};mask-image:{m}"></div>{extra}</div>')

if F in ("barrel", "film_barbier"):
    T = 21.0
    FB = F == "film_barbier"
    css = FOCUS_CSS + """
:root { --bg: #070605; --fg: #f3e6cf; --gold: #d9b26f; }
.bar { position: absolute; left: 0; right: 0; height: 230px; background: #000; z-index: 20; }
.bar.t { top: 0; } .bar.b { bottom: 0; }
.open { left: 0; right: 0; top: 760px; text-align: center; }
.open small { display: block; font: 500 30px Corm; letter-spacing: .6em; text-indent: .6em; color: var(--gold); text-transform: uppercase; }
.open h1 { margin-top: 30px; font: 400 150px/.95 Bodoni; color: var(--fg); letter-spacing: .02em; }
.open h1 em { display: block; font-style: italic; color: var(--gold); }
.word { left: 0; right: 0; top: 1420px; text-align: center; font: italic 300 124px/1 Corm; color: var(--fg); text-shadow: 0 6px 40px rgba(0,0,0,.8); }
.word.sm { font-size: 84px; line-height: 1.05; }
.word b { font-weight: 500; color: var(--gold); }
#end { background: radial-gradient(70% 45% at 50% 42%, #2a1608 0%, #070605 70%); visibility: hidden; }
.logo { position: absolute; left: 0; right: 0; top: 600px; text-align: center; font: 190px/1 Vibes; color: #ffd9a0;
  text-shadow: 0 0 8px #ffb35c, 0 0 24px #ff9a2e, 0 0 60px #ff7a00, 0 0 110px rgba(255,120,0,.6); }
.logo2 { top: 790px; }
.ring { position: absolute; left: 190px; top: 500px; width: 700px; height: 700px; border-radius: 50%; border: 6px solid #ffd9a0;
  box-shadow: 0 0 14px #ffb35c, 0 0 40px #ff8a1e, inset 0 0 14px #ffb35c, inset 0 0 40px rgba(255,138,30,.6); }
.info { position: absolute; left: 0; right: 0; top: 1290px; text-align: center; color: var(--fg); }
.info h4 { font: italic 400 62px Bodoni; color: var(--gold); margin-bottom: 34px; }
.info p { font: 500 40px/1.5 Corm; letter-spacing: .12em; }
.info .s { margin-top: 22px; font: 600 30px Corm; letter-spacing: .5em; text-indent: .5em; color: var(--gold); text-transform: uppercase; }
"""
    shots = [("bt2", 2.2, 6.4, ""), ("bt1", 6.4, 9.2, "Volume."), ("bt4", 9.2, 12.0, "Relief."), ("bt3", 12.0, 14.8, "Caractère."), ("bt5", 14.8, 17.4, "Chaque tête,|une signature.")]
    if FB: shots = [("b7", 2.2, 6.4, ""), ("b4", 6.4, 9.2, "Précision."), ("b2", 9.2, 12.0, "Dégradé."), ("b14", 12.0, 14.8, "Contour."), ("b5", 14.8, 17.4, "Votre style,|notre signature.")]
    T1, T2, CTA = ("Le", "Barbier", "Réservez votre coupe.") if FB else ("Barrel", "Twist", "Réservez votre barrel twist.")
    body = "".join(focus(i, n) for i, (n, a, b, w) in enumerate(shots))
    words = "".join(f'<div id="w{i}" class="txt word{" sm" if "|" in w else ""}">' + "<br>".join(sp(x) for x in w.split("|")) + "</div>" for i, (n, a, b, w) in enumerate(shots) if w)
    body += f"""
<div class="layer vig"></div><div class="leak"></div>
<div id="t0" class="txt open"><small>Kadio Coiffure présente</small><h1>{sp(T1)}<em>{sp(T2)}</em></h1></div>
{words}
<div id="end" class="layer"><div class="ring"></div><div class="logo">{sp("Kadio")}</div><div class="logo logo2">{sp("Coiffure")}</div>
  <div class="info"><h4>{CTA}</h4><p>615, Antoinette-Robidoux · Longueuil</p><p>514 919-5970</p><div class="s">kadiocoiffure.com</div></div></div>
<div class="bar t"></div><div class="bar b"></div>"""
    js = """
const S = %s;
// ouverture : titre sur noir
show("#t0", .3, 2.9); fin("#t0 small", .3, 1, { opacity: 0, letterSpacing: "1.3em" }, { opacity: 1, letterSpacing: ".6em", ease: "expo.out" });
fin("#t0 h1 .ch", .8, .9, { opacity: 0, y: 40, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .06, ease: "power3.out" }); cue(.8, "bass.wav", .4);
tl.to("#t0", { opacity: 0, y: -30, duration: .6 }, 2.2);
S.forEach(function (s, i) {
  show("#p" + i, s[1], s[2] + .6); if (i) fin("#p" + i, s[1], .6, { opacity: 0 }, { opacity: 1, ease: "sine.inOut" });
  const d = s[2] - s[1] + .6;
  kb("#p" + i + " .fx", s[1], d, { scale: i %% 2 ? 1.18 : 1.05, x: i %% 2 ? 30 : -30 }, { scale: i %% 2 ? 1.05 : 1.18, x: i %% 2 ? -30 : 30 });
  fin("#p" + i + " .fg", s[1], 1.2, { filter: "blur(14px) contrast(1.1) brightness(.6)" }, { filter: "blur(0px) contrast(1.1) saturate(1.05) brightness(1.02)", ease: "power2.out" });
  leak(s[1] - .35, 1.0); cue(s[1] - .3, i ? "sweep-small.wav" : "woosh-air.wav", .35);
  if (s[3]) { show("#w" + i, s[1] + .5, s[2] - .05); fin("#w" + i + " .ch", s[1] + .5, .8, { opacity: 0, y: 24, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .035, ease: "power3.out" }); }
});
const te = 17.4; show("#end", te, null); fin("#end", te, .6, { opacity: 0 }, { opacity: 1 });
show(".ring, .logo", te + .4, null);
[[.4, .2], [.48, 0], [.6, .9], [.68, .3], [.8, 1]].forEach(function (k) { tl.set(".ring, .logo", { opacity: k[1] }, te + k[0]); });
cue(te + .38, "neon_flick.wav", .6); cue(te + .8, "bass.wav", .35);
fin(".info", te + 1.3, 1, { opacity: 0, y: 20 }, { opacity: 1, y: 0 });
""" % json.dumps(shots)
    open(os.path.join(D, "index.html"), "w").write(page("Le Barbier" if FB else "Barrel Twist", css, body, js, T, ("m288", 30) if FB else ("m1000", 4)))

elif F in ("anatomie", "anat_barbier"):
    AB = F == "anat_barbier"
    # (photo, point x, point y, titre, sous-titre)
    det = [("bt1", .42, .44, "Raies nettes", "des séparations tracées à la règle"),
           ("bt2", .47, .52, "Torsades en relief", "un volume qui tient"),
           ("bt1", .22, .25, "Chignon twisté", "la touche finale"),
           ("bt4", .66, .655, "Contour au rasoir", "une ligne parfaite"),
           ("bt3", .56, .62, "Dégradé net", "une transition douce")]
    if AB: det = [("b2", .75, .33, "Taper net", "une transition invisible"),
                  ("b13", .45, .34, "Ligne au rasoir", "un contour au millimètre"),
                  ("b8", .52, .47, "Burst fade", "le dégradé autour de l'oreille"),
                  ("b4", .66, .66, "Barbe sculptée", "des lignes franches"),
                  ("b6", .60, .24, "Texture", "le dessus travaillé")]
    SUJ, BRAND = ("dégradé", "Barbier · Kadio") if AB else ("barrel twist", "Barrel twist · Kadio")
    C0, LD = 3.2, 3.2; TE = C0 + LD * len(det); T = round(TE + 4.0, 2)
    css = FOCUS_CSS + """
:root { --bg: #f2ebe0; --fg: #17130f; --ac: #b8532a; --gold: #c99a52; }
.pg { position: absolute; inset: 0; background: var(--bg); visibility: hidden; }
.frame { position: absolute; left: 70px; right: 70px; top: 300px; height: 1180px; overflow: hidden; border-radius: 4px; }
.frame .ph { visibility: visible; }
.loupe { position: absolute; width: 440px; height: 440px; border-radius: 50%; overflow: hidden; border: 5px solid var(--bg); box-shadow: 0 0 0 3px var(--gold), 0 30px 60px rgba(0,0,0,.45); z-index: 5; }
.loupe img { position: absolute; transform-origin: 0 0; filter: contrast(1.12) saturate(1.05); }
.dot { position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; border: 4px solid #fff; box-shadow: 0 0 0 3px var(--gold), 0 0 30px rgba(255,255,255,.8); z-index: 6; }
.lead { position: absolute; height: 3px; background: #fff; transform-origin: 0 50%; z-index: 4; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
.no { position: absolute; left: 70px; top: 140px; font: 400 40px Bodoni; letter-spacing: .1em; } .no b { font-weight: 700; }
.brand { position: absolute; right: 70px; top: 152px; font: 500 26px Corm; letter-spacing: .45em; text-transform: uppercase; }
.rule { position: absolute; left: 70px; right: 70px; top: 228px; height: 2px; background: var(--fg); transform-origin: 0 50%; }
.dt { position: absolute; left: 70px; right: 70px; top: 1530px; }
.dt h2 { font: italic 400 104px/1 Bodoni; white-space: nowrap; }
.dt p { margin-top: 22px; font: 600 36px Corm; letter-spacing: .22em; text-transform: uppercase; color: var(--ac); }
#cover, #endp { background: var(--fg); color: var(--bg); }
.ct { position: absolute; left: 0; right: 0; top: 600px; text-align: center; }
.ct small { display: block; font: 500 30px Corm; letter-spacing: .6em; text-indent: .6em; text-transform: uppercase; }
.ct h1 { margin-top: 40px; font: 400 128px/1 Bodoni; }
.ct h1 em { font-style: italic; color: #e6b07c; }
.ct .r { width: 160px; height: 3px; background: var(--ac); margin: 60px auto 40px; }
.ct p { font: italic 300 50px Corm; }
"""
    pages = ""
    for i, (img, px, py, h, s) in enumerate(det):
        W, H = Image.open(os.path.join(R, "photos", img + ".jpg")).size
        # cadre 940x1180 placé à (70,300) ; la photo y est en cover → on calcule la position du point dans la page
        fw, fh = 940, 1180; sc = max(fw / W, fh / H); dw, dh = W * sc, H * sc; ox, oy = 70 + (fw - dw) / 2, 300 + (fh - dh) / 2
        X, Y = ox + px * dw, oy + py * dh
        lx = 560 if X < 540 else 80; ly = 1020 if Y < 900 else 330
        m = 2.4; RR = 220
        lpx, lpy = lx + RR, ly + RR
        ang = __import__("math").degrees(__import__("math").atan2(lpy - Y, lpx - X)); ln = ((lpx - X) ** 2 + (lpy - Y) ** 2) ** .5 - RR
        inner = f'<img src="photos/{img}.jpg" style="width:{dw * m:.0f}px;height:{dh * m:.0f}px;left:{RR - (X - ox) * m:.0f}px;top:{RR - (Y - oy) * m:.0f}px">'
        pages += f"""<div id="g{i}" class="pg"><div class="no">Détail <b>0{i + 1}</b></div><div class="brand">{BRAND}</div><div class="rule"></div>
<div class="frame">{focus(f"f{i}", img, 60, 44)}</div>
<div class="lead" style="left:{X:.0f}px;top:{Y:.0f}px;width:{ln:.0f}px;transform:rotate({ang:.1f}deg)"></div>
<div class="dot" style="left:{X:.0f}px;top:{Y:.0f}px"></div>
<div class="loupe" style="left:{lx}px;top:{ly}px">{inner}</div>
<div class="dt"><h2>{e(h)}</h2><p>{e(s)}</p></div></div>"""
    body = f"""<div id="cover" class="layer"><div class="ct"><small>Kadio Coiffure</small><h1>{sp("Anatomie")}<br>{sp("d'un" if not AB else "d'un")} <em>{sp(SUJ)}</em></h1><div class="r"></div><p>Le détail fait la différence.</p></div></div>
{pages}
<div id="endp" class="pg"><div class="ct" style="top:640px"><small>Votre tour</small><h1 style="font-size:112px">{sp("Réservez votre")}<br><em>{sp("coupe." if AB else "barrel twist.")}</em></h1><div class="r"></div>
{'<p style="font-style:normal;font-weight:600;font-size:40px;line-height:1.6;letter-spacing:.06em">Coupe 50 $ · Coupe + barbe 60 $ · Contours 30 $</p><p style="margin:18px 0 30px;font-size:42px">Club Kadio : coupe + barbe <b style="color:#e6b07c">19,99 $/mois</b></p>' if AB else ''}
<p style="font-style:normal;font-weight:500;font-size:44px;line-height:1.6">615, Antoinette-Robidoux · Longueuil<br>514 919-5970</p><p style="margin-top:24px;font:600 32px Corm;letter-spacing:.45em;color:#e6b07c">KADIOCOIFFURE.COM</p></div></div>"""
    js = """
const C0 = %s, LD = %s, N = %d, TE = %s;
fin(".ct small", .2, .8, { opacity: 0, letterSpacing: "1.2em" }, { opacity: 1, letterSpacing: ".6em", ease: "expo.out" });
fin("#cover h1 .ch", .5, .7, { opacity: 0, y: 70 }, { opacity: 1, y: 0, stagger: .035, ease: "power4.out" }); cue(.5, "bass.wav", .35);
fin("#cover .r", 1.4, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin("#cover p", 1.6, .7, { opacity: 0 }, { opacity: 1 });
for (let i = 0; i < N; i++) {
  const t = C0 + i * LD, g = "#g" + i;
  show(g, t, null); tl.set(g, { zIndex: 10 + i }, 0);
  fin(g, t, .55, { yPercent: 100 }, { yPercent: 0, ease: "power3.inOut" }); cue(t, "sweep-small.wav", .4);
  fin(g + " .rule", t + .4, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
  kb(g + " .fx", t + .3, LD + .6, { scale: 1.12 }, { scale: 1.0 });
  fin(g + " .dot", t + .8, .4, { scale: 0 }, { scale: 1, ease: "back.out(3)" }); cue(t + .8, "click.wav", .3);
  fin(g + " .lead", t + 1.0, .4, { scaleX: 0 }, { scaleX: 1, ease: "power2.out" });
  fin(g + " .loupe", t + 1.2, .55, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, ease: "back.out(1.8)" }); cue(t + 1.2, "shutter-vintage.wav", .3);
  kb(g + " .loupe img", t + 1.2, LD, { scale: 1.0 }, { scale: 1.08 });
  fin(g + " .dt h2", t + .6, .7, { opacity: 0, y: 40 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin(g + " .dt p", t + .9, .6, { opacity: 0, x: -30 }, { opacity: 1, x: 0, ease: "power3.out" });
}
show("#endp", TE, null); tl.set("#endp", { zIndex: 99 }, 0); fin("#endp", TE, .55, { yPercent: 100 }, { yPercent: 0, ease: "power3.inOut" }); cue(TE, "sweep-small.wav", .4);
fin("#endp h1 .ch", TE + .5, .7, { opacity: 0, y: 60 }, { opacity: 1, y: 0, stagger: .025, ease: "power4.out" }); cue(TE + .5, "bass.wav", .35);
fin("#endp .r", TE + 1.2, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin("#endp p", TE + 1.4, .7, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .2 }); cue(TE + 1.6, "sparkle.wav", .25);
""" % (C0, LD, len(det), TE)
    body = body.replace('class="click.wav"', '')
    open(os.path.join(D, "index.html"), "w").write(page("Anatomie d'un dégradé" if AB else "Anatomie Barrel Twist", css, body, js, T, ("m657", 20) if AB else ("m1183", 8)))

elif F == "rythme":
    BEAT = 60 / 124
    seq = ["bt2", "bt4", "bt1", "bt3", "bt5", "bt2", "bt4", "bt3", "bt1", "bt5"]
    labels = {"bt2": "Face", "bt4": "Profil droit", "bt1": "Dessus", "bt3": "Profil gauche", "bt5": "Version courte"}
    C0 = 2.6; cut = BEAT * 2; TE = round(C0 + cut * len(seq), 2); T = round(TE + 4.2, 2)
    css = FOCUS_CSS + """
:root { --bg: #050505; --fg: #ffffff; --gold: #e2b46a; }
.huge { position: absolute; left: -40px; right: -40px; text-align: center; font: 700 236px/.85 Bodoni; color: transparent; -webkit-text-stroke: 3px rgba(226,180,106,.85); letter-spacing: -.02em; z-index: 22; pointer-events: none; }
.huge.a { top: 260px; } .huge.b { top: 1360px; font-style: italic; font-weight: 400; }
.lab { position: absolute; left: 0; right: 0; bottom: 200px; text-align: center; font: 600 34px Corm; letter-spacing: .6em; text-indent: .6em; text-transform: uppercase; color: #fff; z-index: 23; visibility: hidden; }
.cnt { position: absolute; right: 60px; top: 90px; font: 700 34px Bodoni; color: var(--gold); z-index: 23; }
.cnt i { font-style: normal; color: #fff; }
#flash { background: #fff; opacity: 0; z-index: 40; pointer-events: none; }
#end { background: #050505; visibility: hidden; z-index: 50; }
.et { position: absolute; left: 60px; right: 60px; top: 560px; text-align: center; }
.et h1 { font: 700 190px/.9 Bodoni; color: #fff; } .et h1 em { display: block; font-weight: 400; color: var(--gold); }
.et .r { width: 160px; height: 3px; background: var(--gold); margin: 60px auto; }
.et p { font: 500 46px/1.55 Corm; color: #fff; letter-spacing: .06em; }
.et .s { margin-top: 24px; font: 600 32px Corm; letter-spacing: .45em; text-indent: .45em; color: var(--gold); }
"""
    body = "".join(focus(i, n, 50, 34) for i, n in enumerate(seq))
    body += "".join(f'<div id="l{i}" class="lab">{e(labels[n])}</div>' for i, n in enumerate(seq))
    body += f"""<div class="layer vig"></div>
<div id="hug" class="txt" style="inset:0"><div class="huge a">{sp("BARREL")}</div><div class="huge b">{sp("twist")}</div></div>
<div class="cnt txt" id="cnt"><i>0</i><span>1</span> / 10</div>
<div id="flash" class="layer"></div>
<div id="end" class="layer"><div class="et"><h1>{sp("BARREL")}<em>{sp("twist")}</em></h1><div class="r"></div><p>Kadio Coiffure<br>615, Antoinette-Robidoux · Longueuil<br>514 919-5970</p><div class="s">KADIOCOIFFURE.COM</div></div></div>"""
    js = """
const C0 = %s, CUT = %s, N = %d, TE = %s, B = %s;
// intro : lettres géantes sur noir puis photo
show("#hug", .2, TE); fin("#hug .huge.a .ch", .2, .5, { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1, stagger: .06, ease: "power4.out" }); cue(.2, "bass.wav", .5);
fin("#hug .huge.b .ch", .9, .5, { opacity: 0, y: 80 }, { opacity: 1, y: 0, stagger: .06, ease: "power4.out" }); cue(.9, "whoosh-cine.wav", .4);
show("#cnt", C0, TE);
for (let i = 0; i < N; i++) {
  const t = C0 + i * CUT;
  show("#p" + i, t, t + CUT); show("#l" + i, t + .05, t + CUT);
  kb("#p" + i + " .fx", t, CUT, { scale: 1.22, rotate: i %% 2 ? -2 : 2 }, { scale: 1.06, rotate: 0 });
  fin("#l" + i, t + .05, .35, { opacity: 0, letterSpacing: "1.2em" }, { opacity: 1, letterSpacing: ".6em", ease: "expo.out" });
  tl.fromTo("#flash", { opacity: .85 }, { opacity: 0, duration: .22, ease: "power2.out", immediateRender: false }, t);
  tl.set("#cnt span", { textContent: String(i + 1) }, t);
  cue(t, i %% 2 ? "shutter.wav" : "shutter-vintage.wav", .35);
}
tl.set("#flash", { opacity: 0 }, 0);
tl.to("#hug .huge.a", { x: -80, duration: TE, ease: "none" }, 0); tl.to("#hug .huge.b", { x: 80, duration: TE, ease: "none" }, 0);
show("#end", TE, null); fin("#end", TE, .4, { opacity: 0 }, { opacity: 1 }); cue(TE, "bass.wav", .5);
fin("#end h1 .ch", TE + .1, .6, { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, stagger: .05, ease: "power4.out" });
fin("#end .r", TE + .9, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin("#end p, #end .s", TE + 1.1, .6, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .2 });
""" % (C0, cut, len(seq), TE, BEAT)
    open(os.path.join(D, "index.html"), "w").write(page("Barrel Twist 360", css, body, js, T, ("m623", 15.5)))
elif F in ("comparateur", "quiz"):
    import math
    END_INFO = ('<p class="px">Coupe 50 $ · Coupe + barbe 60 $ · Contours 30 $</p>'
                '<p class="club">Club Kadio : coupe + barbe <b>19,99 $/mois</b></p>'
                '<p class="ad">615, Antoinette-Robidoux · Longueuil<br>514 919-5970</p><p class="site">KADIOCOIFFURE.COM</p>')
    BASE = FOCUS_CSS + """
:root { --bg: #f2ebe0; --fg: #17130f; --ac: #b8532a; --gold: #c99a52; }
.pg { position: absolute; inset: 0; background: var(--bg); visibility: hidden; }
.frame { position: absolute; left: 70px; right: 70px; top: 300px; height: 1180px; overflow: hidden; border-radius: 4px; }
.frame .ph { visibility: visible; }
.no { position: absolute; left: 70px; top: 140px; font: 400 40px Bodoni; letter-spacing: .1em; } .no b { font-weight: 700; }
.brand { position: absolute; right: 70px; top: 152px; font: 500 26px Corm; letter-spacing: .45em; text-transform: uppercase; }
.rule { position: absolute; left: 70px; right: 70px; top: 228px; height: 2px; background: var(--fg); transform-origin: 0 50%; }
#cover, #endp { background: var(--fg); color: var(--bg); }
.ct { position: absolute; left: 60px; right: 60px; top: 560px; text-align: center; }
.ct small { display: block; font: 500 30px Corm; letter-spacing: .6em; text-indent: .6em; text-transform: uppercase; }
.ct h1 { margin-top: 40px; font: 400 112px/1.05 Bodoni; }
.ct h1 em { font-style: italic; color: #e6b07c; }
.ct .r { width: 160px; height: 3px; background: var(--ac); margin: 56px auto 40px; }
.ct p { font: italic 300 48px Corm; }
.ct .px { font: 600 40px/1.6 Corm; font-style: normal; letter-spacing: .05em; }
.ct .club { margin: 14px 0 34px; font: 500 42px Corm; font-style: normal; } .ct .club b { color: #e6b07c; }
.ct .ad { font: 500 44px/1.55 Corm; font-style: normal; }
.ct .site { margin-top: 22px; font: 600 32px Corm; font-style: normal; letter-spacing: .45em; color: #e6b07c; }
"""
    def frame_pt(img, px, py):
        W, H = Image.open(os.path.join(R, "photos", img + ".jpg")).size
        fw, fh = 940, 1180; sc = max(fw / W, fh / H); dw, dh = W * sc, H * sc; ox, oy = 70 + (fw - dw) / 2, 300 + (fh - dh) / 2
        return ox + px * dw, oy + py * dh

    if F == "comparateur":
        cmp = [("b2", "Taper fade", "Court seulement aux tempes et à la nuque.", "Discret, propre, passe partout.",
                [(.18, .32), (.35, .30), (.55, .30), (.75, .36), (.92, .50)]),
               ("b6", "Drop fade", "La ligne plonge derrière l'oreille.", "Un arc moderne, plein de style.",
                [(.25, .37), (.45, .38), (.62, .42), (.72, .55), (.78, .70)]),
               ("b8", "Burst fade", "En demi-cercle autour de l'oreille.", "Parfait avec des boucles.",
                [(.08, .55), (.15, .38), (.32, .30), (.48, .30), (.62, .40)]),
               ("b4", "High fade", "Le dégradé monte haut sur les côtés.", "Contraste maximal, look affirmé.",
                [(.05, .33), (.25, .28), (.45, .26), (.62, .27), (.72, .32)])]
        C0, LD = 3.4, 3.8; TE = C0 + LD * len(cmp); T = round(TE + 5.0, 2)
        css = BASE + """
.ln { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; z-index: 5; overflow: visible; }
.ln path { fill: none; stroke: #f3c77a; stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 10px rgba(255,190,90,.9)); }
.tag { position: absolute; z-index: 6; padding: 12px 26px; border-radius: 999px; background: #f3c77a; color: #17130f; font: 700 30px Corm; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.dt { position: absolute; left: 70px; right: 70px; top: 1520px; }
.dt h2 { font: italic 400 108px/1 Bodoni; white-space: nowrap; }
.dt p { margin-top: 20px; font: 500 40px/1.3 Corm; }
.dt p i { display: block; margin-top: 8px; font: 600 32px Corm; font-style: normal; letter-spacing: .2em; text-transform: uppercase; color: var(--ac); }
"""
        pages = ""
        for i, (img, nm, d1, d2, pts) in enumerate(cmp):
            P = [frame_pt(img, x, y) for x, y in pts]
            dpath = "M" + " L".join(f"{x:.0f} {y:.0f}" for x, y in P)
            tx, ty = P[0]; tx = min(max(tx - 40, 90), 640); ty = max(ty - 110, 320)
            pages += f"""<div id="g{i}" class="pg"><div class="no">Le comparateur <b>0{i + 1}</b>/04</div><div class="brand">Barbier · Kadio</div><div class="rule"></div>
<div class="frame">{focus(f"f{i}", img, 62, 46)}</div>
<svg class="ln" viewBox="0 0 1080 1920"><path d="{dpath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>
<div class="tag" style="left:{tx:.0f}px;top:{ty:.0f}px">Le dégradé commence ici</div>
<div class="dt"><h2>{e(nm)}</h2><p>{e(d1)}<i>{e(d2)}</i></p></div></div>"""
        body = f"""<div id="cover" class="layer"><div class="ct" style="top:620px"><small>Le comparateur Kadio</small><h1 style="font-size:100px">{sp("Taper, drop,")}<br>{sp("burst ou")} <em>{sp("high fade ?")}</em></h1><div class="r"></div><p>Trouvez votre dégradé.</p></div></div>
{pages}
<div id="endp" class="pg"><div class="ct" style="top:500px"><small>Pas sûr ?</small><h1 style="font-size:96px">{sp("On vous conseille")}<br><em>{sp("au fauteuil.")}</em></h1><div class="r"></div>{END_INFO}</div></div>"""
        js = """
const C0 = %s, LD = %s, N = %d, TE = %s;
fin("#cover small", .2, .8, { opacity: 0, letterSpacing: "1.2em" }, { opacity: 1, letterSpacing: ".6em", ease: "expo.out" });
fin("#cover h1 .ch", .5, .7, { opacity: 0, y: 70 }, { opacity: 1, y: 0, stagger: .03, ease: "power4.out" }); cue(.5, "bass.wav", .35);
fin("#cover .r", 1.5, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin("#cover p", 1.7, .7, { opacity: 0 }, { opacity: 1 });
for (let i = 0; i < N; i++) {
  const t = C0 + i * LD, g = "#g" + i;
  show(g, t, null); tl.set(g, { zIndex: 10 + i }, 0);
  fin(g, t, .55, { xPercent: 100 }, { xPercent: 0, ease: "power3.inOut" }); cue(t, "sweep-small.wav", .4);
  fin(g + " .rule", t + .4, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
  kb(g + " .fx", t + .3, LD + .6, { scale: 1.1 }, { scale: 1.0 });
  fin(g + " .ln path", t + .9, 1.1, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power2.inOut" }); cue(t + .9, "swoosh-wind.wav", .25);
  fin(g + " .tag", t + 1.7, .45, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, ease: "back.out(2.5)" }); cue(t + 1.7, "click.wav", .3);
  fin(g + " .dt h2", t + .6, .7, { opacity: 0, y: 40 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin(g + " .dt p", t + 1.0, .6, { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: "power3.out" });
}
show("#endp", TE, null); tl.set("#endp", { zIndex: 99 }, 0); fin("#endp", TE, .55, { xPercent: 100 }, { xPercent: 0, ease: "power3.inOut" }); cue(TE, "sweep-small.wav", .4);
fin("#endp h1 .ch", TE + .5, .7, { opacity: 0, y: 60 }, { opacity: 1, y: 0, stagger: .025, ease: "power4.out" }); cue(TE + .5, "bass.wav", .35);
fin("#endp .r", TE + 1.2, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin("#endp p", TE + 1.4, .6, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .18 }); cue(TE + 1.6, "sparkle.wav", .25);
""" % (C0, LD, len(cmp), TE)
        open(os.path.join(D, "index.html"), "w").write(page("Le Comparateur", css, body, js, T, ("m1000", 40)))
    else:
        qs = [("Tu veux un look discret et propre ?", "b2", "Le taper fade", "coupe · 50 $"),
              ("Tu as des boucles à mettre en valeur ?", "b8", "Le burst fade", "coupe · 50 $"),
              ("Tu portes la barbe ?", "b4", "Le fade & barbe", "coupe + barbe · 60 $"),
              ("Tu veux du caractère, du contraste ?", "b6", "Le drop fade", "coupe · 50 $")]
        C0, QD, RD = 2.8, 2.0, 2.6; TE = round(C0 + (QD + RD) * len(qs), 2); T = round(TE + 5.0, 2)
        css = BASE + """
.qp { position: absolute; inset: 0; background: radial-gradient(80% 50% at 50% 40%, #2a2018, #17130f 70%); color: #f2ebe0; visibility: hidden; }
.qn { position: absolute; left: 0; right: 0; top: 380px; text-align: center; font: 600 30px Corm; letter-spacing: .5em; text-indent: .5em; color: #e6b07c; text-transform: uppercase; }
.qt { position: absolute; left: 80px; right: 80px; top: 560px; text-align: center; font: italic 400 104px/1.08 Bodoni; }
.btns { position: absolute; left: 0; right: 0; top: 1180px; display: flex; justify-content: center; gap: 50px; }
.btn { width: 340px; padding: 34px 0; border-radius: 999px; border: 3px solid #e6b07c; text-align: center; font: 700 52px Corm; letter-spacing: .25em; text-indent: .25em; color: #f2ebe0; }
.btn.yes { position: relative; }
.ripple { position: absolute; left: 50%; top: 50%; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%; border: 6px solid #fff; opacity: 0; }
.ans { position: absolute; left: 70px; right: 70px; top: 1520px; }
.ans small { display: block; font: 600 30px Corm; letter-spacing: .4em; text-transform: uppercase; color: var(--ac); }
.ans h2 { margin-top: 14px; font: italic 400 112px/1 Bodoni; white-space: nowrap; }
.ans p { margin-top: 18px; font: 600 40px Corm; letter-spacing: .15em; text-transform: uppercase; }
"""
        pages = ""
        for i, (q, img, nm, pr) in enumerate(qs):
            pages += f"""<div id="q{i}" class="qp"><div class="qn">Question {i + 1} / {len(qs)}</div><div class="qt">{sp(q)}</div>
<div class="btns"><div class="btn yes">OUI<div class="ripple"></div></div><div class="btn non">NON</div></div></div>
<div id="r{i}" class="pg"><div class="no">Réponse <b>0{i + 1}</b></div><div class="brand">Barbier · Kadio</div><div class="rule"></div>
<div class="frame">{focus(f"f{i}", img, 62, 46)}</div><div class="ans"><small>Ton dégradé</small><h2>{e(nm)}</h2><p>{e(pr)}</p></div></div>"""
        body = f"""<div id="cover" class="layer"><div class="ct" style="top:600px"><small>Le quiz Kadio</small><h1>{sp("Quel dégradé")}<br>{sp("est fait")} <em>{sp("pour toi ?")}</em></h1><div class="r"></div><p>Réponds dans ta tête…</p></div></div>
{pages}
<div id="endp" class="pg"><div class="ct" style="top:460px"><small>Et toi ?</small><h1 style="font-size:100px">{sp("C'est lequel ?")}<br><em>{sp("Dis-le en commentaire.")}</em></h1><div class="r"></div>{END_INFO}</div></div>"""
        js = """
const C0 = %s, QD = %s, RD = %s, N = %d, TE = %s;
fin("#cover small", .2, .8, { opacity: 0, letterSpacing: "1.2em" }, { opacity: 1, letterSpacing: ".6em", ease: "expo.out" });
fin("#cover h1 .ch", .5, .7, { opacity: 0, y: 70 }, { opacity: 1, y: 0, stagger: .03, ease: "power4.out" }); cue(.5, "bass.wav", .35);
fin("#cover .r", 1.4, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin("#cover p", 1.6, .6, { opacity: 0 }, { opacity: 1 });
for (let i = 0; i < N; i++) {
  const t = C0 + i * (QD + RD), q = "#q" + i, r = "#r" + i;
  show(q, t, t + QD + .6); tl.set(q, { zIndex: 10 + 2 * i }, 0);
  fin(q, t, .45, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, ease: "power3.out" }); cue(t, "whoosh-cine.wav", .35);
  fin(q + " .qn", t + .2, .5, { opacity: 0, y: -20 }, { opacity: 1, y: 0 });
  fin(q + " .qt .ch", t + .25, .6, { opacity: 0, y: 30 }, { opacity: 1, y: 0, stagger: .012, ease: "power3.out" });
  fin(q + " .btn", t + .7, .45, { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: .1, ease: "back.out(2)" }); cue(t + .7, "pop-bubble.wav", .25);
  const tap = t + QD - .55;
  tl.fromTo(q + " .ripple", { opacity: .9, scale: .3 }, { opacity: 0, scale: 3, duration: .5, ease: "power2.out", immediateRender: false }, tap); tl.set(q + " .ripple", { opacity: 0 }, 0);
  tl.set(q + " .btn.yes", { backgroundColor: "rgba(0,0,0,0)", color: "#f2ebe0" }, 0); tl.set(q + " .btn.yes", { backgroundColor: "#e6b07c", color: "#17130f" }, tap);
  tl.fromTo(q + " .btn.yes", { scale: .9 }, { scale: 1, duration: .3, ease: "back.out(3)", immediateRender: false }, tap); cue(tap, "click.wav", .45);
  show(r, t + QD, t + QD + RD + .6); tl.set(r, { zIndex: 11 + 2 * i }, 0);
  fin(r, t + QD, .5, { yPercent: 100 }, { yPercent: 0, ease: "power3.inOut" }); cue(t + QD, "sweep-small.wav", .4);
  fin(r + " .rule", t + QD + .35, .5, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
  kb(r + " .fx", t + QD + .3, RD + .5, { scale: 1.12 }, { scale: 1.0 });
  fin(r + " .ans small", t + QD + .45, .5, { opacity: 0, letterSpacing: "1em" }, { opacity: 1, letterSpacing: ".4em", ease: "expo.out" });
  fin(r + " .ans h2", t + QD + .6, .6, { opacity: 0, y: 40 }, { opacity: 1, y: 0, ease: "power3.out" }); cue(t + QD + .6, "sparkle.wav", .25);
  fin(r + " .ans p", t + QD + .9, .5, { opacity: 0, x: -30 }, { opacity: 1, x: 0, ease: "power3.out" });
}
show("#endp", TE, null); tl.set("#endp", { zIndex: 99 }, 0); fin("#endp", TE, .55, { yPercent: 100 }, { yPercent: 0, ease: "power3.inOut" }); cue(TE, "sweep-small.wav", .4);
fin("#endp h1 .ch", TE + .5, .7, { opacity: 0, y: 60 }, { opacity: 1, y: 0, stagger: .02, ease: "power4.out" }); cue(TE + .5, "bass.wav", .35);
fin("#endp .r", TE + 1.2, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin("#endp p", TE + 1.4, .6, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .18 }); cue(TE + 1.6, "notif-positive.wav", .3);
""" % (C0, QD, RD, len(qs), TE)
        open(os.path.join(D, "index.html"), "w").write(page("Le Quiz Barbier", css, body, js, T, ("m623", 40)))
elif F == "avis":
    # avis Google réels (texte exact, extraits), prénom + initiale
    AV = [("On se sent à la maison, accueil toujours chaleureux.", "Mélanie", "Dreadlocks", "h_locks", "50% 45%"),
          ("Salon de coiffure professionnel et chic.", "Paoline W.", "", "neon_a", "50% 30%"),
          ("Service au top, accueil chaleureux… Très professionnel, Kadio il sait bien ce qu'il fait.", "Kattiana C.", "", "b5", "60% 40%"),
          ("Excellent travail avec les cheveux de mon fils, merci beaucoup.", "Dino et Laurie T.", "", "b12", "45% 40%"),
          ("Le service est vraiment impeccable et les prix sont super abordables.", "Marianne C.", "Tresses", "h_nattes", "50% 40%"),
          ("Kadio coiffure c'est l'excellence et le professionnalisme.", "Aliyou H.", "", "h_croises", "50% 40%")]
    C0, LD = 3.2, 4.0; TE = C0 + LD * len(AV); T = round(TE + 4.8, 2)
    css = """
:root { --bg: #f2ebe0; --fg: #17130f; --ac: #b8532a; --gold: #c99a52; }
.pg { position: absolute; inset: 0; background: var(--bg); visibility: hidden; }
.frame { position: absolute; left: 70px; right: 70px; top: 250px; height: 860px; overflow: hidden; border-radius: 4px; }
.frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; filter: contrast(1.06) saturate(1.04); }
.frame:after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 60%, rgba(23,19,15,.35)); }
.no { position: absolute; left: 70px; top: 130px; font: 400 38px Bodoni; letter-spacing: .1em; } .no b { font-weight: 700; }
.brand { position: absolute; right: 70px; top: 142px; font: 500 26px Corm; letter-spacing: .45em; text-transform: uppercase; }
.rule { position: absolute; left: 70px; right: 70px; top: 210px; height: 2px; background: var(--fg); transform-origin: 0 50%; }
.qm { position: absolute; left: 50px; top: 1020px; font: 700 300px/1 Bodoni; color: var(--gold); z-index: 3; }
.qt { position: absolute; left: 90px; right: 90px; top: 1200px; font-family: Bodoni; font-style: italic; font-weight: 400; line-height: 1.12; }
.stars { position: absolute; left: 90px; top: 1690px; display: flex; gap: 14px; }
.stars i { width: 54px; height: 54px; background: var(--gold); clip-path: polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }
.who { position: absolute; left: 90px; top: 1770px; font: 600 36px Corm; letter-spacing: .18em; text-transform: uppercase; }
.who span { color: var(--ac); }
#cover, #endp { background: var(--fg); color: var(--bg); }
.ct { position: absolute; left: 60px; right: 60px; top: 600px; text-align: center; }
.ct small { display: block; font: 500 30px Corm; letter-spacing: .6em; text-indent: .6em; text-transform: uppercase; }
.ct h1 { margin-top: 40px; font: 400 120px/1.02 Bodoni; }
.ct h1 em { font-style: italic; color: #e6b07c; }
.ct .r { width: 160px; height: 3px; background: var(--ac); margin: 56px auto 40px; }
.ct p { font: italic 300 48px Corm; }
.ct .ad { font: 500 44px/1.55 Corm; font-style: normal; }
.ct .site { margin-top: 22px; font: 600 32px Corm; font-style: normal; letter-spacing: .45em; color: #e6b07c; }
.bigstars { display: flex; justify-content: center; gap: 18px; margin: 10px 0 30px; }
.bigstars i { width: 70px; height: 70px; background: #e6b07c; clip-path: polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }
"""
    pages = ""
    for i, (q, who, svc, img, pos) in enumerate(AV):
        fs = 96 if len(q) < 45 else 80 if len(q) < 75 else 66
        pages += f"""<div id="g{i}" class="pg"><div class="no">Avis <b>0{i + 1}</b></div><div class="brand">Avis Google · Kadio</div><div class="rule"></div>
<div class="frame"><img src="photos/{img}.jpg" style="object-position:{pos}"></div><div class="qm">“</div>
<div class="qt" style="font-size:{fs}px">{sp(q)}</div>
<div class="stars">{"<i></i>" * 5}</div><div class="who">{e(who)}{f" · <span>{e(svc)}</span>" if svc else ""}</div></div>"""
    body = f"""<div id="cover" class="layer"><div class="ct"><small>Avis Google</small><h1>{sp("Ce que disent")}<br><em>{sp("nos clients.")}</em></h1><div class="r"></div><div class="bigstars">{"<i></i>" * 5}</div></div></div>
{pages}
<div id="endp" class="pg"><div class="ct" style="top:560px"><small>Kadio Coiffure</small><h1 style="font-size:104px">{sp("À votre tour")}<br><em>{sp("de vous sentir chez vous.")}</em></h1><div class="r"></div>
<p class="ad">615, Antoinette-Robidoux · Longueuil<br>514 919-5970</p><p class="site">KADIOCOIFFURE.COM</p></div></div>"""
    js = """
const C0 = %s, LD = %s, N = %d, TE = %s;
fin("#cover small", .2, .8, { opacity: 0, letterSpacing: "1.2em" }, { opacity: 1, letterSpacing: ".6em", ease: "expo.out" });
fin("#cover h1 .ch", .5, .7, { opacity: 0, y: 70 }, { opacity: 1, y: 0, stagger: .03, ease: "power4.out" }); cue(.5, "bass.wav", .35);
fin("#cover .r", 1.4, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
fin("#cover .bigstars i", 1.7, .4, { scale: 0, rotate: -90 }, { scale: 1, rotate: 0, stagger: .12, ease: "back.out(2.5)" }); cue(1.7, "sparkle.wav", .3);
for (let i = 0; i < N; i++) {
  const t = C0 + i * LD, g = "#g" + i;
  show(g, t, null); tl.set(g, { zIndex: 10 + i }, 0);
  fin(g, t, .55, { yPercent: 100 }, { yPercent: 0, ease: "power3.inOut" }); cue(t, "sweep-small.wav", .4);
  fin(g + " .rule", t + .4, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
  kb(g + " .frame img", t + .3, LD + .6, { scale: 1.14 }, { scale: 1.02 });
  fin(g + " .qm", t + .5, .5, { opacity: 0, y: 40 }, { opacity: 1, y: 0, ease: "back.out(2)" });
  fin(g + " .qt .w", t + .6, .5, { opacity: 0, y: 24, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .06, ease: "power3.out" });
  fin(g + " .stars i", t + 1.5, .35, { scale: 0, rotate: -90 }, { scale: 1, rotate: 0, stagger: .09, ease: "back.out(2.5)" }); cue(t + 1.5, "sparkle.wav", .25);
  fin(g + " .who", t + 1.9, .5, { opacity: 0, x: -30 }, { opacity: 1, x: 0, ease: "power3.out" });
}
show("#endp", TE, null); tl.set("#endp", { zIndex: 99 }, 0); fin("#endp", TE, .55, { yPercent: 100 }, { yPercent: 0, ease: "power3.inOut" }); cue(TE, "sweep-small.wav", .4);
fin("#endp h1 .ch", TE + .5, .7, { opacity: 0, y: 60 }, { opacity: 1, y: 0, stagger: .02, ease: "power4.out" }); cue(TE + .5, "bass.wav", .35);
fin("#endp .r", TE + 1.3, .7, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" }); fin("#endp p", TE + 1.5, .6, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .2 }); cue(TE + 1.7, "chime.wav", .3);
""" % (C0, LD, len(AV), TE)
    open(os.path.join(D, "index.html"), "w").write(page("Avis clients Kadio", css, body, js, T, ("m657", 60)))
elif F in ("ligne", "mosaique"):
    PAL = ["#ff6b57", "#19b3a6", "#f4b43c", "#7a5cff", "#8fcb3e"]
    FOC = {"l1": (.80, .35), "l2": (.30, .26), "l3": (.34, .38), "l4": (.73, .50), "l5": (.45, .41)}
    BASE = """
:root { --bg: #f6f1ea; --ink: #15120f; }
#root { background: var(--bg); color: var(--ink); }
.ink { font-family: Outfit; }
#endp { position: absolute; inset: 0; background: var(--ink); color: #f6f1ea; visibility: hidden; z-index: 90; }
.et { position: absolute; left: 70px; right: 70px; top: 420px; text-align: center; }
.et small { display: block; font: 900 30px Outfit; letter-spacing: .5em; text-indent: .5em; text-transform: uppercase; color: #f4b43c; }
.et h1 { margin-top: 30px; font: 900 128px/.95 Outfit; letter-spacing: -.02em; }
.et h1 em { font-style: normal; color: #ff6b57; }
.chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 18px; margin: 60px 0 50px; }
.chip { padding: 18px 34px; border-radius: 999px; font: 800 40px Outfit; color: #15120f; }
.et p { font: 500 42px/1.5 Outfit; }
.et .site { margin-top: 20px; font: 900 34px Outfit; letter-spacing: .3em; color: #19b3a6; }
"""
    CHIPS = [("Coupe 50 $", PAL[2]), ("Coupe + barbe 60 $", PAL[0]), ("Contours 30 $", PAL[1]), ("Club Kadio 19,99 $/mois", PAL[3])]
    END = f"""<div id="endp"><div class="et"><small>Kadio Coiffure · Barbier</small><h1>{sp("Ta ligne,")}<br><em>{sp("notre signature.")}</em></h1>
<div class="chips">{"".join(f'<span class="chip" style="background:{c}">{e(t)}</span>' for t, c in CHIPS)}</div>
<p>615, Antoinette-Robidoux · Longueuil<br>514 919-5970</p><p class="site">KADIOCOIFFURE.COM</p></div></div>"""
    END_JS = """
show("#endp", TE, null); fin("#endp", TE, .6, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(150% at 50% 50%)", ease: "power3.inOut" }); cue(TE, "whoosh-cine.wav", .4);
fin("#endp small", TE + .4, .6, { opacity: 0, letterSpacing: "1.2em" }, { opacity: 1, letterSpacing: ".5em", ease: "expo.out" });
fin("#endp h1 .ch", TE + .5, .5, { opacity: 0, y: 80, rotate: 8 }, { opacity: 1, y: 0, rotate: 0, stagger: .025, ease: "back.out(2)" }); cue(TE + .5, "bass.wav", .4);
fin("#endp .chip", TE + 1.3, .45, { scale: 0, rotate: -10 }, { scale: 1, rotate: 0, stagger: .14, ease: "back.out(2.5)" });
for (let k = 0; k < 4; k++) cue(TE + 1.3 + k * .14, "pop-bubble.wav", .25);
fin("#endp p", TE + 2.0, .5, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .15 }); cue(TE + 2.2, "notif-positive.wav", .3);
"""
    def fpos(img, fw, fh, fx0, fy0):
        W, H = Image.open(os.path.join(R, "photos", img + ".jpg")).size
        sc = max(fw / W, fh / H); dw, dh = W * sc, H * sc; ox, oy = fx0 + (fw - dw) / 2, fy0 + (fh - dh) / 2
        cx, cy = FOC[img]; return ox + cx * dw, oy + cy * dh

    if F == "ligne":
        SL = [("l1", "Net."), ("l2", "Précis."), ("l3", "Tracé."), ("l4", "Sculpté."), ("l5", "Signé.")]
        C0, LD = 2.8, 2.6; TE = round(C0 + LD * len(SL), 2); T = round(TE + 4.6, 2)
        css = BASE + """
.cbg { position: absolute; inset: 0; visibility: hidden; }
.card { position: absolute; left: 70px; top: 260px; width: 940px; height: 1150px; border-radius: 48px; overflow: hidden; box-shadow: 0 40px 80px rgba(0,0,0,.25); }
.card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; }
.card .bw { filter: grayscale(1) contrast(1.1) brightness(1.05); }
.card .col { filter: saturate(1.15) contrast(1.05); }
.ring { position: absolute; width: 300px; height: 300px; margin: -150px 0 0 -150px; z-index: 5; overflow: visible; }
.ring circle { fill: none; stroke: #fff; stroke-width: 10; stroke-linecap: round; filter: drop-shadow(0 0 14px rgba(255,255,255,.9)); }
.word { position: absolute; left: 70px; right: 70px; top: 1460px; font: 900 210px/1 Outfit; letter-spacing: -.04em; color: #fff; white-space: nowrap; }
.num { position: absolute; right: 80px; top: 150px; font: 900 60px Outfit; color: rgba(255,255,255,.9); }
.lab { position: absolute; left: 80px; top: 160px; font: 800 34px Outfit; letter-spacing: .35em; color: rgba(255,255,255,.95); text-transform: uppercase; }
.dot { position: absolute; border-radius: 50%; background: rgba(255,255,255,.25); }
#intro { position: absolute; inset: 0; }
#intro h1 { position: absolute; left: 70px; right: 70px; top: 640px; font: 900 190px/.92 Outfit; letter-spacing: -.04em; }
#intro h1 em { font-style: normal; color: #ff6b57; }
#intro small { position: absolute; left: 76px; top: 560px; font: 800 32px Outfit; letter-spacing: .45em; text-transform: uppercase; color: #19b3a6; }
#intro svg { position: absolute; left: 70px; top: 1140px; width: 940px; height: 260px; overflow: visible; }
#intro path { fill: none; stroke: #15120f; stroke-width: 14; stroke-linecap: round; stroke-linejoin: round; }
"""
        slides = ""
        for i, (img, w) in enumerate(SL):
            X, Y = fpos(img, 940, 1150, 0, 0)
            slides += f"""<div id="s{i}" class="cbg" style="background:{PAL[i]}"><i class="dot" style="width:520px;height:520px;left:{-180 + i * 90}px;top:{1300 - i * 120}px"></i><i class="dot" style="width:260px;height:260px;left:{760 - i * 40}px;top:{90 + i * 30}px"></i>
<div class="lab">La ligne Kadio</div><div class="num">0{i + 1}</div>
<div class="card"><img class="bw" src="photos/{img}.jpg" style="object-position:{FOC[img][0] * 100:.0f}% {FOC[img][1] * 100:.0f}%"><img class="col" src="photos/{img}.jpg" style="object-position:{FOC[img][0] * 100:.0f}% {FOC[img][1] * 100:.0f}%">
<svg class="ring" viewBox="0 0 300 300" style="left:{X:.0f}px;top:{Y:.0f}px"><circle cx="150" cy="150" r="120" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg></div>
<div class="word">{sp(w)}</div></div>"""
        body = f"""<div id="intro"><small>Barbier · Kadio</small><h1>{sp("La ligne")}<br><em>{sp("Kadio.")}</em></h1>
<svg viewBox="0 0 940 260"><path d="M10 40 L330 40 L330 150 L620 150 L620 230 L930 230" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg></div>
{slides}{END}"""
        js = """
const C0 = %s, LD = %s, N = %d, TE = %s;
fin("#intro small", .2, .6, { opacity: 0, x: -40 }, { opacity: 1, x: 0, ease: "expo.out" });
fin("#intro h1 .ch", .35, .5, { opacity: 0, y: 120, rotate: 10 }, { opacity: 1, y: 0, rotate: 0, stagger: .04, ease: "back.out(2)" }); cue(.35, "bass.wav", .4);
fin("#intro path", 1.2, 1.1, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power2.inOut" }); cue(1.2, "swoosh-wind.wav", .3);
for (let i = 0; i < N; i++) {
  const t = C0 + i * LD, s = "#s" + i;
  show(s, t, null); tl.set(s, { zIndex: 10 + i }, 0);
  fin(s, t, .5, { clipPath: "inset(0%% 0%% 100%% 0%%)" }, { clipPath: "inset(0%% 0%% 0%% 0%%)", ease: "power4.inOut" }); cue(t, i %% 2 ? "whoosh-fast.wav" : "woosh-air.wav", .4);
  fin(s + " .card", t + .15, .7, { y: 400, rotate: i %% 2 ? 6 : -6, scale: .85 }, { y: 0, rotate: 0, scale: 1, ease: "back.out(1.4)" });
  kb(s + " .card img", t + .2, LD + .6, { scale: 1.25 }, { scale: 1.05 });
  fin(s + " .col", t + .8, .6, { clipPath: "inset(0%% 100%% 0%% 0%%)" }, { clipPath: "inset(0%% 0%% 0%% 0%%)", ease: "power2.inOut" }); cue(t + .8, "sweep-small.wav", .3);
  fin(s + " .ring circle", t + 1.2, .6, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power2.out" });
  fin(s + " .ring", t + 1.2, .6, { scale: .6, rotate: -90 }, { scale: 1, rotate: 0, ease: "back.out(2)" }); cue(t + 1.2, "click.wav", .35);
  tl.to(s + " .ring", { scale: 1.08, duration: .3, yoyo: true, repeat: 1, ease: "sine.inOut" }, t + 1.9);
  fin(s + " .word .ch", t + .55, .45, { opacity: 0, y: 160, rotate: 12 }, { opacity: 1, y: 0, rotate: 0, stagger: .035, ease: "back.out(2.2)" }); cue(t + .55, "pop-hard.wav", .25);
  fin(s + " .num", t + .4, .5, { opacity: 0, scale: 2 }, { opacity: 1, scale: 1, ease: "power4.out" });
  tl.to(s + " .dot", { y: -80, x: 40, duration: LD + .5, ease: "none" }, t);
}
""" % (C0, LD, len(SL), TE) + END_JS
        open(os.path.join(D, "index.html"), "w").write(page("La Ligne Kadio", css, body, js, T, ("m1000", 20)))
    else:
        TILES = [("l1", "Barbe sculptée", None), ("c1", "Dégradé", ("Coupe", "50 $")), ("l2", "Ligne au rasoir", None),
                 ("l3", "Locks + dégradé", None), ("c2", "Contour", ("Coupe + barbe", "60 $")), ("l4", "Contour net", None)]
        TC = {"c1": PAL[0], "c2": PAL[1]}
        G = [(50, 230), (550, 230), (50, 790), (550, 790), (50, 1350), (550, 1350)]
        L0 = [(x, y, 480, 540) for x, y in G]
        photos = [i for i, t in enumerate(TILES) if not t[0].startswith("c")]
        def focus_layout(fi):
            out = [None] * len(TILES); out[fi] = (50, 230, 980, 1220); k = 0; w = (980 - 4 * 20) / 5
            for i in range(len(TILES)):
                if i == fi: continue
                out[i] = (50 + k * (w + 20), 1470, w, 400); k += 1
            return out
        C0 = 2.6; FD = 2.2; FS = [C0 + 1.6 + j * FD for j in range(len(photos))]; TB = FS[-1] + FD; TE = round(TB + 2.6, 2); T = round(TE + 4.6, 2)
        LAY = {"L0": L0, "F": {str(fi): focus_layout(fi) for fi in photos}}
        css = BASE + """
.tile { position: absolute; overflow: hidden; border-radius: 36px; visibility: hidden; }
.tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.tag { position: absolute; left: 24px; bottom: 24px; padding: 14px 26px; border-radius: 999px; background: #fff; font: 800 38px Outfit; color: #15120f; white-space: nowrap; }
.ctile { display: flex; flex-direction: column; justify-content: center; align-items: center; color: #fff; text-align: center; }
.ctile b { font: 900 76px/1 Outfit; letter-spacing: -.02em; }
.ctile .pa, .ctile .pb { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; }
.ctile .pb small { font: 800 40px Outfit; } .ctile .pb b { font-size: 120px; }
.head { position: absolute; left: 50px; right: 50px; top: 80px; display: flex; justify-content: space-between; align-items: center; font: 900 40px Outfit; letter-spacing: .3em; visibility: hidden; }
.head span { color: #19b3a6; }
#intro { position: absolute; inset: 0; z-index: 50; }
.blk { position: absolute; left: 50px; right: 50px; height: 300px; border-radius: 40px; display: flex; align-items: center; justify-content: center; font: 900 170px/1 Outfit; letter-spacing: -.03em; color: #fff; }
"""
        tiles = ""
        for i, (k, lab, pr) in enumerate(TILES):
            if k.startswith("c"):
                tiles += f'<div id="t{i}" class="tile ctile" style="background:{TC[k]}"><div class="pa"><b>{e(lab)}</b></div><div class="pb"><small>{e(pr[0])}</small><b>{e(pr[1])}</b></div></div>'
            else:
                fx, fy = FOC[k]
                tiles += f'<div id="t{i}" class="tile"><img src="photos/{k}.jpg" style="object-position:{fx * 100:.0f}% {fy * 100:.0f}%"><div class="tag">{e(lab)}</div></div>'
        body = f"""<div class="head" id="head"><span>KADIO</span>BARBIER</div>{tiles}
<div id="intro"><div class="blk" style="top:420px;background:{PAL[0]}">{sp("PROPRE.")}</div><div class="blk" style="top:810px;background:{PAL[1]}">{sp("PRÉCIS.")}</div><div class="blk" style="top:1200px;background:{PAL[2]};color:#15120f">{sp("KADIO.")}</div></div>
{END}"""
        js = """
const C0 = %s, FS = %s, TB = %s, TE = %s, LAY = %s, PH = %s, N = %d, FS_D = FS[1] - FS[0];
// intro : 3 blocs de couleur
document.querySelectorAll("#intro .blk").forEach(function (b, k) { fin(b, .15 + k * .35, .5, { xPercent: k %% 2 ? 110 : -110 }, { xPercent: 0, ease: "power4.out" }); cue(.15 + k * .35, "whoosh-fast.wav", .3);
  fin(b.querySelectorAll(".ch"), .35 + k * .35, .4, { opacity: 0, y: 60 }, { opacity: 1, y: 0, stagger: .03, ease: "back.out(2)" }); });
cue(1.4, "bass.wav", .4);
document.querySelectorAll("#intro .blk").forEach(function (b, k) { tl.to(b, { xPercent: k %% 2 ? -110 : 110, duration: .45, ease: "power4.in" }, C0 - .5 + k * .06); });
show("#head", C0, null); fin("#head", C0, .5, { opacity: 0, y: -30 }, { opacity: 1, y: 0 });
function place(i, r) { return { left: r[0], top: r[1], width: r[2], height: r[3] }; }
for (let i = 0; i < N; i++) { const r = LAY.L0[i]; tl.set("#t" + i, place(i, r), 0); show("#t" + i, C0, null);
  fin("#t" + i, C0 + i * .1, .55, { scale: 0, rotate: i %% 2 ? 8 : -8 }, { scale: 1, rotate: 0, ease: "back.out(1.8)" }); cue(C0 + i * .1, "pop-bubble.wav", .2); }
PH.forEach(function (fi, j) {
  const t = FS[j], L = LAY.F[String(fi)];
  for (let i = 0; i < N; i++) tl.to("#t" + i, Object.assign(place(i, L[i]), { duration: .6, ease: "power3.inOut" }), t);
  cue(t, "sweep-small.wav", .35);
  fin("#t" + fi + " .tag", t + .5, .45, { opacity: 0, y: 30, scale: .8 }, { opacity: 1, y: 0, scale: 1, ease: "back.out(2.5)" }); cue(t + .5, "click.wav", .3);
  tl.fromTo("#t" + fi + " img", { scale: 1.15 }, { scale: 1.02, duration: 1.9, ease: "none", immediateRender: false }, t);
  tl.to("#t" + fi + " .tag", { opacity: 0, duration: .2 }, t + FS_D - .1);
});
tl.to(".ctile .pa", { opacity: 0, duration: .25 }, FS[0]); tl.to(".ctile .pa", { opacity: 1, duration: .3 }, TB + .3);
for (let i = 0; i < N; i++) tl.to("#t" + i, Object.assign(place(i, LAY.L0[i]), { duration: .6, ease: "power3.inOut" }), TB);
cue(TB, "whoosh-cine.wav", .35);
document.querySelectorAll(".ctile").forEach(function (c, k) { const t = TB + .7 + k * .3;
  tl.to(c.querySelector(".pa"), { yPercent: -100, opacity: 0, duration: .4, ease: "power3.in" }, t);
  fin(c.querySelector(".pb"), t + .3, .45, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, ease: "back.out(2)" }); cue(t + .3, "notif-positive.wav", .25); });
""" % (C0, json.dumps(FS), TB, TE, json.dumps(LAY), json.dumps(photos), len(TILES)) + END_JS
        open(os.path.join(D, "index.html"), "w").write(page("Mosaïque Barbier", css, body, js, T, ("m623", 60)))
print(F, "ok")
