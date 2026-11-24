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
elif F == "signature":
    looks = [("h_nattes", "Nattes", "dès 40 $", "50% 40%"), ("h_zigzag", "Zigzag", "design · dès 60 $", "50% 45%"),
             ("h_twists", "Twists", "dès 55 $", "50% 45%"), ("h_croises", "Croisés", "design · dès 60 $", "50% 40%"),
             ("h_locks", "Locks", "retwist · 150 $", "50% 45%"), ("h_chignon", "Chignon tressé", "nattes · dès 40 $", "50% 40%")]
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
        pages += f"""<div id="g{i}" class="pg{' alt' if i % 2 else ''}"><div class="no">N° <b>0{i + 1}</b></div><div class="brand">Kadio · Hiver 26</div><div class="rule"></div>
<div class="frame"><img src="photos/{img}.jpg" style="object-position:{pos}"></div><div class="big">0{i + 1}</div><div class="name">{e(nm)}</div><div class="price">{e(pr)}</div></div>"""
    body = f"""<div id="cover"><div class="ct"><small>Kadio Coiffure présente</small><h1>{sp("La")}<br><em>{sp("Signature")}</em></h1><div class="r"></div><p>Collection hiver 2026</p></div></div>
{pages}
<div id="endp" class="pg"><div class="et"><h2>{sp("Réservez")}<br>{sp("votre signature.")}</h2><div class="r"></div><p>615, Antoinette-Robidoux · Longueuil</p><p>514 919-5970</p><div class="site">kadiocoiffure.com</div></div></div>"""
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
    open(os.path.join(D, "index.html"), "w").write(page("La Signature", css, body, js, T, ("m623", 12)))

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
print(F, "ok")
