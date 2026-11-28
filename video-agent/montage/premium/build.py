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
# ---------- Personnage « Kadi » (original) ----------
CHAR_CSS = """
#kadi { position: absolute; right: 10px; bottom: -10px; width: 420px; height: 546px; z-index: 40; transform-origin: 50% 100%; }
#kadi svg { width: 100%; height: 100%; overflow: visible; }
.sub { right: 420px !important; left: 40px !important; text-align: left !important; top: 1560px !important; }
"""
CHAR_SVG = """
<div id="kadi"><svg viewBox="0 0 400 520">
 <g id="kbody">
  <path d="M60 520 C60 430 110 395 200 395 C290 395 340 430 340 520 Z" fill="#d9b26f"/>
  <path d="M150 400 Q200 440 250 400" fill="none" stroke="#b8893f" stroke-width="10" stroke-linecap="round"/>
  <text x="200" y="490" text-anchor="middle" font-family="Outfit" font-weight="900" font-size="46" fill="#15120f">K</text>
 </g>
 <g id="karm"><path d="M318 470 C350 430 360 380 352 330" fill="none" stroke="#d9b26f" stroke-width="40" stroke-linecap="round"/>
  <circle cx="352" cy="318" r="26" fill="#7a4a2e"/><rect x="345" y="262" width="15" height="44" rx="7" fill="#7a4a2e"/></g>
 <g id="khead">
  <rect x="178" y="330" width="44" height="70" rx="18" fill="#6e4229"/>
  <g fill="#1d1511">
   <circle cx="200" cy="150" r="128"/><circle cx="96" cy="190" r="70"/><circle cx="304" cy="190" r="70"/>
   <circle cx="120" cy="100" r="66"/><circle cx="280" cy="100" r="66"/><circle cx="200" cy="58" r="66"/>
   <circle cx="88" cy="258" r="46"/><circle cx="312" cy="258" r="46"/>
  </g>
  <g fill="#3a2a20" opacity=".55"><circle cx="150" cy="70" r="10"/><circle cx="260" cy="80" r="8"/><circle cx="96" cy="160" r="9"/><circle cx="310" cy="150" r="10"/><circle cx="210" cy="40" r="7"/><circle cx="70" cy="230" r="7"/><circle cx="330" cy="230" r="8"/></g>
  <circle cx="112" cy="240" r="24" fill="#7a4a2e"/><circle cx="288" cy="240" r="24" fill="#7a4a2e"/>
  <ellipse cx="200" cy="245" rx="92" ry="104" fill="#8a5636"/>
  <path d="M112 190 Q200 150 288 190 L288 175 Q200 132 112 175 Z" fill="#1d1511"/>
  <g id="kbrows" fill="none" stroke="#1d1511" stroke-width="9" stroke-linecap="round"><path d="M140 202 Q160 190 180 200"/><path d="M220 200 Q240 190 260 202"/></g>
  <g id="keyes"><ellipse cx="162" cy="232" rx="17" ry="20" fill="#fff"/><ellipse cx="238" cy="232" rx="17" ry="20" fill="#fff"/>
   <circle cx="165" cy="235" r="10" fill="#1d1511"/><circle cx="241" cy="235" r="10" fill="#1d1511"/><circle cx="169" cy="230" r="3.5" fill="#fff"/><circle cx="245" cy="230" r="3.5" fill="#fff"/></g>
  <g id="klids" fill="#8a5636"><rect x="140" y="208" width="44" height="0" /><rect x="216" y="208" width="44" height="0"/></g>
  <path d="M196 248 Q186 280 200 284 Q212 286 208 270" fill="none" stroke="#5e3520" stroke-width="6" stroke-linecap="round"/>
  <circle cx="140" cy="285" r="15" fill="#c7704f" opacity=".35"/><circle cx="260" cy="285" r="15" fill="#c7704f" opacity=".35"/>
  <path id="ksmile" d="M170 305 Q200 325 230 305" fill="none" stroke="#4a1f14" stroke-width="7" stroke-linecap="round"/>
  <g id="kmouth" transform="translate(200 312)"><ellipse rx="26" ry="20" fill="#3d1410"/><ellipse cy="10" rx="15" ry="8" fill="#d9605a"/><rect x="-18" y="-20" width="36" height="8" rx="3" fill="#fff"/></g>
 </g>
</svg></div>"""
CHAR_JS = """
// Kadi : entrée, bouche, clignements, mouvements
fin("#kadi", .3, .7, { y: 560 }, { y: 0, ease: "back.out(1.4)" }); cue(.3, "pop-long.wav", .2);
tl.set("#kmouth", { scaleY: 0.05, scaleX: .8, transformOrigin: "50% 0%" }, 0); tl.set("#ksmile", { opacity: 1 }, 0);
MOUTH.forEach(function (m) { const v = m[1]; tl.set("#kmouth", { scaleY: v < .12 ? .05 : .25 + v * .9, scaleX: .75 + v * .3 }, m[0]); tl.set("#ksmile", { opacity: v < .12 ? 1 : 0 }, m[0]); });
for (let t = 1.7; t < T; t += 3.1 + ((t * 7) % 1.3)) { tl.to("#klids rect", { attr: { height: 48 }, duration: .07 }, t); tl.to("#klids rect", { attr: { height: 0 }, duration: .09 }, t + .1); }
for (let t = .9; t < T; t += 1.6) tl.to("#khead", { rotate: ((t * 13) % 2 ? 2.5 : -2.5), y: -4, duration: .8, ease: "sine.inOut", transformOrigin: "50% 80%" }, t);
tl.set("#karm", { rotate: 50, transformOrigin: "318px 470px" }, 0);
S.forEach(function (s, i) { if (i === 2 || i === 3 || i === 6) { tl.to("#karm", { rotate: 0, duration: .4, ease: "back.out(2)" }, s[0] + .2); tl.to("#karm", { rotate: 8, duration: .3, yoyo: true, repeat: 3, ease: "sine.inOut" }, s[0] + .7); tl.to("#karm", { rotate: 50, duration: .4, ease: "power2.in" }, s[0] + s[1] - .6); } });
S.forEach(function (s, i) { if (i === 0 || i === 1) { tl.to("#kbrows", { y: -10, duration: .2 }, s[0] + .4); tl.to("#kbrows", { y: 0, duration: .3 }, s[0] + 1.6); } });
"""

F2_CSS = """
:root { --bg: #0b0908; --fg: #f4ece0; --gold: #d9b26f; --red: #e5483b; --green: #2fbf71; }
#root { background: radial-gradient(90% 60% at 50% 35%, #1d1612, #0b0908 70%); color: var(--fg); }
.sc { position: absolute; inset: 0; visibility: hidden; }
.ttl { position: absolute; left: 0; right: 0; top: 440px; text-align: center; }
.ttl .pill { display: inline-block; padding: 26px 64px; border-radius: 999px; font: 900 120px/1 Outfit; letter-spacing: -.02em; color: #fff; }
.ttl .m { background: var(--red); } .ttl .v { background: var(--green); }
.ttl .ou { display: block; margin: 30px 0; font: italic 400 90px Bodoni; color: var(--gold); }
.ttl small { display: block; margin-top: 60px; font: 800 38px Outfit; letter-spacing: .3em; color: var(--gold); text-transform: uppercase; }
.dots { position: absolute; left: 0; right: 0; top: 230px; display: flex; justify-content: center; gap: 22px; }
.dots i { width: 26px; height: 26px; border-radius: 50%; border: 4px solid var(--gold); }
.card { position: absolute; left: 110px; right: 110px; top: 380px; height: 760px; perspective: 2000px; }
.card .in { position: absolute; inset: 0; border-radius: 48px; background: #f4ece0; color: #15120f; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 60px; box-shadow: 0 40px 80px rgba(0,0,0,.5); }
.card .in small { font: 900 40px Outfit; letter-spacing: .3em; color: #b8532a; text-transform: uppercase; }
.card .in b { margin-top: 40px; font: italic 400 94px/1.1 Bodoni; }
.card .in .qm { position: absolute; right: 40px; bottom: 10px; font: 900 260px/1 Outfit; color: rgba(21,18,15,.08); }
.vph { position: absolute; left: 60px; right: 60px; top: 180px; height: 760px; border-radius: 40px; overflow: hidden; }
.vph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; }
.stamp { position: absolute; left: 0; right: 0; top: 830px; text-align: center; z-index: 5; }
.stamp span { display: inline-block; padding: 18px 70px; border: 12px solid; border-radius: 24px; font: 900 150px/1 Outfit; letter-spacing: .05em; transform: rotate(-8deg); background: rgba(11,9,8,.85); }
.stamp.f span { color: var(--red); border-color: var(--red); } .stamp.t span { color: var(--green); border-color: var(--green); }
.chips { position: absolute; left: 60px; right: 60px; top: 1100px; display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; }
.chip { padding: 18px 34px; border-radius: 999px; border: 3px solid var(--gold); font: 800 42px Outfit; background: rgba(11,9,8,.7); }
.chip.x { border-color: var(--red); color: var(--red); text-decoration: line-through; text-decoration-thickness: 5px; }
.bars { position: absolute; left: 120px; right: 120px; top: 1100px; }
.bar { margin-bottom: 30px; } .bar small { display: block; font: 800 34px Outfit; letter-spacing: .15em; text-transform: uppercase; margin-bottom: 12px; }
.bar i { display: block; height: 34px; border-radius: 17px; background: var(--gold); transform-origin: 0 50%; }
.bar.lo i { background: rgba(244,236,224,.3); }
.spi { position: absolute; left: 140px; top: 300px; width: 800px; height: 900px; overflow: visible; }
.spi path { fill: none; stroke: var(--gold); stroke-width: 22; stroke-linecap: round; }
.spi circle { fill: var(--red); }
.end { position: absolute; left: 70px; right: 70px; top: 380px; text-align: center; }
.end h1 { font: 400 110px/1.05 Bodoni; } .end h1 em { font-style: italic; color: var(--gold); }
.end .tag { margin-top: 70px; font: 900 46px Outfit; letter-spacing: .12em; color: var(--gold); }
.end .br { margin-top: 24px; font: 500 34px Corm; letter-spacing: .5em; text-transform: uppercase; opacity: .8; }
.sub { position: absolute; visibility: hidden; z-index: 30; left: 40px; right: 420px; top: 1560px; text-align: left; }
.sub span { display: inline; padding: 8px 16px; line-height: 1.5; background: rgba(0,0,0,.7); color: #fff; font: 700 38px Outfit; border-radius: 12px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
"""
F2_JS = """
const A = (i) => S[i][0], E = (i) => S[i][0] + S[i][1];
S.forEach(function (s, i) { show("#s" + i, s[0], i === S.length - 1 ? null : s[0] + s[1] + .05); show("#u" + i, s[0] + L, s[0] + s[1] - .05); fin("#u" + i, s[0] + L, .25, { opacity: 0 }, { opacity: 1 }); });
fin("#s0 .m", .2, .5, { scale: 0, rotate: -12 }, { scale: 1, rotate: -3, ease: "back.out(2.5)" }); cue(.2, "pop-hard.wav", .35);
fin("#s0 .ou", .7, .4, { opacity: 0 }, { opacity: 1 });
fin("#s0 .v", 1.0, .5, { scale: 0, rotate: 12 }, { scale: 1, rotate: 3, ease: "back.out(2.5)" }); cue(1.0, "pop-hard.wav", .35);
fin("#s0 small", 1.7, .5, { opacity: 0, letterSpacing: "1em" }, { opacity: 1, letterSpacing: ".3em", ease: "expo.out" });
[1, 3, 5, 7].forEach(function (i, k) {
  fin("#s" + i, A(i), .4, { opacity: 0 }, { opacity: 1 }); cue(A(i), "whoosh-cine.wav", .3);
  fin("#s" + i + " .card .in", A(i) + .1, .7, { rotationY: -90, scale: .8 }, { rotationY: 0, scale: 1, ease: "back.out(1.4)" });
  fin("#s" + i + " .card b .w", A(i) + .6, .4, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .06 });
  document.querySelectorAll("#s" + i + " .dots i").forEach(function (d, j) { tl.set(d, { backgroundColor: j <= k ? "#d9b26f" : "rgba(0,0,0,0)" }, 0); });
  fin("#s" + i + " .dots i:nth-child(" + (k + 1) + ")", A(i) + .3, .4, { scale: 0 }, { scale: 1, ease: "back.out(3)" }); cue(A(i) + .3, "click.wav", .25);
  tl.to("#s" + i + " .card .in", { rotationY: 90, duration: .35, ease: "power2.in" }, E(i) - .35);
});
function stamp(i, t) { fin("#s" + i + " .stamp span", t, .35, { scale: 2.6, opacity: 0 }, { scale: 1, opacity: 1, ease: "power4.in" }); cue(t + .3, "cut_hit_sub.wav", .5);
  tl.fromTo("#root", { x: -12 }, { x: 0, duration: .4, ease: "elastic.out(1,.3)", immediateRender: false }, t + .35); }
[2, 4, 8].forEach(function (i) { fin("#s" + i, A(i), .4, { opacity: 0 }, { opacity: 1 });
  fin("#s" + i + " .vph", A(i), .6, { y: 200, opacity: 0 }, { y: 0, opacity: 1, ease: "power3.out" }); kb("#s" + i + " .vph img", A(i), S[i][1] + .5, { scale: 1.2 }, { scale: 1.03 });
  stamp(i, A(i) + .3);
  document.querySelectorAll("#s" + i + " .chip").forEach(function (c, k) { const t = A(i) + 1.6 + k * Math.max(.5, (S[i][1] - 2.5) / 3); fin(c, t, .4, { scale: 0 }, { scale: 1, ease: "back.out(2.5)" }); cue(t, "pop-bubble.wav", .2); }); });
document.querySelectorAll("#s2 .bar i").forEach(function (b, k) { fin(b, A(2) + 2 + k * 1.2, .9, { scaleX: 0 }, { scaleX: 1, ease: "power3.out" }); cue(A(2) + 2 + k * 1.2, "sweep-small.wav", .25); });
document.querySelectorAll("#s2 .bar small").forEach(function (b, k) { fin(b, A(2) + 1.9 + k * 1.2, .4, { opacity: 0 }, { opacity: 1 }); });
fin("#s6", A(6), .4, { opacity: 0 }, { opacity: 1 }); stamp(6, A(6) + .2);
fin("#s6 .spi path", A(6) + .4, 2, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power1.inOut" }); cue(A(6) + .4, "swoosh-wind.wav", .25);
fin("#s6 .spi circle", A(6) + 2.2, .35, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, stagger: .15, ease: "back.out(3)" });
tl.to("#s6 .spi circle", { scale: 1.3, duration: .35, yoyo: true, repeat: 5, stagger: .05, transformOrigin: "50% 50%" }, A(6) + 3.4);
document.querySelectorAll("#s6 .chip").forEach(function (c, k) { fin(c, A(6) + S[6][1] * .6 + k * .5, .4, { scale: 0 }, { scale: 1, ease: "back.out(2.5)" }); });
fin("#s9", A(9), .5, { opacity: 0 }, { opacity: 1 });
fin("#s9 h1 .w", A(9) + .3, .6, { opacity: 0, y: 40, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .15, ease: "power3.out" }); cue(A(9) + .3, "bass.wav", .4);
fin("#s9 .tag", E(9) - 3, .5, { opacity: 0, letterSpacing: ".5em" }, { opacity: 1, letterSpacing: ".12em", ease: "expo.out" }); cue(E(9) - 3, "chime.wav", .3);
fin("#s9 .br", E(9) - 2.6, .6, { opacity: 0 }, { opacity: .8 });
"""

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
elif F in ("ligne", "mosaique", "mosaique2"):
    PAL = ["#ff6b57", "#19b3a6", "#f4b43c", "#7a5cff", "#8fcb3e"]
    FOC = {"l1": (.80, .35), "l2": (.30, .26), "l3": (.34, .38), "l4": (.73, .50), "l5": (.45, .41),
           "b2": (.55, .40), "b4": (.55, .45), "b6": (.55, .42), "b8": (.45, .45), "b3": (.5, .4), "b9": (.5, .45)}
    M2 = F == "mosaique2"
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
        INTRO = [("PROPRE.", PAL[0], "#fff"), ("PRÉCIS.", PAL[1], "#fff"), ("KADIO.", PAL[2], "#15120f")]
        if M2:
            TILES = [("b6", "Drop fade", None), ("c1", "Fade", ("Contours", "30 $")), ("b4", "Fade & barbe", None),
                     ("b8", "Burst fade", None), ("c2", "Club", ("Club Kadio", "19,99 $")), ("b3", "Taper bouclé", None)]
            TC = {"c1": PAL[3], "c2": PAL[4]}
            INTRO = [("FRAIS.", PAL[3], "#fff"), ("STYLÉ.", PAL[4], "#15120f"), ("KADIO.", PAL[0], "#fff")]
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
<div id="intro">{"".join(f'<div class="blk" style="top:{420 + k * 390}px;background:{bg};color:{fg}">{sp(w)}</div>' for k, (w, bg, fg) in enumerate(INTRO))}</div>
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
        open(os.path.join(D, "index.html"), "w").write(page("Mosaïque Barbier 2" if M2 else "Mosaïque Barbier", css, body, js, T, ("m1000", 55) if M2 else ("m623", 60)))
elif F == "fiers1":
    T = 31.0
    css = """
:root { --bg: #0b0908; --fg: #f4ece0; --gold: #d9b26f; --red: #e0473a; }
#root { background: var(--bg); color: var(--fg); }
.sc { position: absolute; inset: 0; visibility: hidden; }
.bgph { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(26px) brightness(.28) saturate(.7); transform: scale(1.15); }
.big { position: absolute; left: 70px; right: 70px; text-align: center; font: 400 200px/1 Bodoni; letter-spacing: -.01em; }
.q { position: absolute; left: 80px; right: 80px; text-align: center; font: italic 300 64px/1.2 Corm; }
.rows { position: absolute; left: 80px; right: 80px; top: 520px; display: flex; flex-direction: column; gap: 90px; }
.row { position: relative; }
.row small { display: block; font: 800 38px Outfit; letter-spacing: .3em; text-transform: uppercase; color: var(--gold); }
.row b { position: relative; display: inline-block; margin-top: 12px; font: italic 400 140px/1 Bodoni; }
.row b i { position: absolute; left: -12px; right: -12px; top: 52%; height: 14px; background: var(--red); transform-origin: 0 50%; border-radius: 7px; }
.pic { position: absolute; overflow: hidden; border-radius: 30px; }
.pic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; }
.cap { position: absolute; left: 80px; right: 80px; text-align: center; font: 400 92px/1.08 Bodoni; text-shadow: 0 8px 40px rgba(0,0,0,.8); }
.cap em { font-style: italic; color: var(--gold); }
.lab { position: absolute; left: 22px; bottom: 22px; padding: 10px 24px; border-radius: 999px; background: rgba(11,9,8,.75); font: 800 30px Outfit; letter-spacing: .15em; text-transform: uppercase; color: var(--gold); }
.gold { color: var(--gold); }
.tag { position: absolute; left: 0; right: 0; top: 1500px; text-align: center; font: 900 46px Outfit; letter-spacing: .12em; color: var(--gold); }
.brand { position: absolute; left: 0; right: 0; top: 1640px; text-align: center; font: 500 34px Corm; letter-spacing: .5em; text-indent: .5em; text-transform: uppercase; opacity: .8; }
.gline { position: absolute; left: 440px; width: 200px; height: 3px; background: var(--gold); transform-origin: 50% 50%; }
"""
    TX = [("h_locks", "Locks"), ("h_twists", "Twists"), ("bt2", "Barrel twist"), ("l2", "Afro"), ("h_nattes", "Tresses"), ("l3", "Locks")]
    grid = "".join(f'<div class="pic g" style="left:{50 + (k % 2) * 500}px;top:{170 + (k // 2) * 560}px;width:480px;height:540px"><img src="photos/{n}.jpg"><span class="lab">{e(l)}</span></div>' for k, (n, l) in enumerate(TX))
    body = f"""
<div id="s0" class="sc"><div class="big" style="top:720px;font-size:170px;white-space:nowrap">{sp("PROPRE ?")}</div><div class="q" style="top:1000px">{sp("Les cheveux courts, c'est plus propre ?")}</div></div>
<div id="s1" class="sc"><img class="bgph" src="photos/l2.jpg">
 <div class="rows"><div class="row"><small>Ton afro ?</small><b>« Négligé. »<i></i></b></div><div class="row"><small>Tes locks ?</small><b>« Voyou. »<i></i></b></div><div class="row"><small>Tes tresses ?</small><b>« Pas pro. »<i></i></b></div></div></div>
<div id="s2" class="sc"><div class="pic" style="inset:0;border-radius:0"><img src="photos/b10.jpg" style="object-position:45% 40%"></div><div class="layer" style="background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.1) 45%,rgba(0,0,0,.8))"></div>
 <div class="cap" id="c2a" style="top:1240px">{sp("Un cheveu crépu")}<br>{sp("n'est pas un cheveu sale.")}</div>
 <div class="cap" id="c2b" style="top:1290px"><em>{sp("Il pousse vers le ciel.")}</em></div></div>
<div id="s3" class="sc">{grid}<div class="layer" style="background:linear-gradient(180deg,transparent 55%,rgba(11,9,8,.95) 85%)"></div>
 <div class="cap" style="top:1480px;font-size:70px">{sp("De l'eau, de l'huile, du temps…")}<br><em>{sp("et du savoir-faire.")}</em></div></div>
<div id="s4" class="sc"><div class="big" style="top:560px;font-size:120px;line-height:1.08">{sp("Propre,")}<br>{sp("c'est un cheveu")}<br><span class="gold">{sp("entretenu.")}</span></div>
 <div class="gline" style="top:1040px"></div><div class="q" style="top:1100px;font-size:84px">{sp("Pas un cheveu caché.")}</div></div>
<div id="s5" class="sc"><div class="q" style="top:560px;font-size:76px;font-style:normal;font-family:Bodoni">{sp("Nos cheveux ne sont pas")}<br>{sp("un problème à régler.")}</div>
 <div class="big" style="top:900px;font-size:150px;font-style:italic"><span class="gold">{sp("Ce sont")}<br>{sp("nos racines.")}</span></div>
 <div class="tag">#FiersDeNosCheveux</div><div class="brand">Kadio Coiffure · Longueuil</div></div>
<div class="layer vig"></div>"""
    js = """
const S = [[0, 3.4], [3.4, 9.0], [9.0, 14.6], [14.6, 21.0], [21.0, 26.0], [26.0, 31.5]];
S.forEach(function (s, i) { show("#s" + i, s[0], s[1]); if (i) fin("#s" + i, s[0], .5, { opacity: 0 }, { opacity: 1, ease: "sine.inOut" }); });
// 0
fin("#s0 .big .ch", .3, .6, { opacity: 0, y: 60, filter: "blur(12px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .07, ease: "power3.out" }); cue(.3, "bass.wav", .45);
fin("#s0 .q .w", 1.5, .5, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .08 }); cue(1.5, "type-click.wav", .2);
// 1 : préjugés barrés
kb("#s1 .bgph", 3.4, 6, { scale: 1.25 }, { scale: 1.1 });
document.querySelectorAll("#s1 .row").forEach(function (r, k) { const t = 3.8 + k * 1.55;
  fin(r, t, .5, { opacity: 0, x: -60 }, { opacity: 1, x: 0, ease: "power3.out" }); cue(t, "whoosh-fast.wav", .25);
  fin(r.querySelector("i"), t + .8, .35, { scaleX: 0 }, { scaleX: 1, ease: "power3.in" }); cue(t + .95, "cut_hit_sub.wav", .4); });
tl.to("#s1 .row b", { opacity: .35, duration: .5 }, 8.4);
// 2 : afro
kb("#s2 img", 9.0, 6, { scale: 1.2, y: 40 }, { scale: 1.04, y: 0 });
show("#c2a", 9.4, 11.9); fin("#c2a .w", 9.4, .6, { opacity: 0, y: 30, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .09 }); cue(9.4, "sparkle.wav", .2);
tl.to("#c2a", { opacity: 0, duration: .4 }, 11.5);
show("#c2b", 12.0, null); fin("#c2b .ch", 12.0, .6, { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: .035, ease: "back.out(2)" }); cue(12.0, "woosh-air.wav", .3);
// 3 : textures
document.querySelectorAll("#s3 .g").forEach(function (g, k) { const t = 14.7 + k * .22;
  fin(g, t, .5, { scale: 0, rotate: k %% 2 ? 6 : -6 }, { scale: 1, rotate: 0, ease: "back.out(1.6)" }); cue(t, "pop-bubble.wav", .15);
  kb(g.querySelector("img"), t, 6.5, { scale: 1.2 }, { scale: 1.02 }); });
fin("#s3 .cap .w", 16.4, .5, { opacity: 0, y: 24 }, { opacity: 1, y: 0, stagger: .1, ease: "power3.out" });
// 4
fin("#s4 .big .w", 21.3, .6, { opacity: 0, y: 50, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .14, ease: "power3.out" }); cue(21.3, "bass.wav", .4);
fin("#s4 .gline", 23.2, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
fin("#s4 .q .w", 23.5, .6, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .12 }); cue(23.5, "sparkle.wav", .25);
// 5 : signature
fin("#s5 .q .w", 26.3, .5, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .08 });
fin("#s5 .big .ch", 27.6, .6, { opacity: 0, y: 50, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .04, ease: "power3.out" }); cue(27.6, "bass.wav", .45);
fin("#s5 .tag", 29.0, .5, { opacity: 0, letterSpacing: ".5em" }, { opacity: 1, letterSpacing: ".12em", ease: "expo.out" }); cue(29.0, "chime.wav", .3);
fin("#s5 .brand", 29.4, .6, { opacity: 0 }, { opacity: .8 });
""" % ()
    open(os.path.join(D, "index.html"), "w").write(page("Fiers de nos cheveux 1", css, body, js, T, ("m657", 0)))
elif F in ("fiers1v", "fiers1c"):
    CH = F == "fiers1c"
    import soundfile as sf
    VO = json.load(open(os.path.join(R, "vo", "spec.json")))["fiers1"]["vo"]
    LEAD, TAIL = .25, .35; SCH, t = [], 0.0
    for i in range(len(VO)):
        src = os.path.join(R, "vo", f"fiers1_{i}.wav"); shutil.copy(src, os.path.join(D, f"fiers1_{i}.wav"))
        d = sf.info(src).duration; dur = LEAD + d + TAIL + (2.6 if i == len(VO) - 1 else 0); SCH.append((round(t, 2), round(dur, 2))); t += dur
    T = round(t, 2)
    json.dump([{"t": round(a + LEAD, 2), "file": f"fiers1_{i}.wav"} for i, (a, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
    subt = lambda x: x.replace("Kadyo", "Kadio")
    css = """
:root { --bg: #0b0908; --fg: #f4ece0; --gold: #d9b26f; --red: #e0473a; }
#root { background: var(--bg); color: var(--fg); }
.sc { position: absolute; inset: 0; visibility: hidden; }
.bgph { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(26px) brightness(.28) saturate(.7); transform: scale(1.15); }
.big { position: absolute; left: 70px; right: 70px; text-align: center; font: 400 170px/1 Bodoni; white-space: nowrap; }
.q { position: absolute; left: 80px; right: 80px; text-align: center; font: italic 300 64px/1.2 Corm; }
.rows { position: absolute; left: 80px; right: 80px; top: 380px; display: flex; flex-direction: column; gap: 80px; }
.row small { display: block; font: 800 38px Outfit; letter-spacing: .3em; text-transform: uppercase; color: var(--gold); }
.row b { position: relative; display: inline-block; margin-top: 12px; font: italic 400 130px/1 Bodoni; }
.row b i { position: absolute; left: -12px; right: -12px; top: 52%; height: 14px; background: var(--red); transform-origin: 0 50%; border-radius: 7px; }
.pic { position: absolute; overflow: hidden; border-radius: 30px; }
.pic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; }
.lab { position: absolute; left: 22px; bottom: 22px; padding: 10px 24px; border-radius: 999px; background: rgba(11,9,8,.75); font: 800 30px Outfit; letter-spacing: .15em; text-transform: uppercase; color: var(--gold); }
.key { position: absolute; left: 80px; right: 80px; top: 230px; text-align: center; font: 400 96px/1.05 Bodoni; text-shadow: 0 8px 40px rgba(0,0,0,.8); }
.key em { font-style: italic; color: var(--gold); }
.gold { color: var(--gold); }
.chips { position: absolute; left: 60px; right: 60px; top: 1180px; display: flex; flex-wrap: wrap; justify-content: center; gap: 22px; }
.chip { padding: 20px 38px; border-radius: 999px; border: 3px solid var(--gold); font: 800 44px Outfit; color: var(--fg); background: rgba(11,9,8,.7); }
.spiral { position: absolute; left: 240px; top: 470px; width: 600px; height: 760px; overflow: visible; }
.spiral path { fill: none; stroke: var(--gold); stroke-width: 16; stroke-linecap: round; }
.drop { position: absolute; width: 46px; height: 60px; background: #f4ece0; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; }
.eq { position: absolute; left: 0; right: 0; top: 1300px; text-align: center; font: 900 92px Outfit; }
.eq .neq { color: var(--red); } .eq b { color: var(--gold); }
.sub { position: absolute; left: 70px; right: 70px; top: 1610px; text-align: center; visibility: hidden; z-index: 30; }
.sub span { display: inline; padding: 8px 16px; line-height: 1.5; background: rgba(0,0,0,.66); color: #fff; font: 700 40px Outfit; border-radius: 12px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.tag { position: absolute; left: 0; right: 0; top: 1380px; text-align: center; font: 900 46px Outfit; letter-spacing: .12em; color: var(--gold); }
.brand { position: absolute; left: 0; right: 0; top: 1470px; text-align: center; font: 500 34px Corm; letter-spacing: .5em; text-indent: .5em; text-transform: uppercase; opacity: .8; }
.gline { position: absolute; left: 440px; width: 200px; height: 3px; background: var(--gold); }
"""
    TX = [("h_locks", "Locks"), ("h_twists", "Twists"), ("bt2", "Barrel twist"), ("l2", "Afro"), ("h_nattes", "Tresses"), ("l3", "Locks")]
    grid = "".join(f'<div class="pic g" style="left:{50 + (k % 2) * 500}px;top:{170 + (k // 2) * 470}px;width:480px;height:450px"><img src="photos/{n}.jpg"><span class="lab">{e(l)}</span></div>' for k, (n, l) in enumerate(TX))
    spiral = "M300 740 " + " ".join(f"Q{300 + (200 if k % 2 else -200) * (1 - k / 20):.0f} {740 - k * 50 - 25} {300} {740 - (k + 1) * 50}" for k in range(14))
    body = f"""
<div id="s0" class="sc"><div class="big" style="top:640px">{sp("PROPRE ?")}</div><div class="q" style="top:900px">{sp("Les cheveux courts, c'est plus propre ?")}</div></div>
<div id="s1" class="sc"><img class="bgph" src="photos/l2.jpg">
 <div class="rows"><div class="row"><small>L'afro ?</small><b>« Négligé. »<i></i></b></div><div class="row"><small>Les locks ?</small><b>« Voyou. »<i></i></b></div><div class="row"><small>Les tresses ?</small><b>« Pas pro. »<i></i></b></div></div></div>
<div id="s2" class="sc"><div class="pic" style="inset:0;border-radius:0"><img src="photos/b10.jpg" style="object-position:45% 40%"></div><div class="layer" style="background:linear-gradient(180deg,rgba(0,0,0,.75),rgba(0,0,0,0) 35%,rgba(0,0,0,0) 70%,rgba(0,0,0,.6))"></div>
 <div class="key">{sp("Pas sale.")}<br><em>{sp("Différent.")}</em></div></div>
<div id="s3" class="sc"><div class="key" style="top:200px;font-size:80px">{sp("Il pousse en spirale")}</div>
 <svg class="spiral" viewBox="0 0 600 760"><path d="{spiral}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>
 <i class="drop d1" style="left:520px;top:450px"></i><i class="drop d2" style="left:560px;top:500px"></i>
 <div class="eq">{sp("Plus sec")} <span class="neq">≠</span> <b>{sp("plus sale")}</b></div></div>
<div id="s4" class="sc">{grid}</div>
<div id="s5" class="sc"><div class="pic" style="inset:0;border-radius:0"><img src="photos/h_locks.jpg"></div><div class="layer" style="background:rgba(0,0,0,.45)"></div>
 <div class="chips"><span class="chip">Lavées</span><span class="chip">Entretenues</span><span class="chip">Des heures de précision</span></div></div>
<div id="s6" class="sc"><div class="big" style="top:500px;font-size:118px;line-height:1.08;white-space:normal">{sp("Propre,")}<br>{sp("c'est un cheveu")}<br><span class="gold">{sp("entretenu.")}</span></div>
 <div class="gline" style="top:980px"></div><div class="q" style="top:1040px;font-size:84px">{sp("Pas un cheveu caché.")}</div></div>
<div id="s7" class="sc"><div class="q" style="top:420px;font-size:76px;font-style:normal;font-family:Bodoni">{sp("Nos cheveux ne sont pas")}<br>{sp("un problème à régler.")}</div>
 <div class="big" style="top:760px;font-size:150px;font-style:italic;line-height:1.02"><span class="gold">{sp("Ce sont")}<br>{sp("nos racines.")}</span></div>
 <div class="tag">#FiersDeNosCheveux</div><div class="brand">Kadio Coiffure · Longueuil</div></div>
{"".join(f'<div class="sub" id="u{i}"><span>{e(subt(v))}</span></div>' for i, v in enumerate(VO))}
<div class="layer vig"></div>""" + (CHAR_SVG if CH else "")
    MOUTH = []
    if CH:
        import numpy as np
        for i in range(len(VO)):
            a, sr = sf.read(os.path.join(R, "vo", f"fiers1_{i}.wav"), always_2d=True); a = a.mean(1); hop = sr // 15
            env = np.array([np.sqrt(np.mean(a[k:k + hop] ** 2)) for k in range(0, len(a) - hop, hop)])
            env = np.clip(env / (np.percentile(env, 95) + 1e-9), 0, 1)
            for k, v in enumerate(env): MOUTH.append([round(SCH[i][0] + LEAD + k / 15, 3), round(float(v), 2)])
    js = """
const MOUTH = %s;
const S = %s, L = %s;
const A = (i) => S[i][0], E = (i) => S[i][0] + S[i][1];
S.forEach(function (s, i) { show("#s" + i, s[0], i === S.length - 1 ? null : s[0] + s[1]); if (i) fin("#s" + i, s[0], .45, { opacity: 0 }, { opacity: 1, ease: "sine.inOut" }); show("#u" + i, s[0] + L, s[0] + s[1] - .05); fin("#u" + i, s[0] + L, .25, { opacity: 0 }, { opacity: 1 }); });
S.forEach(function (s, i) { if (i) cue(s[0] - .1, i %% 2 ? "woosh-air.wav" : "sweep-small.wav", .2); });
// 0
fin("#s0 .big .ch", .2, .6, { opacity: 0, y: 60, filter: "blur(12px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .07, ease: "power3.out" }); cue(.2, "bass.wav", .4);
fin("#s0 .q .w", 1.2, .5, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .08 });
// 1 : préjugés barrés au rythme de la voix
kb("#s1 .bgph", A(1), S[1][1], { scale: 1.25 }, { scale: 1.1 });
document.querySelectorAll("#s1 .row").forEach(function (r, k) { const t = A(1) + L + k * (S[1][1] - .8) / 3;
  fin(r, t, .45, { opacity: 0, x: -60 }, { opacity: 1, x: 0, ease: "power3.out" });
  fin(r.querySelector("i"), t + .7, .3, { scaleX: 0 }, { scaleX: 1, ease: "power3.in" }); cue(t + .85, "cut_hit_sub.wav", .35); });
// 2
kb("#s2 img", A(2), S[2][1] + .5, { scale: 1.2, y: 40 }, { scale: 1.04, y: 0 });
fin("#s2 .key .w", A(2) + .6, .6, { opacity: 0, y: 30, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .25 }); cue(A(2) + .6, "sparkle.wav", .2);
// 3 : spirale + gouttes qui glissent mal
fin("#s3 .key .w", A(3) + .2, .5, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .08 });
fin("#s3 .spiral path", A(3) + .4, Math.min(3, S[3][1] * .45), { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power1.inOut" }); cue(A(3) + .4, "swoosh-wind.wav", .25);
[".d1", ".d2"].forEach(function (d, k) { fin("#s3 " + d, A(3) + 1.2 + k * .5, 1.6, { y: -40, opacity: 0 }, { y: 140, opacity: 1, ease: "power2.in" }); tl.to("#s3 " + d, { opacity: 0, duration: .4 }, A(3) + 3 + k * .5); });
fin("#s3 .eq .w, #s3 .eq .neq", A(3) + S[3][1] * .55, .5, { opacity: 0, scale: .6 }, { opacity: 1, scale: 1, stagger: .15, ease: "back.out(2)" }); cue(A(3) + S[3][1] * .55, "pop-hard.wav", .3);
// 4 : textures
document.querySelectorAll("#s4 .g").forEach(function (g, k) { const t = A(4) + .1 + k * .2;
  fin(g, t, .5, { scale: 0, rotate: k %% 2 ? 6 : -6 }, { scale: 1, rotate: 0, ease: "back.out(1.6)" }); cue(t, "pop-bubble.wav", .12);
  kb(g.querySelector("img"), t, S[4][1] + .5, { scale: 1.2 }, { scale: 1.02 }); });
// 5 : locks et tresses
kb("#s5 img", A(5), S[5][1] + .5, { scale: 1.2 }, { scale: 1.05 });
document.querySelectorAll("#s5 .chip").forEach(function (c, k) { const t = A(5) + .5 + k * (S[5][1] - 1) / 3; fin(c, t, .45, { scale: 0 }, { scale: 1, ease: "back.out(2.5)" }); cue(t, "click.wav", .3); });
// 6
fin("#s6 .big .w", A(6) + .2, .6, { opacity: 0, y: 50, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .12, ease: "power3.out" }); cue(A(6) + .2, "bass.wav", .35);
fin("#s6 .gline", A(6) + S[6][1] * .5, .6, { scaleX: 0 }, { scaleX: 1, ease: "expo.out" });
fin("#s6 .q .w", A(6) + S[6][1] * .55, .5, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .1 });
// 7
fin("#s7 .q .w", A(7) + .2, .5, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .07 });
fin("#s7 .big .ch", A(7) + S[7][1] * .35, .6, { opacity: 0, y: 50, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .04, ease: "power3.out" }); cue(A(7) + S[7][1] * .35, "bass.wav", .4);
fin("#s7 .tag", E(7) - 2.6, .5, { opacity: 0, letterSpacing: ".5em" }, { opacity: 1, letterSpacing: ".12em", ease: "expo.out" }); cue(E(7) - 2.6, "chime.wav", .3);
fin("#s7 .brand", E(7) - 2.2, .6, { opacity: 0 }, { opacity: .8 });
""" % (json.dumps(MOUTH), json.dumps(SCH), LEAD) + (CHAR_JS if CH else "")
    if CH: css += CHAR_CSS
    open(os.path.join(D, "index.html"), "w").write(page("Fiers de nos cheveux 1", css, body, js, T, ("m657", 0)))
elif F == "fiers2":
    import soundfile as sf, numpy as np
    VO = json.load(open(os.path.join(R, "vo", "spec.json")))["fiers2"]["vo"]
    LEAD, TAIL = .25, .35; SCH, t = [], 0.0
    for i in range(len(VO)):
        src = os.path.join(R, "vo", f"fiers2_{i}.wav"); shutil.copy(src, os.path.join(D, f"fiers2_{i}.wav"))
        d = sf.info(src).duration; dur = LEAD + d + TAIL + (2.6 if i == len(VO) - 1 else 0); SCH.append((round(t, 2), round(dur, 2))); t += dur
    T = round(t, 2)
    json.dump([{"t": round(a + LEAD, 2), "file": f"fiers2_{i}.wav"} for i, (a, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
    MOUTH = []
    for i in range(len(VO)):
        a, sr = sf.read(os.path.join(R, "vo", f"fiers2_{i}.wav"), always_2d=True); a = a.mean(1); hop = sr // 15
        env = np.array([np.sqrt(np.mean(a[k:k + hop] ** 2)) for k in range(0, len(a) - hop, hop)]); env = np.clip(env / (np.percentile(env, 95) + 1e-9), 0, 1)
        MOUTH += [[round(SCH[i][0] + LEAD + k / 15, 3), round(float(v), 2)] for k, v in enumerate(env)]
    subt = lambda x: x.replace("Kadyo", "Kadio").replace("loks", "locks")
    css = CHAR_CSS + F2_CSS
    Q = {1: ("Mythe n°1", "« Les cheveux afro sont sales. »"), 3: ("Mythe n°2", "« Les locks, ce sont des cheveux pas lavés. »"),
         5: ("Mythe n°3", "« Le cheveu crépu est fragile. »"), 7: ("Mythe n°4", "« Couper court, c'est plus pro. »")}
    spath = "M400 880 " + " ".join(f"Q{400 + (300 if k % 2 else -300) * (1 - k / 16):.0f} {880 - k * 60 - 30} 400 {880 - (k + 1) * 60}" for k in range(13))
    weak = "".join(f'<circle cx="{400 + (300 if k % 2 else -300) * (1 - k / 16) * .5:.0f}" cy="{880 - k * 60 - 30}" r="22"/>' for k in range(1, 12, 2))
    sc = ['<div id="s0" class="sc"><div class="ttl"><span class="pill m">MYTHE</span><span class="ou">ou</span><span class="pill v">VÉRITÉ ?</span><small>Les cheveux afro</small></div></div>']
    for i in (1, 3, 5, 7):
        sc.append(f'<div id="s{i}" class="sc"><div class="dots">' + "<i></i>" * 4 + f'</div><div class="card"><div class="in"><small>{Q[i][0]}</small><b>{sp(Q[i][1])}</b><span class="qm">?</span></div></div></div>')
    sc.append('<div id="s2" class="sc"><div class="vph"><img src="photos/l2.jpg"></div><div class="stamp f"><span>FAUX</span></div>'
              '<div class="bars"><div class="bar"><small>Besoin d\'hydratation</small><i style="width:100%"></i></div><div class="bar lo"><small>Sébum qui descend</small><i style="width:35%"></i></div></div></div>')
    sc.append('<div id="s4" class="sc"><div class="vph"><img src="photos/h_locks.jpg"></div><div class="stamp f"><span>FAUX</span></div><div class="chips"><span class="chip">1 · Lavées</span><span class="chip">2 · Séchées</span><span class="chip">3 · Retwist</span></div></div>')
    sc.append(f'<div id="s6" class="sc"><div class="stamp t" style="top:120px"><span>VRAI</span></div><svg class="spi" viewBox="0 0 800 900"><path d="{spath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>{weak}</svg><div class="chips" style="top:1200px"><span class="chip">Douceur</span><span class="chip">Bonnes mains</span></div></div>')
    sc.append('<div id="s8" class="sc"><div class="vph"><img src="photos/l3.jpg"></div><div class="stamp f"><span>FAUX</span></div><div class="chips"><span class="chip">Ton travail</span><span class="chip">Ton attitude</span><span class="chip x">La texture</span></div></div>')
    sc.append(f'<div id="s9" class="sc"><div class="end"><h1>{sp("Ton cheveu")}<br>{sp("n’a rien")}<br><em>{sp("à corriger.")}</em></h1><div class="tag">#FiersDeNosCheveux</div><div class="br">Kadio Coiffure · Longueuil</div></div></div>')
    subs = "".join(f'<div class="sub" id="u{i}"><span>{e(subt(v))}</span></div>' for i, v in enumerate(VO))
    body = "".join(sc) + subs + '<div class="layer vig"></div>' + CHAR_SVG
    js = ("const MOUTH = " + json.dumps(MOUTH) + ";\nconst S = " + json.dumps(SCH) + ", L = " + str(LEAD) + ";\n" + F2_JS
          + CHAR_JS.replace("if (i === 2 || i === 3 || i === 6)", "if (i === 2 || i === 4 || i === 6 || i === 8)"))
    open(os.path.join(D, "index.html"), "w").write(page("Fiers de nos cheveux 2", css, body, js, T, ("m1000", 30)))
elif F == "fiers2a":
    import soundfile as sf, numpy as np
    VO = json.load(open(os.path.join(R, "vo", "spec.json")))["fiers2"]["vo"]
    LEAD, TAIL = .3, .45; SCH, t = [], 0.0
    for i in range(len(VO)):
        src = os.path.join(R, "vo", f"fiers2_{i}.wav"); shutil.copy(src, os.path.join(D, f"fiers2_{i}.wav"))
        d = sf.info(src).duration; dur = LEAD + d + TAIL + (2.6 if i == len(VO) - 1 else 0); SCH.append((round(t, 2), round(dur, 2))); t += dur
    T = round(t, 2)
    json.dump([{"t": round(a + LEAD, 2), "file": f"fiers2_{i}.wav"} for i, (a, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
    MOUTH = []
    for i in range(len(VO)):
        a, sr = sf.read(os.path.join(R, "vo", f"fiers2_{i}.wav"), always_2d=True); a = a.mean(1); hop = sr // 15
        env = np.array([np.sqrt(np.mean(a[k:k + hop] ** 2)) for k in range(0, len(a) - hop, hop)]); env = np.clip(env / (np.percentile(env, 95) + 1e-9), 0, 1)
        MOUTH += [[round(SCH[i][0] + LEAD + k / 15, 3), round(float(v), 2)] for k, v in enumerate(env)]
    subt = lambda x: x.replace("Kadyo", "Kadio").replace("loks", "locks")
    BG = ["#cdbdff", "#ffd3a8", "#ffe38f", "#a9e8cf", "#b6d6ff", "#ffc6d9", "#ffcfae", "#b3eee0", "#d6c9ff", "#ffe6a1"]
    css = """
@font-face { font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }
@font-face { font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }
#root { background: #cdbdff; color: #1d1d1f; font-family: ID; }
.sc { position: absolute; inset: 0; visibility: hidden; }
.ey { position: absolute; left: 90px; top: 210px; font: 700 40px ID; color: rgba(29,29,31,.55); letter-spacing: -.005em; }
.h { position: absolute; left: 90px; right: 90px; top: 270px; font: 700 132px/1.0 ID; letter-spacing: -.045em; }
.h .m { color: rgba(29,29,31,.45); }
.qt { position: absolute; left: 90px; right: 90px; top: 560px; font: 700 118px/1.04 ID; letter-spacing: -.04em; }
.qt .m { color: rgba(29,29,31,.45); }
.card { position: absolute; left: 90px; right: 90px; top: 560px; height: 820px; border-radius: 52px; overflow: hidden; background: #fff; box-shadow: 0 40px 90px rgba(29,29,31,.16); }
.card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; }
.kv { position: absolute; left: 90px; right: 420px; top: 1450px; display: flex; gap: 56px; }
.kv div b { display: block; font: 700 72px/1 ID; letter-spacing: -.04em; }
.kv div small { display: block; margin-top: 10px; font: 700 30px ID; color: rgba(29,29,31,.55); }
.kv .x b { text-decoration: line-through; text-decoration-thickness: 6px; color: rgba(29,29,31,.4); }
.spi { position: absolute; left: 190px; top: 560px; width: 700px; height: 820px; overflow: visible; }
.spi path { fill: none; stroke: #1d1d1f; stroke-width: 14; stroke-linecap: round; }
.spi circle { fill: #fff; stroke: #1d1d1f; stroke-width: 8; }
.prog { position: absolute; left: 90px; top: 150px; display: flex; gap: 12px; }
.prog i { width: 64px; height: 8px; border-radius: 4px; background: rgba(29,29,31,.15); }
.prog i.on { background: #1d1d1f; }
.end { position: absolute; left: 90px; right: 90px; top: 420px; }
.end h1 { font: 700 136px/1.0 ID; letter-spacing: -.045em; } .end h1 .m { color: rgba(29,29,31,.45); }
.end .tag { margin-top: 80px; font: 700 48px ID; letter-spacing: -.01em; }
.end .br { margin-top: 16px; font: 700 34px ID; color: rgba(29,29,31,.55); }
.sub { position: absolute; left: 90px; right: 400px; top: 1640px; visibility: hidden; z-index: 30; font: 700 36px/1.3 ID; color: rgba(29,29,31,.75); letter-spacing: -.01em; }
.kb { position: absolute; right: 60px; bottom: 70px; width: 290px; height: 290px; border-radius: 50%; overflow: hidden; background: #fff; box-shadow: 0 30px 70px rgba(29,29,31,.2); z-index: 40; }
.kb #kadi { position: absolute; left: -42px; top: -8px; right: auto; bottom: auto; width: 374px; height: 486px; }
"""
    def prog(k):
        return '<div class="prog">' + "".join(f'<i class="{"on" if j <= k else ""}"></i>' for j in range(4)) + "</div>"
    Q = {1: (0, "Les cheveux afro", "sont sales."), 3: (1, "Les locks, des cheveux", "pas lavés."), 5: (2, "Le cheveu crépu", "est fragile."), 7: (3, "Couper court,", "c'est plus pro.")}
    V = {2: ("Faux.", "Plus sec, pas plus sale.", "l2", [("+ sec", "pas + sale"), ("H₂O", "son vrai besoin")]),
         4: ("Faux.", "Lavées, séchées, entretenues.", "h_locks", [("Lavées", "régulièrement"), ("Retwist", "entretien")]),
         8: ("Faux.", "Le pro, c'est le travail.", "l3", [("Travail", "✓"), ("Attitude", "✓"), ("Texture", "")])}
    spath = "M350 800 " + " ".join(f"Q{350 + (260 if k % 2 else -260) * (1 - k / 16):.0f} {800 - k * 56 - 28} 350 {800 - (k + 1) * 56}" for k in range(13))
    weak = "".join(f'<circle cx="{350 + (260 if k % 2 else -260) * (1 - k / 16) * .5:.0f}" cy="{800 - k * 56 - 28}" r="18"/>' for k in range(1, 12, 2))
    sc = [f'<div id="s0" class="sc"><div class="ey" style="top:560px">Les cheveux afro</div><div class="h" style="top:630px;font-size:170px">{sp("Mythe")}<br><span class="m">{sp("ou vérité ?")}</span></div></div>']
    for i, (k, a1, a2) in Q.items():
        sc.append(f'<div id="s{i}" class="sc">{prog(k)}<div class="ey">Mythe n°{k + 1} sur 4</div><div class="qt">« {sp(a1)} <span class="m">{sp(a2)}</span> »</div></div>')
    for i, (h, sub, img, kv) in V.items():
        k = (i - 2) // 2
        kvh = "".join(f'<div class="{"x" if not s else ""}"><b>{e(b)}</b><small>{e(s)}</small></div>' for b, s in kv)
        sc.append(f'<div id="s{i}" class="sc">{prog(k)}<div class="ey">{e(sub)}</div><div class="h">{sp(h)}</div><div class="card"><img src="photos/{img}.jpg"></div><div class="kv">{kvh}</div></div>')
    sc.append(f'<div id="s6" class="sc">{prog(2)}<div class="ey">Chaque courbe est un point fragile.</div><div class="h">{sp("Vrai.")}</div><svg class="spi" viewBox="0 0 700 820"><path d="{spath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>{weak}</svg><div class="kv"><div><b>Douceur</b><small>toujours</small></div><div><b>Expertise</b><small>les bonnes mains</small></div></div></div>')
    sc.append(f'<div id="s9" class="sc"><div class="end"><h1>{sp("Ton cheveu")}<br>{sp("n’a rien")}<br><span class="m">{sp("à corriger.")}</span></h1><div class="tag">#FiersDeNosCheveux</div><div class="br">Kadio Coiffure · Longueuil</div></div></div>')
    subs = "".join(f'<div class="sub" id="u{i}">{e(subt(v))}</div>' for i, v in enumerate(VO))
    body = "".join(sc) + subs + '<div class="kb">' + CHAR_SVG + "</div>"
    js = ("const MOUTH = " + json.dumps(MOUTH) + ";\nconst S = " + json.dumps(SCH) + ", L = " + str(LEAD) + ", BG = " + json.dumps(BG) + ";\n" + """
const _ex = (q) => typeof q !== "string" || document.querySelector(q);
const _fin = fin, _kb = kb; fin = function (q, ...r) { if (_ex(q)) _fin(q, ...r); }; kb = function (q, ...r) { if (_ex(q)) _kb(q, ...r); };
const A = (i) => S[i][0], E = (i) => S[i][0] + S[i][1];
tl.set("#root", { backgroundColor: BG[0] }, 0);
S.forEach(function (s, i) {
  show("#s" + i, s[0], i === S.length - 1 ? null : s[0] + s[1]);
  if (i) tl.to("#root", { backgroundColor: BG[i], duration: .7, ease: "power2.inOut" }, s[0] - .2);
  fin("#s" + i + " .ey", s[0] + .1, .8, { opacity: 0, y: 24 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin("#s" + i + " .h .w, #s" + i + " .qt .w", s[0] + .2, .9, { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: .06, ease: "power3.out" });
  fin("#s" + i + " .card", s[0] + .35, 1, { opacity: 0, y: 80, scale: .96 }, { opacity: 1, y: 0, scale: 1, ease: "power3.out" });
  kb("#s" + i + " .card img", s[0] + .35, s[1] + .5, { scale: 1.12 }, { scale: 1.02 });
  document.querySelectorAll("#s" + i + " .kv > div").forEach(function (d, k) { fin(d, s[0] + 1.2 + k * .35, .8, { opacity: 0, y: 30 }, { opacity: 1, y: 0, ease: "power3.out" }); });
  fin("#s" + i + " .prog i.on:last-of-type", s[0] + .3, .6, { scaleX: 0, transformOrigin: "0 50%" }, { scaleX: 1, ease: "power3.out" });
  show("#u" + i, s[0] + L, s[0] + s[1] - .05); fin("#u" + i, s[0] + L, .4, { opacity: 0 }, { opacity: 1 });
  if (i < S.length - 1) tl.to("#s" + i + " .ey, #s" + i + " .h, #s" + i + " .qt, #s" + i + " .card, #s" + i + " .kv, #s" + i + " .spi", { opacity: 0, duration: .35, ease: "power2.in" }, s[0] + s[1] - .35);
  if (i) cue(s[0] - .15, "woosh-air.wav", .12);
});
fin("#s6 .spi path", A(6) + .4, 2.2, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power2.inOut" });
fin("#s6 .spi circle", A(6) + 2.4, .5, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, stagger: .12, ease: "power3.out" });
fin(".end .tag", E(9) - 3, .8, { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: "power3.out" }); cue(E(9) - 3, "chime.wav", .25);
fin(".end .br", E(9) - 2.6, .8, { opacity: 0 }, { opacity: 1 });
fin(".kb", .3, 1, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, ease: "power3.out" });
""" + CHAR_JS.split("// Kadi : entrée, bouche, clignements, mouvements")[1].replace('fin("#kadi", .3, .7, { y: 560 }, { y: 0, ease: "back.out(1.4)" }); cue(.3, "pop-long.wav", .2);', "")
          .replace("if (i === 2 || i === 3 || i === 6)", "if (i === 2 || i === 4 || i === 6 || i === 8)"))
    open(os.path.join(D, "index.html"), "w").write(page("Mythe ou vérité", css, body, js, T, ("m657", 20)))
elif F in ("papier1", "papier2"):
    import soundfile as sf, numpy as np, random, re as _re
    KEY = "fiers1" if F == "papier1" else "fiers2"
    VO = json.load(open(os.path.join(R, "vo", "spec.json")))[KEY]["vo"]
    LEAD, TAIL = .3, .45; SCH, t = [], 0.0
    for i in range(len(VO)):
        src = os.path.join(R, "vo", f"{KEY}_{i}.wav"); shutil.copy(src, os.path.join(D, f"{KEY}_{i}.wav"))
        d = sf.info(src).duration; dur = LEAD + d + TAIL + (2.8 if i == len(VO) - 1 else 0); SCH.append((round(t, 2), round(dur, 2))); t += dur
    T = round(t, 2)
    json.dump([{"t": round(a + LEAD, 2), "file": f"{KEY}_{i}.wav"} for i, (a, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
    MOUTH = []
    for i in range(len(VO)):
        a, sr = sf.read(os.path.join(R, "vo", f"{KEY}_{i}.wav"), always_2d=True); a = a.mean(1); hop = sr // 15
        env = np.array([np.sqrt(np.mean(a[k:k + hop] ** 2)) for k in range(0, len(a) - hop, hop)]); env = np.clip(env / (np.percentile(env, 95) + 1e-9), 0, 1)
        MOUTH += [[round(SCH[i][0] + LEAD + k / 15, 3), round(float(v), 2)] for k, v in enumerate(env)]
    subt = lambda x: x.replace("Kadyo", "Kadio").replace("loks", "locks").replace("vwa-you", "voyou")
    PAPERS = ["#f7e6c8", "#f9d4bd", "#f1e7b8", "#d6ead2", "#f8d2cb", "#f5deae", "#cfe6e2", "#f7d9c6", "#e6dcf0", "#f7e6c8"]
    if KEY == "fiers2":
        SC = [dict(ey="Fiers de nos cheveux · Épisode 2", ti="Mythe *ou vérité ?*", circle=True),
              dict(ey="Mythe n°1", ti="« Les cheveux afro sont *sales.* »", ph="b10"),
              dict(ey="Verdict", ti="*Faux.*", ph="l2", note="Plus sec, pas plus sale :<br>le sébum descend mal le long des boucles."),
              dict(ey="Mythe n°2", ti="« Les locks, des cheveux *pas lavés.* »", ph="l3"),
              dict(ey="Verdict", ti="*Faux.*", ph="h_locks", note="Lavées, bien séchées,<br>entretenues par un retwist régulier."),
              dict(ey="Mythe n°3", ti="« Le cheveu crépu est *fragile.* »", ph="bt2"),
              dict(ey="Verdict", ti="*Vrai.*", spiral=True, note="Chaque courbe est un point fragile :<br>douceur et bonnes mains."),
              dict(ey="Mythe n°4", ti="« Couper court, c'est *plus pro.* »", ph="l4"),
              dict(ey="Verdict", ti="*Faux.*", ph="h_nattes", note="Le pro, c'est ton travail et ton attitude.<br>Pas la texture de tes cheveux."),
              dict(ey="Fiers de nos cheveux", ti="Ton cheveu n'a rien *à corriger.*", end=True)]
        GEST = [2, 4, 6, 8]
    else:
        SC = [dict(ey="Fiers de nos cheveux · Épisode 1", ti="*Propre ?*", note="Les cheveux courts, c'est plus propre ?", circle=True),
              dict(ey="Ce qu'on entend", strikes=["L'afro ? « Négligé. »", "Les locks ? « Voyou. »", "Les tresses ? « Pas pro. »"]),
              dict(ey="Pourtant", ti="Pas sale. *Différent.*", ph="b10", note="Il pousse en spirale, vers le ciel."),
              dict(ey="L'explication", ti="Plus sec ≠ *plus sale.*", spiral=True, note="Le sébum descend mal<br>le long de la mèche."),
              dict(ey="Ce qu'il lui faut", ti="Eau, huile, temps… *savoir-faire.*", phs=["h_twists", "bt2", "h_nattes"]),
              dict(ey="Locks et tresses", ti="Lavées. Entretenues. *Précises.*", ph="h_locks"),
              dict(ey="Alors", ti="Propre, c'est un cheveu *entretenu.*", ph="l3", note="Pas un cheveu caché."),
              dict(ey="Fiers de nos cheveux", ti="Ce sont *nos racines.*", end=True)]
        GEST = [2, 3, 6]
    random.seed(11)
    def torn(top_only=False, n=34, amp=2.2):
        top = [f"{k * 100 / n:.1f}% {random.uniform(0, amp):.2f}%" for k in range(n + 1)]
        if top_only: return "polygon(" + ",".join(top + ["100% 100%", "0% 100%"]) + ")"
        rgt = [f"{random.uniform(100 - amp, 100):.2f}% {k * 100 / n:.1f}%" for k in range(n + 1)]
        bot = [f"{k * 100 / n:.1f}% {random.uniform(100 - amp, 100):.2f}%" for k in range(n, -1, -1)]
        lft = [f"{random.uniform(0, amp):.2f}% {k * 100 / n:.1f}%" for k in range(n, -1, -1)]
        return "polygon(" + ",".join(top + rgt + bot + lft) + ")"
    def title(s):
        out = []
        for part in _re.split(r"(\*[^*]+\*)", s):
            if part.startswith("*"): out.append(f'<span class="em"><i class="mk"></i>{sp(part[1:-1])}</span>')
            elif part: out.append(sp(part.strip()))
        return " ".join(out)
    css = """
#root { background: #f1e6d3; color: #2b1d14; }
.pg { position: absolute; left: 0; right: 0; top: -40px; bottom: 0; visibility: hidden; box-shadow: 0 -18px 40px rgba(60,35,15,.18); }
.pg .tex { position: absolute; inset: 0; background: url(grain.png); opacity: .16; mix-blend-mode: multiply; }
.pg .lt { position: absolute; inset: 0; background: radial-gradient(90% 60% at 25% 20%, rgba(255,255,255,.35), transparent 65%); }
.ey { position: absolute; left: 90px; top: 190px; font: 800 34px Outfit; letter-spacing: .28em; text-transform: uppercase; color: #b5532b; }
.ti { position: absolute; left: 90px; right: 90px; top: 250px; font: italic 400 112px/1.04 Bodoni; }
.ti.big { top: 620px; font-size: 180px; }
.em { position: relative; display: inline-block; white-space: nowrap; }
.em .mk { position: absolute; left: -14px; right: -14px; top: 50%; height: 48%; background: #f2b33d; opacity: .8; border-radius: 10px 34px 12px 28px; transform: rotate(-1.5deg); transform-origin: 0 50%; z-index: -1; }
.pol { position: absolute; left: 90px; top: 640px; width: 640px; height: 760px; padding: 20px; background: #fffaf2; box-shadow: 0 24px 50px rgba(60,35,15,.28); }
.pol img { width: 100%; height: 100%; object-fit: cover; filter: sepia(.12) contrast(1.05) saturate(1.05); }
.tape { position: absolute; width: 210px; height: 58px; background: rgba(214,190,140,.78); box-shadow: 0 2px 4px rgba(0,0,0,.08); }
.col { position: absolute; width: 400px; height: 480px; padding: 16px; background: #fffaf2; box-shadow: 0 20px 40px rgba(60,35,15,.25); }
.col img { width: 100%; height: 100%; object-fit: cover; filter: sepia(.1); }
.note { position: absolute; left: 90px; width: 560px; top: 1440px; font: 500 50px/1.22 Corm; color: #3a2a1d; }
.strikes { position: absolute; left: 90px; right: 90px; top: 380px; }
.strikes div { position: relative; margin-bottom: 80px; font: italic 400 82px/1.1 Bodoni; display: table; white-space: nowrap; }
.strikes svg { position: absolute; left: -16px; top: 30%; width: calc(100% + 32px); height: 60px; overflow: visible; }
.strikes path, .ink path, .circ path { fill: none; stroke: #b5532b; stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; }
.ink { position: absolute; left: 160px; top: 600px; width: 560px; height: 820px; overflow: visible; }
.ink .dr { fill: #6a9fb5; }
.circ { position: absolute; overflow: visible; }
.end .tag { position: absolute; left: 90px; top: 1150px; font: 900 48px Outfit; letter-spacing: .06em; color: #b5532b; }
.end .br { position: absolute; left: 90px; top: 1230px; font: 600 38px Corm; letter-spacing: .3em; text-transform: uppercase; }
.sub { position: absolute; left: 70px; right: 440px; top: 1690px; visibility: hidden; z-index: 30; }
.sub span { display: inline; padding: 6px 14px; line-height: 1.5; background: rgba(255,250,242,.92); color: #2b1d14; font: 700 34px Outfit; border-radius: 8px; box-decoration-break: clone; -webkit-box-decoration-break: clone; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
#kadi { right: -10px; bottom: -20px; width: 460px; height: 598px; }
"""
    css = CHAR_CSS.replace(".sub {", ".subx {") + css
    pages = []
    for i, c in enumerate(SC):
        bg = PAPERS[i % len(PAPERS)]; inner = f'<div class="tex"></div><div class="lt"></div><div class="ey">{e(c["ey"])}</div>'
        big = not (c.get("ph") or c.get("phs") or c.get("spiral") or c.get("strikes"))
        if c.get("ti"): inner += f'<div class="ti{" big" if big else ""}">{title(c["ti"])}</div>'
        if c.get("ph"):
            rot = -3 if i % 2 else 2.5
            inner += f'<div class="pol" style="transform:rotate({rot}deg);clip-path:{torn(n=30, amp=1.2)}"><img src="photos/{c["ph"]}.jpg"></div>'
            inner += f'<i class="tape" style="left:{80 + (i % 3) * 30}px;top:618px;transform:rotate(-7deg)"></i><i class="tape" style="left:560px;top:1370px;transform:rotate(9deg)"></i>'
        if c.get("phs"):
            for k, p in enumerate(c["phs"]):
                inner += f'<div class="col" style="left:{70 + k * 150}px;top:{620 + k * 120}px;transform:rotate({[-6, 3, -2][k]}deg);clip-path:{torn(n=24, amp=1.4)}"><img src="photos/{p}.jpg"></div>'
        if c.get("strikes"):
            inner += '<div class="strikes">' + "".join(f'<div>{e(s)}<svg viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M0 6 C15 2 30 9 45 5 S75 2 100 6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" vector-effect="non-scaling-stroke"/></svg></div>' for s in c["strikes"]) + "</div>"
        if c.get("spiral"):
            sp_ = "M280 800 " + " ".join(f"Q{280 + (220 if k % 2 else -220) * (1 - k / 18):.0f} {800 - k * 56 - 28} 280 {800 - (k + 1) * 56}" for k in range(13))
            dr = "".join(f'<ellipse class="dr d{k}" cx="{470 + k * 30}" cy="{120 + k * 40}" rx="16" ry="22"/>' for k in range(2))
            inner += f'<svg class="ink" viewBox="0 0 560 820"><path d="{sp_}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>{dr}</svg>'
        if c.get("note"): inner += f'<div class="note">{c["note"]}</div>'
        if c.get("end"): inner += '<div class="end"><div class="tag">#FiersDeNosCheveux</div><div class="br">Kadio Coiffure · Longueuil</div></div>'
        if c.get("circle"):
            inner += '<svg class="circ" style="left:60px;top:560px;width:960px;height:420px" viewBox="0 0 960 420"><path d="M120 230 C120 90 840 60 880 200 C910 330 300 380 140 300 C90 270 110 160 260 120" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>'
        clip = torn(top_only=True, n=40, amp=1.6)
        pages.append(f'<div id="p{i}" class="pg" style="background:{bg};clip-path:{clip};z-index:{10 + i}">{inner}</div>')
    subs = "".join(f'<div class="sub" id="u{i}"><span>{e(subt(v))}</span></div>' for i, v in enumerate(VO))
    body = "".join(pages) + subs + CHAR_SVG
    js = ("const MOUTH = " + json.dumps(MOUTH) + ";\nconst S = " + json.dumps(SCH) + ", L = " + str(LEAD) + ";\n" + """
const A = (i) => S[i][0], E = (i) => S[i][0] + S[i][1];
S.forEach(function (s, i) {
  const p = "#p" + i, t = s[0];
  show(p, t, i === S.length - 1 ? null : s[0] + s[1] + .9);
  if (i) { fin(p, t - .1, .8, { yPercent: 104, rotate: i %% 2 ? 1.2 : -1.2 }, { yPercent: 0, rotate: 0, ease: "power3.inOut" }); cue(t - .1, "sweep-small.wav", .25); }
  fin(p + " .ey", t + .4, .7, { opacity: 0, x: -30 }, { opacity: 1, x: 0, ease: "power3.out" });
  fin(p + " .ti .w", t + .5, .8, { opacity: 0, y: 36 }, { opacity: 1, y: 0, stagger: .07, ease: "power3.out" });
  const nw = document.querySelectorAll(p + " .ti .w").length;
  fin(p + " .mk", t + .9 + nw * .07, .6, { scaleX: 0 }, { scaleX: 1, ease: "power2.inOut" });
  if (document.querySelector(p + " .mk")) cue(t + .9 + nw * .07, "swoosh-wind.wav", .18);
  fin(p + " .pol", t + .55, 1.0, { y: 160, opacity: 0, rotate: "+=8" }, { y: 0, opacity: 1, rotate: "-=8", ease: "power3.out" });
  kb(p + " .pol img", t + .55, s[1] + 1, { scale: 1.12 }, { scale: 1.0 });
  fin(p + " .tape", t + 1.3, .35, { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, stagger: .15, ease: "power2.out" });
  document.querySelectorAll(p + " .col").forEach(function (c, k) { fin(c, t + .6 + k * .45, .9, { y: 200, opacity: 0, rotate: "+=10" }, { y: 0, opacity: 1, rotate: "-=10", ease: "power3.out" }); cue(t + .6 + k * .45, "shutter-vintage.wav", .15); });
  document.querySelectorAll(p + " .strikes > div").forEach(function (d, k) { const tt = t + .5 + k * (s[1] - 1) / 3;
    fin(d, tt, .6, { opacity: 0, x: -40 }, { opacity: 1, x: 0, ease: "power3.out" });
    fin(d.querySelector("path"), tt + .7, .45, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power2.in" }); cue(tt + .8, "swoosh-wind.wav", .2); });
  fin(p + " .ink path", t + .6, Math.min(3, s[1] * .5), { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power1.inOut" });
  document.querySelectorAll(p + " .ink .dr").forEach(function (d, k) { fin(d, t + 1.4 + k * .5, 1.8, { y: -40, opacity: 0 }, { y: 260, opacity: 1, ease: "power2.in" }); tl.to(d, { opacity: 0, duration: .4 }, t + 3.2 + k * .5); });
  fin(p + " .circ path", t + 1.6, 1.0, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power2.inOut" });
  fin(p + " .note", t + Math.min(2.2, s[1] * .45), .8, { opacity: 0, y: 24 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin(p + " .end .tag", E(i) - 3, .7, { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin(p + " .end .br", E(i) - 2.6, .7, { opacity: 0 }, { opacity: 1 });
  if (i === S.length - 1) cue(E(i) - 3, "chime.wav", .25);
  show("#u" + i, t + L, s[0] + s[1] - .05); fin("#u" + i, t + L, .3, { opacity: 0 }, { opacity: 1 });
});
""".replace("%%", "%") + CHAR_JS.replace("if (i === 2 || i === 3 || i === 6)", "if (" + json.dumps(GEST) + ".indexOf(i) >= 0)"))
    open(os.path.join(D, "index.html"), "w").write(page("Fiers de nos cheveux · Papier", css, body, js, T, ("m657", 0 if KEY == "fiers1" else 20)))
elif F in ("ep3", "ep4", "ep5"):
    import soundfile as sf, numpy as np
    KEY = {"ep3": "fiers3", "ep4": "fiers4", "ep5": "fiers5"}[F]
    VO = json.load(open(os.path.join(R, "vo", "spec.json")))[KEY]["vo"]
    LEAD, TAIL = .3, .45; SCH, t = [], 0.0
    for i in range(len(VO)):
        src = os.path.join(R, "vo", f"{KEY}_{i}.wav"); shutil.copy(src, os.path.join(D, f"{KEY}_{i}.wav"))
        d = sf.info(src).duration; dur = LEAD + d + TAIL + (2.8 if i == len(VO) - 1 else 0); SCH.append((round(t, 2), round(dur, 2))); t += dur
    T = round(t, 2)
    json.dump([{"t": round(a + LEAD, 2), "file": f"{KEY}_{i}.wav"} for i, (a, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
    MOUTH = []
    for i in range(len(VO)):
        a, sr = sf.read(os.path.join(R, "vo", f"{KEY}_{i}.wav"), always_2d=True); a = a.mean(1); hop = sr // 15
        env = np.array([np.sqrt(np.mean(a[k:k + hop] ** 2)) for k in range(0, len(a) - hop, hop)]); env = np.clip(env / (np.percentile(env, 95) + 1e-9), 0, 1)
        MOUTH += [[round(SCH[i][0] + LEAD + k / 15, 3), round(float(v), 2)] for k, v in enumerate(env)]
    subt = lambda x: x.replace("Kadyo", "Kadio").replace("loks", "locks").replace("Kraoune Act", "CROWN Act")
    HEAD = ("const MOUTH = " + json.dumps(MOUTH) + ";\nconst S = " + json.dumps(SCH) + ", L = " + str(LEAD) + ";\n"
            "const _ex = (q) => typeof q !== 'string' || document.querySelector(q);\n"
            "const _fin = fin, _kb = kb; fin = function (q, ...r) { if (_ex(q)) _fin(q, ...r); }; kb = function (q, ...r) { if (_ex(q)) _kb(q, ...r); };\n"
            "const A = (i) => S[i][0], E = (i) => S[i][0] + S[i][1];\n"
            "S.forEach(function (s, i) { show('#u' + i, s[0] + L, s[0] + s[1] - .05); fin('#u' + i, s[0] + L, .3, { opacity: 0 }, { opacity: 1 }); });\n")
    subs = "".join(f'<div class="sub" id="u{i}"><span>{e(subt(v))}</span></div>' for i, v in enumerate(VO))
    FONTS = """
@font-face { font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }
@font-face { font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }
.sc { position: absolute; inset: 0; visibility: hidden; }
#kadi { right: -10px; bottom: -20px; width: 460px; height: 598px; }
.sub { position: absolute; left: 70px; right: 450px; top: 1680px; visibility: hidden; z-index: 30; }
"""
    css0 = CHAR_CSS.replace(".sub {", ".subx {") + FONTS

    if F == "ep3":
        SC = [("POURQUOI", "Pourquoi nos cheveux ne seraient pas « propres » ?", None, None),
              ("NORMES", "Des normes de beauté écrites sans nous.", None, ["l2", "h_twists", "b10"]),
              ("TIGNON", "Louisiane : la loi du tignon.", "1786", None),
              ("STYLE", "Elles en ont fait un accessoire de style.", None, ["h_chignon", "bt1", "h_nattes"]),
              ("CORRIGER", "« Corrige tes cheveux. »", None, ["l3", "l4", "b12"]),
              ("CROWN", "CROWN Act : des lois qui protègent nos coiffures.", "2019", None),
              ("HISTOIRE", "Pas une mode. Une histoire.", None, ["h_locks", "bt2", "h_croises"]),
              ("FIERTÉ", "Et on la porte fièrement.", None, None)]
        css = css0 + """
#root { background: #140f0b; color: #f4ece0; font-family: ID; }
.bw { position: absolute; left: -40px; top: 160px; font: 900 330px/0.85 ID; letter-spacing: -.06em; color: rgba(244,236,224,.06); white-space: nowrap; }
.yr { position: absolute; left: 70px; top: 420px; font: 900 300px/1 ID; letter-spacing: -.06em; color: #f2c46d; }
.stk { position: absolute; left: 120px; top: 360px; width: 600px; height: 780px; perspective: 1600px; }
.stk .c { position: absolute; inset: 0; border-radius: 34px; overflow: hidden; box-shadow: 0 40px 80px rgba(0,0,0,.65); }
.stk .c img { width: 100%; height: 100%; object-fit: cover; }
.sen { position: absolute; left: 70px; right: 70px; top: 1220px; font: 700 76px/1.1 ID; letter-spacing: -.035em; }
.sen .w { color: rgba(244,236,224,.25); }
.sc.np .sen { top: 760px; font-size: 104px; }
.sc.yrs .sen { top: 800px; }
.leak { position: absolute; width: 1400px; height: 1400px; left: -200px; top: 200px; border-radius: 50%; background: radial-gradient(circle, rgba(255,150,60,.45), rgba(255,90,40,.15) 40%, transparent 68%); mix-blend-mode: screen; opacity: 0; z-index: 20; pointer-events: none; }
.tag { position: absolute; left: 70px; top: 1100px; font: 900 48px ID; color: #f2c46d; }
.br { position: absolute; left: 70px; top: 1170px; font: 700 34px ID; color: rgba(244,236,224,.6); }
.src { position: absolute; left: 70px; top: 1560px; font: 700 24px ID; color: rgba(244,236,224,.45); }
.sub span { display: inline; padding: 6px 14px; line-height: 1.5; background: rgba(0,0,0,.55); color: #fff; font: 700 34px ID; border-radius: 8px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
"""
        body = ""
        for i, (bw, sen, yr, phs) in enumerate(SC):
            cls = "sc" + (" np" if not phs and not yr else "") + (" yrs" if yr else "")
            h = f'<div id="s{i}" class="{cls}"><div class="bw">{e(bw)}</div>'
            if yr: h += f'<div class="yr">{yr}</div>'
            if phs: h += '<div class="stk">' + "".join(f'<div class="c c{k}"><img src="photos/{p}.jpg"></div>' for k, p in enumerate(phs)) + "</div>"
            h += f'<div class="sen">{sp(sen)}</div>'
            if i == 2: h += '<div class="src">Loi du tignon, gouverneur Miró, Louisiane, 1786</div>'
            if i == 5: h += '<div class="src">CROWN Act : Californie 2019, puis d\'autres États américains</div>'
            if i == len(SC) - 1: h += '<div class="tag">#FiersDeNosCheveux</div><div class="br">Kadio Coiffure · Longueuil</div>'
            body += h + "</div>"
        body += '<div class="leak"></div>' + subs + '<div class="layer vig"></div>' + CHAR_SVG
        js = HEAD + """
S.forEach(function (s, i) {
  const p = "#s" + i, t = s[0], d = s[1];
  show(p, t, i === S.length - 1 ? null : t + d);
  if (i) { fin(p, t, .6, { opacity: 0 }, { opacity: 1, ease: "sine.inOut" }); cue(t - .1, "woosh-air.wav", .15); }
  tl.fromTo(".leak", { opacity: 0, x: -600 }, { opacity: 1, x: 200, duration: .5, ease: "sine.in", immediateRender: false }, t - .3); tl.to(".leak", { opacity: 0, x: 900, duration: .6, ease: "sine.out" }, t + .2);
  kb(p + " .bw", t, d + .6, { x: 80 }, { x: -220 });
  fin(p + " .yr", t + .2, 1.1, { opacity: 0, scale: 1.4, filter: "blur(18px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", ease: "power3.out" });
  if (document.querySelector(p + " .yr")) cue(t + .3, "bass.wav", .4);
  document.querySelectorAll(p + " .stk .c").forEach(function (c, k) {
    const z = (2 - k) * -180, x = (2 - k) * 90, yy = (2 - k) * -40;
    fin(c, t + .2 + k * .2, 1.2, { opacity: 0, x: x + 300, y: yy, z: z - 300, rotateY: -25 }, { opacity: 1, x: x, y: yy, z: z, rotateY: -10, ease: "power3.out" });
    tl.to(c, { x: x - 60, rotateY: -4, duration: d, ease: "sine.inOut" }, t + 1.4);
    tl.set(c, { filter: k < 2 ? "brightness(" + (.45 + k * .2) + ") blur(" + (2 - k) + "px)" : "none" }, 0);
  });
  const ws = document.querySelectorAll(p + " .sen .w"), n = ws.length, t0 = t + L + .1, span = Math.max(1, d - L - .8);
  fin(p + " .sen .w", t + .3, .6, { opacity: 0, y: 30 }, { opacity: 1, y: 0, stagger: .04, ease: "power3.out" });
  ws.forEach(function (w, k) { tl.to(w, { color: "#f4ece0", duration: .25 }, t0 + span * k / n); });
  fin(p + " .src", t + 1.2, .8, { opacity: 0 }, { opacity: 1 });
  fin(p + " .tag", E(i) - 3, .7, { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin(p + " .br", E(i) - 2.6, .7, { opacity: 0 }, { opacity: 1 });
});
cue(E(S.length - 1) - 3, "chime.wav", .25);
""" + CHAR_JS.replace("if (i === 2 || i === 3 || i === 6)", "if ([2, 5, 6].indexOf(i) >= 0)")
        open(os.path.join(D, "index.html"), "w").write(page("Une histoire de racines", css, body, js, T, ("m288", 10)))

    elif F == "ep4":
        AUR = [("#ff8fb3", "#ffc36b", "#7b8cff", "#2a1f4f"), ("#6ee7d8", "#7b8cff", "#c084fc", "#14213d"), ("#ffb86b", "#ff6b8a", "#8b5cf6", "#2b1435"),
               ("#7dd3fc", "#a78bfa", "#f472b6", "#1e1b4b"), ("#fde68a", "#fb923c", "#f472b6", "#3b1d2e"), ("#86efac", "#67e8f9", "#a78bfa", "#132a33")]
        css = css0 + """
#root { background: #2a1f4f; color: #fff; font-family: ID; }
.au { position: absolute; inset: -300px; filter: blur(70px) saturate(1.2); }
.au i { position: absolute; width: 900px; height: 900px; border-radius: 50%; opacity: .9; }
.gl { position: absolute; background: rgba(255,255,255,.14); backdrop-filter: blur(30px) saturate(1.6); -webkit-backdrop-filter: blur(30px) saturate(1.6); border: 1.5px solid rgba(255,255,255,.35); border-radius: 52px; box-shadow: inset 0 1px 0 rgba(255,255,255,.5), 0 30px 60px rgba(0,0,0,.18); }
.pill { left: 70px; top: 170px; padding: 18px 34px; font: 700 34px ID; border-radius: 999px; }
.h { position: absolute; left: 70px; right: 70px; top: 300px; font: 700 112px/1.02 ID; letter-spacing: -.045em; }
.cards { position: absolute; left: 70px; right: 70px; top: 760px; display: flex; flex-wrap: wrap; gap: 26px; }
.cards .gl { position: relative; padding: 40px 44px; min-width: 420px; }
.cards small { display: block; font: 700 30px ID; opacity: .75; } .cards b { display: block; margin-top: 10px; font: 700 96px/1 ID; letter-spacing: -.04em; }
.num { position: absolute; left: 70px; right: 70px; top: 560px; padding: 60px 56px; }
.num b { display: block; font: 900 260px/0.9 ID; letter-spacing: -.06em; }
.num p { margin-top: 26px; font: 700 50px/1.18 ID; letter-spacing: -.02em; }
.num small { display: block; margin-top: 20px; font: 700 28px ID; opacity: .7; }
.src { position: absolute; left: 70px; top: 1580px; font: 700 26px ID; opacity: .7; }
.tag { position: absolute; left: 70px; top: 1120px; font: 900 50px ID; }
.sub span { display: inline; padding: 6px 14px; line-height: 1.5; background: rgba(0,0,0,.35); color: #fff; font: 700 34px ID; border-radius: 10px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
"""
        au = '<div class="au">' + "".join(f'<i class="a{k}"></i>' for k in range(3)) + "</div>"
        body = au
        body += f'<div id="s0" class="sc"><div class="gl pill" style="position:absolute">Étude Dove CROWN · 2019</div><div class="h" style="top:640px;font-size:150px">{sp("Un chiffre")}<br>{sp("pour comprendre.")}</div></div>'
        body += f'<div id="s1" class="sc"><div class="h">{sp("Les cheveux naturels, traités pareil au travail ?")}</div><div class="cards"><div class="gl"><small>Année</small><b>2019</b></div><div class="gl"><small>Femmes interrogées</small><b>2 000</b></div><div class="gl"><small>Pays</small><b>États-Unis</b></div></div></div>'
        body += '<div id="s2" class="sc"><div class="gl num"><b><span class="cnt" data-to="1.5" data-dec="1">0</span> ×</b><p>plus susceptibles d\'avoir été renvoyées chez elles à cause de leurs cheveux*</p><small>* ou de connaître quelqu\'un à qui c\'est arrivé</small></div></div>'
        body += '<div id="s3" class="sc"><div class="gl num"><b><span class="cnt" data-to="80" data-dec="0">0</span> %</b><p>plus nombreuses à penser devoir changer leurs cheveux naturels pour être acceptées au bureau</p></div></div>'
        body += f'<div id="s4" class="sc"><div class="h" style="top:600px;font-size:130px">{sp("Pas le cheveu.")}<br>{sp("Le regard.")}</div></div>'
        body += f'<div id="s5" class="sc"><div class="h" style="top:420px;font-size:118px">{sp("Tes cheveux sont les bienvenus.")}<br>{sp("Tels qu’ils sont.")}</div><div class="tag">#FiersDeNosCheveux · Kadio Coiffure</div></div>'
        body += '<div class="src">Source : Dove CROWN Research Study, 2019 (2 000 femmes, États-Unis)</div>' + subs + CHAR_SVG
        js = HEAD + "const AUR = " + json.dumps(AUR) + ";\n" + """
const P = [[-100, -50], [500, 200], [100, 900]];
document.querySelectorAll(".au i").forEach(function (b, k) { tl.set(b, { left: P[k][0], top: P[k][1], backgroundColor: AUR[0][k] }, 0);
  tl.to(b, { x: k % 2 ? 260 : -220, y: k ? -260 : 240, duration: S[S.length - 1][0] + S[S.length - 1][1], ease: "sine.inOut" }, 0); });
tl.set("#root", { backgroundColor: AUR[0][3] }, 0);
S.forEach(function (s, i) {
  const p = "#s" + i, t = s[0], d = s[1];
  show(p, t, i === S.length - 1 ? null : t + d);
  if (i) { document.querySelectorAll(".au i").forEach(function (b, k) { tl.to(b, { backgroundColor: AUR[i][k], duration: 1.2, ease: "sine.inOut" }, t - .4); }); tl.to("#root", { backgroundColor: AUR[i][3], duration: 1.2 }, t - .4); cue(t - .1, "woosh-air.wav", .12); }
  fin(p + " .pill", t + .2, .8, { opacity: 0, y: -20 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin(p + " .h .w", t + .25, .9, { opacity: 0, y: 40, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: .05, ease: "power3.out" });
  document.querySelectorAll(p + " .cards .gl").forEach(function (c, k) { fin(c, t + 1 + k * .5, .9, { opacity: 0, y: 60, scale: .95 }, { opacity: 1, y: 0, scale: 1, ease: "power3.out" }); });
  fin(p + " .num", t + .2, 1, { opacity: 0, y: 80, scale: .96 }, { opacity: 1, y: 0, scale: 1, ease: "power3.out" });
  document.querySelectorAll(p + " .cnt").forEach(function (c) { const to = +c.dataset.to, dec = +c.dataset.dec, N = 24;
    for (let k = 0; k <= N; k++) { const v = to * (1 - Math.pow(1 - k / N, 3)); tl.set(c, { textContent: v.toFixed(dec).replace(".", ",") }, t + .6 + k * .06); } cue(t + .6, "sweep-small.wav", .2); cue(t + 2.1, "bass.wav", .35); });
  fin(p + " .num p, " + p + " .num small", t + 1.0, .8, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .3, ease: "power3.out" });
  fin(p + " .tag", E(i) - 3, .7, { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: "power3.out" });
});
fin(".src", A(2), .8, { opacity: 0 }, { opacity: .7 }); tl.to(".src", { opacity: 0, duration: .4 }, A(4));
tl.set(".src", { opacity: .7 }, A(5) + 1); cue(E(S.length - 1) - 3, "chime.wav", .25);
""" + CHAR_JS.replace("if (i === 2 || i === 3 || i === 6)", "if ([2, 3, 4].indexOf(i) >= 0)")
        open(os.path.join(D, "index.html"), "w").write(page("Le chiffre", css, body, js, T, ("m169", 5)))

    else:
        SC = [("CHAQUE TEXTURE", "est une couronne.", None, "#1d1d1f", "#ffc21a"),
              ("AFRO", "pousse vers le ciel", "b10", "#ff6a3d", "#1d1d1f"),
              ("LOCKS", "le temps et la patience", "h_locks", "#2f9e6e", "#fff7e6"),
              ("TRESSES", "ligne par ligne", "h_nattes", "#3d5afe", "#fff7e6"),
              ("TWISTS", "légers, en mouvement", "h_twists", "#ff5fa2", "#1d1d1f"),
              ("COUPES", "tracées au millimètre", "b2", "#ffc21a", "#1d1d1f"),
              ("LA TIENNE.", "pas une seule façon d'être beau", None, "#fff7e6", "#1d1d1f"),
              ("PORTE TA", "couronne.", None, "#1d1d1f", "#ffc21a")]
        css = css0 + """
#root { background: #1d1d1f; font-family: ID; }
.blk { position: absolute; inset: 0; }
.big { position: absolute; left: 60px; right: 40px; top: 210px; font: 900 190px/.86 ID; letter-spacing: -.055em; text-transform: uppercase; white-space: nowrap; }
.small { position: absolute; left: 66px; top: 420px; font: 700 54px ID; letter-spacing: -.02em; }
.circ { position: absolute; left: 140px; top: 600px; width: 800px; height: 800px; }
.circ .ph { position: absolute; inset: 60px; border-radius: 50%; overflow: hidden; visibility: visible; }
.circ .ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.circ svg { position: absolute; inset: 0; overflow: visible; }
.circ circle { fill: none; stroke-width: 6; stroke-dasharray: 18 22; }
.crown { position: absolute; left: 240px; top: 700px; width: 600px; height: 420px; overflow: visible; }
.crown path { fill: none; stroke-width: 22; stroke-linecap: round; stroke-linejoin: round; }
.grid { position: absolute; left: 70px; right: 70px; top: 660px; display: flex; flex-wrap: wrap; gap: 30px; justify-content: center; }
.grid i { width: 280px; height: 280px; border-radius: 50%; background-size: cover; background-position: center; border: 10px solid; }
.tag { position: absolute; left: 66px; top: 1240px; font: 900 50px ID; }
.br { position: absolute; left: 66px; top: 1310px; font: 700 34px ID; opacity: .7; }
.sub span { display: inline; padding: 6px 14px; line-height: 1.5; background: rgba(0,0,0,.6); color: #fff; font: 700 34px ID; border-radius: 10px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
"""
        body = ""
        cols = ["#ff6a3d", "#2f9e6e", "#3d5afe", "#ff5fa2", "#ffc21a", "#1d1d1f"]
        for i, (big, small, ph, bg, fg) in enumerate(SC):
            h = f'<div id="s{i}" class="sc" style="color:{fg}"><div class="blk" style="background:{bg}"></div><div class="big" style="font-size:{min(190, int(960 / (0.6 * len(big))))}px">{sp(big)}</div><div class="small">{sp(small)}</div>'
            if ph: h += f'<div class="circ"><div class="ph"><img src="photos/{ph}.jpg"></div><svg viewBox="0 0 800 800"><circle cx="400" cy="400" r="380" stroke="{fg}"/></svg></div>'
            if i in (0, 7): h += f'<svg class="crown" viewBox="0 0 600 420"><path d="M40 380 L70 110 L190 240 L300 40 L410 240 L530 110 L560 380 Z" stroke="{fg}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>'
            if i == 6: h += '<div class="grid">' + "".join(f'<i style="background-image:url(photos/{p}.jpg);border-color:{c}"></i>' for p, c in zip(["b10", "h_locks", "h_nattes", "h_twists", "b2", "l3"], cols)) + "</div>"
            if i == 7: h += f'<div class="tag" style="top:1200px">#FiersDeNosCheveux</div><div class="br" style="top:1270px">Kadio Coiffure · Longueuil</div>'
            body += h + "</div>"
        body += subs + CHAR_SVG
        js = HEAD + """
S.forEach(function (s, i) {
  const p = "#s" + i, t = s[0], d = s[1];
  show(p, t, i === S.length - 1 ? null : t + d + .7); tl.set(p, { zIndex: 5 + i }, 0);
  if (i) { fin(p + " .blk", t - .05, .65, { clipPath: "polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%)" }, { clipPath: "polygon(0% -20%, 100% 0%, 100% 100%, 0% 100%)", ease: "power4.inOut" }); cue(t - .05, "whoosh-fast.wav", .3); }
  fin(p + " .big .ch", t + .35, .55, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: .03, ease: "power4.out" }); cue(t + .35, "pop-hard.wav", .2);
  fin(p + " .small .w", t + .8, .6, { opacity: 0, x: -30 }, { opacity: 1, x: 0, stagger: .06, ease: "power3.out" });
  fin(p + " .circ .ph", t + .5, .9, { scale: 0 }, { scale: 1, ease: "back.out(1.4)" });
  kb(p + " .circ img", t + .5, d + .8, { scale: 1.25 }, { scale: 1.05 });
  fin(p + " .circ svg", t + .7, d + .6, { rotate: 0, opacity: 0, transformOrigin: "50% 50%" }, { rotate: 120, opacity: 1, ease: "none" });
  fin(p + " .crown path", t + .9, 1.4, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "power2.inOut" });
  if (document.querySelector(p + " .crown")) cue(t + .9, "sparkle.wav", .3);
  document.querySelectorAll(p + " .grid i").forEach(function (g, k) { fin(g, t + .6 + k * .18, .6, { scale: 0, rotate: -40 }, { scale: 1, rotate: 0, ease: "back.out(2)" }); cue(t + .6 + k * .18, "pop-bubble.wav", .15); });
  fin(p + " .tag", E(i) - 3, .6, { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: "power3.out" }); fin(p + " .br", E(i) - 2.6, .6, { opacity: 0 }, { opacity: .7 });
});
cue(E(S.length - 1) - 3, "chime.wav", .25);
""" + CHAR_JS.replace("if (i === 2 || i === 3 || i === 6)", "if ([1, 3, 5, 7].indexOf(i) >= 0)")
        open(os.path.join(D, "index.html"), "w").write(page("Toutes nos couronnes", css, body, js, T, ("m623", 25)))
elif F in ("coif1", "coif3"):
    T = 15.0
    BR = dict(ink="#1d1611", cream="#fbf4ea", ac="#e0673f", ac2="#2f6f62", soft="#f3d9c6")
    css = """
@font-face { font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }
@font-face { font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }
:root { --ink: %(ink)s; --cream: %(cream)s; --ac: %(ac)s; --ac2: %(ac2)s; --soft: %(soft)s; }
#root { background: var(--cream); color: var(--ink); font-family: ID; }
.sc { position: absolute; inset: 0; visibility: hidden; }
.cap { position: absolute; left: 80px; right: 80px; top: 200px; font: 900 96px/1.0 ID; letter-spacing: -.045em; z-index: 20; }
.cap .a { color: var(--ac); }
.end { position: absolute; inset: 0; background: var(--ink); color: var(--cream); visibility: hidden; z-index: 50; }
.end h1 { position: absolute; left: 80px; right: 80px; top: 640px; font: 900 116px/1.0 ID; letter-spacing: -.05em; }
.end h1 .a { color: var(--ac); }
.logo { position: absolute; left: 80px; top: 200px; font: 900 64px ID; letter-spacing: -.04em; }
.logo i { font-style: normal; color: var(--ac); }
.btn { position: absolute; left: 80px; top: 1180px; padding: 34px 60px; border-radius: 999px; background: var(--ac); color: #fff; font: 900 52px ID; letter-spacing: -.02em; }
.url { position: absolute; left: 84px; top: 1330px; font: 700 40px ID; opacity: .75; }
.finger { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%%; background: rgba(29,22,17,.22); border: 6px solid #fff; box-shadow: 0 10px 30px rgba(0,0,0,.25); z-index: 30; visibility: hidden; }
.ring { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%%; border: 6px solid var(--ac); z-index: 29; opacity: 0; }
.photo { position: absolute; overflow: hidden; border-radius: 40px; }
.photo img { position: absolute; inset: 0; width: 100%%; height: 100%%; object-fit: cover; transform-origin: 50%% 50%%; }
""" % BR
    END = """<div class="end"><div class="logo">Coiff<i>Ici</i></div><h1>%s</h1><div class="btn">Réserver maintenant</div><div class="url">coiffici.codunk.site</div></div>"""
    END_JS = """
const TE = 12.8; show(".end", TE, null); fin(".end", TE, .6, { clipPath: "circle(0% at 50% 60%)" }, { clipPath: "circle(150% at 50% 60%)", ease: "power3.inOut" }); cue(TE, "whoosh-cine.wav", .35);
fin(".end .logo", TE + .4, .5, { opacity: 0, y: -20 }, { opacity: 1, y: 0, ease: "power3.out" });
fin(".end h1 .w", TE + .5, .6, { opacity: 0, y: 50 }, { opacity: 1, y: 0, stagger: .06, ease: "power3.out" }); cue(TE + .5, "bass.wav", .35);
fin(".end .btn", TE + 1.1, .5, { scale: 0 }, { scale: 1, ease: "back.out(2.2)" }); cue(TE + 1.1, "pop-bubble.wav", .3);
tl.to(".end .btn", { scale: 1.05, duration: .3, yoyo: true, repeat: 1, ease: "sine.inOut" }, TE + 1.7);
fin(".end .url", TE + 1.4, .5, { opacity: 0 }, { opacity: .75 });
"""
    def finger_js(pts):
        # pts: [(t, x, y, tap)]
        out = 'tl.set(".finger", { autoAlpha: 0 }, 0);\n'
        t0 = pts[0][0]
        out += f'tl.set(".finger", {{ autoAlpha: 1, left: {pts[0][1]}, top: {pts[0][2]} }}, {t0});\n'
        out += f'fin(".finger", {t0}, .4, {{ scale: 0 }}, {{ scale: 1, ease: "back.out(2)" }});\n'
        for t, x, y, tap in pts[1:]:
            out += f'tl.to(".finger", {{ left: {x}, top: {y}, duration: .6, ease: "power3.inOut" }}, {t - .6});\n'
            if tap:
                out += f'tl.to(".finger", {{ scale: .8, duration: .1, yoyo: true, repeat: 1 }}, {t}); cue({t}, "click.wav", .45);\n'
                out += f'tl.set(".ring", {{ left: {x}, top: {y} }}, {t}); tl.fromTo(".ring", {{ opacity: .9, scale: .6 }}, {{ opacity: 0, scale: 2.2, duration: .5, ease: "power2.out", immediateRender: false }}, {t});\n'
        return out
    if F == "coif1":
        body = f"""
<div id="s0" class="sc">
 <svg style="position:absolute;left:0;top:0;width:1080px;height:1920px" viewBox="0 0 1080 1920">
  <rect x="0" y="1500" width="1080" height="420" fill="#ead8c3"/>
  <rect x="240" y="560" width="600" height="940" rx="14" fill="#8a4b2f"/><rect x="255" y="575" width="570" height="925" fill="#fff3e2"/>
  <g id="door" style="transform-origin:255px 1030px"><rect x="255" y="575" width="570" height="925" rx="8" fill="var(--ac)"/>
   <rect x="315" y="640" width="450" height="300" rx="10" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="10"/><rect x="315" y="1000" width="450" height="420" rx="10" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="10"/>
   <circle cx="760" cy="1060" r="24" fill="#f2c46d"/></g>
  <g id="bell"><rect x="880" y="900" width="90" height="150" rx="20" fill="#2b211b"/><circle cx="925" cy="975" r="26" fill="#f2c46d"/></g>
  <g id="waves" fill="none" stroke="var(--ac)" stroke-width="8" stroke-linecap="round"><path d="M1000 930 q30 45 0 90"/><path d="M1030 900 q50 75 0 150"/></g>
 </svg>
 <svg id="pro" style="position:absolute;left:320px;top:700px;width:440px;height:820px" viewBox="0 0 440 820">
  <circle cx="220" cy="110" r="88" fill="#1d1511"/><circle cx="220" cy="40" r="50" fill="#1d1511"/>
  <ellipse cx="220" cy="150" rx="66" ry="78" fill="#7a4a2e"/>
  <circle cx="196" cy="146" r="7" fill="#1d1511"/><circle cx="244" cy="146" r="7" fill="#1d1511"/><path d="M200 182 q20 16 40 0" stroke="#4a1f14" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M90 820 C90 400 140 260 220 260 C300 260 350 400 350 820 Z" fill="var(--ac2)"/>
  <g id="case"><rect x="300" y="560" width="140" height="110" rx="16" fill="#2b211b"/><rect x="345" y="535" width="50" height="30" rx="10" fill="none" stroke="#2b211b" stroke-width="10"/><rect x="300" y="600" width="140" height="10" fill="#f2c46d"/></g>
 </svg>
 <div class="cap" id="c0">{sp("Ta coiffeuse")}<br><span class="a">{sp("est là.")}</span></div>
</div>
<div id="s1" class="sc" style="background:var(--soft)"><div class="photo" id="p1" style="left:90px;top:520px;width:900px;height:1100px"><img src="photos/h_twists.jpg"></div><div class="cap">{sp("Chez toi.")} <span class="a">{sp("Pendant les twists.")}</span></div></div>
<div id="s2" class="sc" style="background:var(--cream)">
 <div style="position:absolute;left:150px;top:420px;width:780px;height:1180px;border-radius:390px 390px 40px 40px;background:#d9c2a6;box-shadow:inset 0 0 0 26px #b88a5a"></div>
 <div class="photo" id="p2" style="left:176px;top:446px;width:728px;height:1128px;border-radius:364px 364px 18px 18px"><img src="photos/bt2.jpg"></div>
 <div class="cap">{sp("Et le résultat,")} <span class="a">{sp("dans ton miroir.")}</span></div></div>
{END % (sp("Réserve ta coiffure") + "<br><span class='a'>" + sp("à domicile.") + "</span>")}"""
        js = """
show("#s0", 0, 6.4); show("#s1", 6.0, 9.8); show("#s2", 9.4, null);
cue(.15, "doorbell.wav", .6);
tl.fromTo("#bell", { rotate: -8, transformOrigin: "925px 975px" }, { rotate: 8, duration: .08, yoyo: true, repeat: 9, ease: "sine.inOut", immediateRender: false }, .15);
fin("#waves path", .2, .3, { opacity: 0, scale: .6, transformOrigin: "980px 975px" }, { opacity: 1, scale: 1, stagger: .15, ease: "power2.out" }); tl.to("#waves", { opacity: 0, duration: .4 }, 1.6);
fin("#c0 .w", .5, .6, { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: .08, ease: "power3.out" });
tl.set("#pro", { autoAlpha: 0 }, 0);
tl.to("#door", { scaleX: .12, skewY: -6, transformOrigin: "255px 1030px", duration: 1, ease: "power3.inOut" }, 3.0); cue(3.0, "woosh-air.wav", .35);
tl.set("#pro", { autoAlpha: 1 }, 3.6); fin("#pro", 3.6, 1.1, { x: 260, scale: .85, opacity: 0 }, { x: 0, scale: 1, opacity: 1, ease: "power3.out" });
tl.to("#case", { y: -12, duration: .25, yoyo: true, repeat: 3, ease: "sine.inOut" }, 3.6);
tl.to("#s0 svg, #pro", { scale: 3, transformOrigin: "60% 70%", duration: 1, ease: "power3.in" }, 5.4);
fin("#s1", 6.0, .5, { opacity: 0 }, { opacity: 1 }); cue(6.0, "whoosh-cine.wav", .3);
fin("#p1", 6.0, .8, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(80% at 50% 50%)", ease: "power3.out" });
kb("#p1 img", 6.0, 4, { scale: 1.2 }, { scale: 1.02 });
fin("#s1 .cap .w", 6.3, .6, { opacity: 0, y: 30 }, { opacity: 1, y: 0, stagger: .06, ease: "power3.out" });
fin("#s2", 9.4, .5, { opacity: 0 }, { opacity: 1 }); cue(9.4, "sparkle.wav", .3);
fin("#p2", 9.6, 1, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, ease: "power3.out" }); kb("#p2 img", 9.6, 3.6, { scale: 1.15 }, { scale: 1.0 });
fin("#s2 .cap .w", 9.8, .6, { opacity: 0, y: 30 }, { opacity: 1, y: 0, stagger: .06, ease: "power3.out" });
""" + END_JS
        open(os.path.join(D, "index.html"), "w").write(page("CoiffIci 1 · Le salon sonne", css, body, js, T, ("m1000", 30)))
    else:
        css += """
.tile { position: absolute; left: 60px; right: 60px; height: 520px; border-radius: 36px; overflow: hidden; }
.tile img { width: 100%; height: 100%; object-fit: cover; }
.tile span { position: absolute; left: 26px; bottom: 26px; padding: 12px 26px; border-radius: 999px; background: rgba(255,255,255,.92); font: 700 36px ID; }
.card { position: absolute; left: 90px; right: 90px; top: 380px; height: 1180px; border-radius: 48px; background: #fff; box-shadow: 0 40px 90px rgba(29,22,17,.18); overflow: hidden; visibility: hidden; }
.card .th { position: absolute; left: 40px; right: 40px; top: 40px; height: 480px; border-radius: 30px; overflow: hidden; }
.card .th img { width: 100%; height: 100%; object-fit: cover; }
.card h3 { position: absolute; left: 50px; top: 560px; font: 900 72px ID; letter-spacing: -.04em; }
.card .d { position: absolute; left: 52px; top: 650px; font: 700 36px ID; color: rgba(29,22,17,.55); }
.slots { position: absolute; left: 50px; right: 50px; top: 740px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.slot { padding: 34px 0; text-align: center; border-radius: 26px; border: 4px solid rgba(29,22,17,.15); font: 900 54px ID; }
.ok { position: absolute; left: 50px; right: 50px; top: 1040px; padding: 34px 0; text-align: center; border-radius: 999px; background: var(--ac); color: #fff; font: 900 46px ID; }
"""
        tiles = [("h_nattes", "Nattes"), ("h_twists", "Twists"), ("h_locks", "Locks")]
        body = '<div id="s0" class="sc">' + "".join(f'<div class="tile t{k}" style="top:{380 + k * 545}px"><img src="photos/{p}.jpg"><span>{e(n)}</span></div>' for k, (p, n) in enumerate(tiles))
        body += f'<div class="cap" id="c0" style="top:200px">{sp("Ceux-là.")}</div></div>'
        body += f"""<div class="card"><div class="th"><img src="photos/h_twists.jpg"></div><h3>Twists</h3><div class="d">À domicile · samedi</div>
<div class="slots"><div class="slot">10 h</div><div class="slot">12 h</div><div class="slot s14">14 h</div><div class="slot">16 h</div></div><div class="ok">Réserver 14 h</div></div>
<div id="s2" class="sc"><div class="photo" id="p2" style="inset:0;border-radius:0"><img src="photos/h_twists.jpg" style="object-position:50% 40%"></div>
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45),transparent 30%)"></div><div class="cap" style="color:#fff">{sp("Samedi, 14 h.")}<br><span class="a">{sp("Chez toi.")}</span></div></div>
<div class="finger"></div><div class="ring"></div>
{END % (sp("Choisis ta coiffure") + "<br><span class='a'>" + sp("sur CoiffIci.") + "</span>")}"""
        js = """
show("#s0", 0, 4.2); show(".card", 3.4, 8.6); show("#s2", 8.2, null);
document.querySelectorAll("#s0 .tile").forEach(function (t, k) { fin(t, .1 + k * .15, .6, { y: 120, opacity: 0 }, { y: 0, opacity: 1, ease: "power3.out" }); kb(t.querySelector("img"), 0, 4, { scale: 1.15 }, { scale: 1.02 }); });
cue(.1, "woosh-air.wav", .25);
""" + finger_js([(1.2, 760, 1500), (2.1, 540, 1185, True), (6.4, 540, 1330, True), (7.4, 540, 1500, True)]) + """
tl.to("#s0 .t0, #s0 .t2", { opacity: .25, scale: .96, duration: .4 }, 2.2);
fin("#c0 .w", 2.2, .5, { opacity: 0, y: 30 }, { opacity: 1, y: 0, ease: "back.out(2)" }); cue(2.2, "pop-hard.wav", .25);
tl.to("#s0 .t1", { top: 420, height: 480, left: 130, right: 130, duration: .8, ease: "power3.inOut" }, 3.0); cue(3.0, "sweep-small.wav", .3);
fin(".card", 3.4, .7, { opacity: 0, y: 80 }, { opacity: 1, y: 0, ease: "power3.out" });
fin(".card .slot", 4.2, .4, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: .1, ease: "power3.out" });
fin(".card .ok", 4.8, .4, { opacity: 0 }, { opacity: .35 });
tl.set(".card .s14", { backgroundColor: "#fff", color: "#1d1611", borderColor: "rgba(29,22,17,.15)" }, 0);
tl.set(".card .s14", { backgroundColor: "#1d1611", color: "#fff", borderColor: "#1d1611" }, 6.4);
tl.to(".card .ok", { opacity: 1, duration: .3 }, 6.5);
tl.to(".card", { rotationY: 90, duration: .45, ease: "power2.in" }, 7.8); cue(7.9, "whoosh-cine.wav", .3);
fin("#s2", 8.2, .5, { opacity: 0 }, { opacity: 1 }); kb("#p2 img", 8.2, 5, { scale: 1.25 }, { scale: 1.02 }); cue(8.3, "sparkle.wav", .3);
fin("#s2 .cap .w", 8.6, .6, { opacity: 0, y: 30 }, { opacity: 1, y: 0, stagger: .06, ease: "power3.out" });
tl.set(".finger", { autoAlpha: 0 }, 7.8);
""" + END_JS
        open(os.path.join(D, "index.html"), "w").write(page("CoiffIci 3 · Ceux-là", css, body, js, T, ("m623", 40)))
elif F == "extlocks":
    T = 16.0
    css = """
@font-face { font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }
@font-face { font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }
#root { background: #0f0d0c; color: #fff; font-family: ID; }
.ph { position: absolute; left: 0; right: 0; top: 140px; height: 1624px; overflow: hidden; visibility: visible; }
.ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 40%; }
#after { clip-path: inset(0 0 0 100%); }
.div { position: absolute; top: 140px; height: 1624px; width: 8px; margin-left: -4px; background: #fff; box-shadow: 0 0 30px rgba(255,255,255,.7); z-index: 5; }
.knob { position: absolute; top: 880px; width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%; background: #fff; z-index: 6; display: flex; align-items: center; justify-content: center; font: 900 44px ID; color: #0f0d0c; }
.lab { position: absolute; top: 210px; padding: 16px 34px; border-radius: 999px; font: 900 40px ID; letter-spacing: .12em; z-index: 7; }
.lab.av { left: 50px; background: rgba(15,13,12,.75); }
.lab.ap { right: 50px; background: #e7a64a; color: #0f0d0c; }
.top { position: absolute; left: 0; right: 0; top: 0; height: 140px; display: flex; align-items: center; justify-content: space-between; padding: 0 50px; background: #0f0d0c; z-index: 8; font: 900 40px ID; letter-spacing: -.02em; }
.top small { font: 700 30px ID; color: #e7a64a; letter-spacing: .1em; }
.bot { position: absolute; left: 0; right: 0; top: 1764px; bottom: 0; background: #0f0d0c; z-index: 8; display: flex; align-items: center; justify-content: center; font: 700 34px ID; color: rgba(255,255,255,.75); }
.rule { position: absolute; right: 60px; top: 700px; width: 130px; height: 780px; z-index: 7; }
.rule .bar { position: absolute; left: 0; top: 0; width: 34px; height: 100%; border-radius: 17px; background: rgba(255,255,255,.18); overflow: hidden; }
.rule .fill { position: absolute; left: 0; bottom: 0; width: 100%; height: 100%; background: linear-gradient(0deg, #e7a64a, #ffd892); transform-origin: 50% 100%; }
.rule .t { position: absolute; left: 44px; width: 30px; height: 4px; background: rgba(255,255,255,.8); }
.rule .n { position: absolute; left: -130px; top: -150px; width: 260px; text-align: center; font: 900 120px/1 ID; letter-spacing: -.05em; text-shadow: 0 6px 30px rgba(0,0,0,.6); }
.rule .u { position: absolute; left: -130px; top: -40px; width: 260px; text-align: center; font: 700 34px ID; color: #e7a64a; }
.end { position: absolute; inset: 0; background: #0f0d0c; z-index: 20; visibility: hidden; }
.end .k { position: absolute; left: 70px; right: 70px; top: 560px; font: 900 120px/1 ID; letter-spacing: -.05em; }
.end .k span { color: #e7a64a; }
.end .s { position: absolute; left: 74px; top: 900px; font: 700 46px/1.4 ID; color: rgba(255,255,255,.85); }
.end .c { position: absolute; left: 70px; top: 1150px; padding: 30px 54px; border-radius: 999px; background: #e7a64a; color: #0f0d0c; font: 900 48px ID; }
.end .a { position: absolute; left: 74px; top: 1310px; font: 700 38px/1.5 ID; color: rgba(255,255,255,.7); }
"""
    ticks = "".join(f'<i class="t" style="top:{780 - k * 130 - 2}px"></i>' for k in range(7))
    body = f"""
<div class="ph" id="before"><img src="photos/ext_avant.jpg"></div>
<div class="ph" id="after"><img src="photos/ext_apres.jpg"></div>
<div class="div"></div><div class="knob">⇆</div>
<div class="lab av">AVANT</div><div class="lab ap">APRÈS</div>
<div class="rule"><div class="bar"><div class="fill"></div></div>{ticks}<div class="n"><span class="num">0</span>"</div><div class="u">pouces</div></div>
<div class="top"><span>Extensions de locks</span><small>6 POUCES</small></div>
<div class="bot">Kadio Coiffure · Longueuil</div>
<div class="end"><div class="k">{sp("Des locks")}<br><span>{sp("en une séance.")}</span></div><div class="s">Extensions de locks · 6 pouces<br>Posées une à une, finition naturelle.</div>
<div class="c">Réserve ta séance</div><div class="a">615, Antoinette-Robidoux · Longueuil<br>514 919-5970 · kadiocoiffure.com</div></div>"""
    js = """
const X = (p) => p * 1080;
function wipe(t, d, a, b, ease) { tl.fromTo("#after", { clipPath: "inset(0 0 0 " + a + "%)" }, { clipPath: "inset(0 0 0 " + b + "%)", duration: d, ease: ease || "power2.inOut", immediateRender: false }, t);
  tl.fromTo(".div, .knob", { left: X(a / 100) }, { left: X(b / 100), duration: d, ease: ease || "power2.inOut", immediateRender: false }, t); }
tl.set("#after", { clipPath: "inset(0 0 0 100%)" }, 0); tl.set(".div, .knob", { left: X(1) }, 0);
kb("#before img", 0, 6, { scale: 1.12 }, { scale: 1.0 });
fin(".top span", .2, .6, { opacity: 0, y: -20 }, { opacity: 1, y: 0, ease: "power3.out" }); fin(".top small", .5, .6, { opacity: 0 }, { opacity: 1 });
fin(".lab.av", .4, .5, { opacity: 0, x: -30 }, { opacity: 1, x: 0, ease: "power3.out" }); cue(.4, "click.wav", .3);
fin(".lab.ap", 2.0, .5, { opacity: 0, x: 30 }, { opacity: 1, x: 0, ease: "power3.out" });
// balayages : aperçu, retour, puis révélation complète
wipe(2.0, 1.2, 100, 50); cue(2.0, "sweep-small.wav", .35);
wipe(3.6, .9, 50, 75); wipe(4.7, .9, 75, 30); cue(4.7, "sweep-small.wav", .3);
wipe(6.0, 1.0, 30, 0, "power3.inOut"); cue(6.0, "whoosh-cine.wav", .35);
tl.to(".div, .knob, .lab.av", { opacity: 0, duration: .3 }, 6.9);
kb("#after img", 6.0, 6.5, { scale: 1.0 }, { scale: 1.12 });
// règle : 0 -> 6 pouces
tl.set(".rule", { autoAlpha: 0 }, 0); tl.set(".rule", { autoAlpha: 1 }, 7.3);
fin(".rule", 7.3, .5, { opacity: 0, x: 40 }, { opacity: 1, x: 0, ease: "power3.out" });
tl.fromTo(".rule .fill", { scaleY: 0 }, { scaleY: 1, duration: 2.2, ease: "power2.inOut", immediateRender: false }, 7.7); tl.set(".rule .fill", { scaleY: 0 }, 0);
for (let k = 0; k <= 6; k++) { tl.set(".rule .num", { textContent: String(k) }, 7.7 + k * 2.2 / 6); if (k) cue(7.7 + k * 2.2 / 6, "fit_tick_domino.wav", .25); }
tl.set(".rule .num", { textContent: "0" }, 0); cue(9.9, "bass.wav", .4);
tl.to(".rule .n", { scale: 1.12, duration: .25, yoyo: true, repeat: 1 }, 9.9);
// fin
const TE = 12.2; show(".end", TE, null); fin(".end", TE, .6, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", ease: "power3.inOut" }); cue(TE, "whoosh-cine.wav", .3);
fin(".end .k .w", TE + .4, .6, { opacity: 0, y: 50 }, { opacity: 1, y: 0, stagger: .06, ease: "power3.out" }); cue(TE + .4, "bass.wav", .35);
fin(".end .s", TE + 1.0, .6, { opacity: 0, y: 20 }, { opacity: 1, y: 0 });
fin(".end .c", TE + 1.4, .5, { scale: 0 }, { scale: 1, ease: "back.out(2.2)" }); cue(TE + 1.4, "pop-bubble.wav", .3);
fin(".end .a", TE + 1.8, .6, { opacity: 0 }, { opacity: 1 });
"""
    open(os.path.join(D, "index.html"), "w").write(page("Extensions de locks", css, body, js, T, ("m1183", 20)))
elif F == "barbproc":
    import soundfile as sf, numpy as np
    VD = os.path.join(R, "vo", "omni")
    VO = json.load(open(os.path.join(VD, "spec_barb.json")))["barbier"]["vo"]
    LEAD, TAIL = .35, .5; SCH, t = [], 0.0
    for i in range(len(VO)):
        src = os.path.join(VD, f"barb_{i}.wav"); shutil.copy(src, os.path.join(D, f"barb_{i}.wav"))
        d = sf.info(src).duration; dur = LEAD + d + TAIL + (2.6 if i == len(VO) - 1 else 0); SCH.append((round(t, 2), round(dur, 2))); t += dur
    T = round(t, 2)
    json.dump([{"t": round(a + LEAD, 2), "file": f"barb_{i}.wav"} for i, (a, _) in enumerate(SCH)], open(os.path.join(D, "vo.json"), "w"))
    subt = lambda x: x.replace("Kadyo", "Kadio").replace("cinquante dollars", "50 $").replace("soixante", "60 $")
    ICON = {
     "talk": '<path d="M20 30 h60 a10 10 0 0 1 10 10 v26 a10 10 0 0 1 -10 10 h-34 l-16 14 v-14 h-10 a10 10 0 0 1 -10 -10 v-26 a10 10 0 0 1 10 -10z"/>',
     "clip": '<rect x="34" y="12" width="32" height="70" rx="10"/><path d="M34 22 h32 M40 12 v-6 M46 12 v-6 M52 12 v-6 M58 12 v-6"/><circle cx="50" cy="60" r="6"/>',
     "guard": '<path d="M20 30 h60 l-8 50 h-44z"/><path d="M30 42 h40 M32 54 h36 M34 66 h32"/>',
     "razor": '<path d="M14 64 l52 -40 l14 14 l-52 40z"/><path d="M66 24 l14 -10"/><path d="M22 70 l44 -34"/>',
     "beard": '<path d="M18 30 q0 50 32 62 q32 -12 32 -62 q-10 18 -32 18 q-22 0 -32 -18z"/>',
     "star": '<path d="M50 10 l11 26 l28 2 l-22 18 l7 28 l-24 -15 l-24 15 l7 -28 l-22 -18 l28 -2z"/>'}
    SC = [dict(k="intro", ti="Un dégradé<br><em>en 5 étapes.</em>", ph="l2"),
          dict(k=1, ti="La consultation", sub="Ta forme de tête, tes épis, ta barbe", ph="b6", ic="talk"),
          dict(k=2, ti="La ligne de base", sub="Tondeuse à zéro, autour des oreilles", ph="b2", ic="clip"),
          dict(k=3, ti="Le dégradé", sub="Sabot après sabot, transition invisible", ph="b8", ic="guard", steps=["0", "0,5", "1", "1,5", "2"]),
          dict(k=4, ti="Le contour", sub="Au rasoir : une ligne nette", ph="l1", ic="razor"),
          dict(k=5, ti="La barbe", sub="Taillée, dessinée, hydratée", ph="b4", ic="beard"),
          dict(k="res", ti="Propre. Net.<br><em>Confiant.</em>", ph="l4"),
          dict(k="end")]
    css = """
@font-face { font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }
@font-face { font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }
#root { background: #111214; color: #fff; font-family: ID; }
.sc { position: absolute; inset: 0; visibility: hidden; }
.bg { position: absolute; inset: 0; overflow: hidden; }
.bg img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 40%; }
.bg:after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(17,18,20,.55) 0%, rgba(17,18,20,0) 28%, rgba(17,18,20,0) 52%, rgba(17,18,20,.92) 78%); }
.card { position: absolute; left: 60px; right: 60px; top: 1160px; padding: 44px 46px; border-radius: 40px; background: rgba(17,18,20,.72); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1.5px solid rgba(255,255,255,.12); }
.num { display: flex; align-items: center; gap: 22px; font: 900 34px ID; letter-spacing: .2em; color: #ff8a3d; }
.ring { width: 96px; height: 96px; flex: none; }
.ring circle { fill: none; stroke-width: 7; } .ring .tr { stroke: rgba(255,255,255,.12); } .ring .pr { stroke: #ff8a3d; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
.ring text { font: 900 30px ID; fill: #fff; }
.ti { margin-top: 24px; font: 900 92px/1 ID; letter-spacing: -.045em; }
.su { margin-top: 16px; font: 700 40px/1.25 ID; color: rgba(255,255,255,.72); letter-spacing: -.01em; }
.ico { position: absolute; right: 46px; top: 40px; width: 110px; height: 110px; color: #ff8a3d; }
.ico path, .ico rect, .ico circle { fill: none; stroke: currentColor; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
.guards { display: flex; gap: 14px; margin-top: 26px; }
.guards span { flex: 1; text-align: center; padding: 14px 0; border-radius: 16px; background: rgba(255,255,255,.08); font: 900 34px ID; }
.big { position: absolute; left: 70px; right: 70px; top: 1180px; font: 900 128px/0.98 ID; letter-spacing: -.05em; }
.big em { font-style: normal; color: #ff8a3d; }
.top { position: absolute; left: 60px; right: 60px; top: 90px; display: flex; justify-content: space-between; align-items: center; font: 900 34px ID; letter-spacing: .12em; z-index: 20; }
.top b { color: #ff8a3d; }
.rail { position: absolute; left: 60px; right: 60px; top: 150px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.15); z-index: 20; overflow: hidden; }
.rail i { position: absolute; inset: 0; background: #ff8a3d; transform-origin: 0 50%; transform: scaleX(0); }
.sub2 { position: absolute; left: 60px; right: 60px; top: 1760px; text-align: center; visibility: hidden; z-index: 30; font: 700 34px/1.35 ID; color: rgba(255,255,255,.85); }
#end { background: #111214; }
.eh { position: absolute; left: 70px; right: 70px; top: 520px; font: 900 120px/1 ID; letter-spacing: -.05em; }
.eh em { font-style: normal; color: #ff8a3d; }
.pr2 { position: absolute; left: 70px; right: 70px; top: 880px; display: grid; gap: 20px; }
.pr2 div { display: flex; justify-content: space-between; padding: 30px 40px; border-radius: 28px; background: rgba(255,255,255,.07); font: 900 52px ID; letter-spacing: -.02em; }
.pr2 b { color: #ff8a3d; }
.ad { position: absolute; left: 70px; right: 70px; top: 1340px; font: 700 40px/1.5 ID; color: rgba(255,255,255,.75); }
.cta { position: absolute; left: 70px; top: 1500px; padding: 30px 56px; border-radius: 999px; background: #ff8a3d; color: #111214; font: 900 48px ID; }
"""
    def ring(k):
        c = 2 * 3.1416 * 40
        return f'<svg class="ring" viewBox="0 0 96 96"><circle class="tr" cx="48" cy="48" r="40"/><circle class="pr" cx="48" cy="48" r="40" stroke-dasharray="{c:.1f}" stroke-dashoffset="{c * (1 - k / 5):.1f}"/><text x="48" y="58" text-anchor="middle">0{k}</text></svg>'
    body = '<div class="top"><span>KADIO · <b>BARBIER</b></span><span id="cnt">00 / 05</span></div><div class="rail"><i></i></div>'
    for i, c in enumerate(SC):
        if c["k"] == "end":
            body += f'''<div id="s{i}" class="sc"><div class="layer" id="end"></div><div class="eh">{sp("Ta coupe,")}<br><em>{sp("ta signature.")}</em></div>
<div class="pr2"><div><span>Coupe</span><b>50 $</b></div><div><span>Coupe + barbe</span><b>60 $</b></div><div><span>Club Kadio</span><b>19,99 $/mois</b></div></div>
<div class="ad">615, Antoinette-Robidoux · Longueuil<br>514 919-5970 · kadiocoiffure.com</div><div class="cta">Réserve ta place</div></div>'''
            continue
        h = f'<div id="s{i}" class="sc"><div class="bg"><img src="photos/{c["ph"]}.jpg"></div>'
        if isinstance(c["k"], int):
            h += f'<div class="card">{f"<svg class=ico viewBox=\"0 0 100 100\">{ICON[c['ic']]}</svg>"}<div class="num">{ring(c["k"])}ÉTAPE 0{c["k"]}</div><div class="ti">{sp(c["ti"])}</div><div class="su">{e(c["sub"])}</div>'
            if c.get("steps"): h += '<div class="guards">' + "".join(f"<span>{s}</span>" for s in c["steps"]) + "</div>"
            h += "</div>"
        else:
            h += f'<div class="big">{c["ti"]}</div>'
        body += h + "</div>"
    body += "".join(f'<div class="sub2" id="u{i}">{e(subt(v))}</div>' for i, v in enumerate(VO)) + '<div class="layer vig"></div>'
    js = "const S = " + json.dumps(SCH) + ", L = " + str(LEAD) + ";\n" + """
const _ex = (q) => typeof q !== "string" || document.querySelector(q);
const _fin = fin, _kb = kb; fin = function (q, ...r) { if (_ex(q)) _fin(q, ...r); }; kb = function (q, ...r) { if (_ex(q)) _kb(q, ...r); };
S.forEach(function (s, i) {
  const p = "#s" + i, t = s[0], d = s[1];
  show(p, t, i === S.length - 1 ? null : t + d + .5); tl.set(p, { zIndex: 5 + i }, 0);
  if (i) { fin(p, t - .05, .55, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", ease: "power4.inOut" }); cue(t - .05, "whoosh-fast.wav", .3); }
  kb(p + " .bg img", t, d + .6, { scale: 1.18 }, { scale: 1.04 });
  fin(p + " .card", t + .3, .7, { opacity: 0, y: 120 }, { opacity: 1, y: 0, ease: "power3.out" });
  fin(p + " .ring .pr", t + .6, .8, { strokeDasharray: "0 999" }, { strokeDasharray: "251.3 999", ease: "power2.out" });
  fin(p + " .ico", t + .7, .6, { scale: 0, rotate: -40 }, { scale: 1, rotate: 0, ease: "back.out(2)" }); if (document.querySelector(p + " .ico")) cue(t + .7, "click.wav", .3);
  fin(p + " .ti .w", t + .5, .6, { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: .06, ease: "power3.out" });
  fin(p + " .su", t + .9, .6, { opacity: 0 }, { opacity: 1 });
  document.querySelectorAll(p + " .guards span").forEach(function (g, k) { const tt = t + 1.4 + k * Math.max(.35, (d - 2) / 5);
    fin(g, tt, .35, { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: "back.out(2)" }); tl.set(g, { backgroundColor: "#ff8a3d", color: "#111214" }, tt); tl.set(g, { backgroundColor: "rgba(255,255,255,.08)", color: "#fff" }, 0); cue(tt, "fit_tick_domino.wav", .25); });
  fin(p + " .big .w, " + p + " .big em", t + .4, .7, { opacity: 0, y: 60 }, { opacity: 1, y: 0, stagger: .08, ease: "power3.out" });
  fin(p + " .eh .w", t + .4, .6, { opacity: 0, y: 50 }, { opacity: 1, y: 0, stagger: .06, ease: "power3.out" });
  document.querySelectorAll(p + " .pr2 div").forEach(function (r, k) { fin(r, t + 1.1 + k * .25, .5, { opacity: 0, x: -60 }, { opacity: 1, x: 0, ease: "power3.out" }); cue(t + 1.1 + k * .25, "pop-bubble.wav", .2); });
  fin(p + " .ad", t + 2, .6, { opacity: 0 }, { opacity: 1 }); fin(p + " .cta", t + 2.3, .5, { scale: 0 }, { scale: 1, ease: "back.out(2.2)" });
  show("#u" + i, t + L, t + d - .05); fin("#u" + i, t + L, .3, { opacity: 0 }, { opacity: 1 });
});
for (let k = 1; k <= 5; k++) { tl.set("#cnt", { textContent: "0" + k + " / 05" }, S[k][0]); tl.to(".rail i", { scaleX: k / 5, duration: .6, ease: "power2.out" }, S[k][0] + .2); }
tl.set("#cnt", { textContent: "00 / 05" }, 0); tl.to(".top, .rail", { opacity: 0, duration: .4 }, S[S.length - 1][0]);
// habillage sonore : vrais bruitages de barbier, calés sur chaque étape
cue(S[2][0] + 1.0, "tondeuse.wav", .55); cue(S[3][0] + 1.0, "tondeuse.wav", .5); cue(S[3][0] + 2.6, "tondeuse.wav", .45);
cue(S[4][0] + 1.0, "tondeuse.wav", .35); cue(S[5][0] + .9, "ciseaux.wav", .55); cue(S[5][0] + 1.9, "ciseaux.wav", .45);
cue(S[6][0] + .3, "sparkle.wav", .35);
cue(S[S.length - 1][0] + .4, "bass.wav", .35);
"""
    open(os.path.join(D, "index.html"), "w").write(page("Le dégradé en 5 étapes", css, body, js, T, ("m1183", 40)))
elif F in ("barbedit", "barbedit2"):
    # Style « montage 5 € » : texte cinétique mot à mot calé sur la voix, coupes rapides, aplats rouge / blanc, serif italique
    import soundfile as sf
    VD = os.path.join(R, "vo", "omni")
    WORDS = json.load(open(os.path.join(VD, "barb_words.json")))
    LEAD, TAIL = .35, .35; VS, t = [], 0.0
    for i in range(len(WORDS)):
        src = os.path.join(VD, f"barb_{i}.wav"); shutil.copy(src, os.path.join(D, f"barb_{i}.wav"))
        d = sf.info(src).duration; VS.append(round(t + LEAD, 2)); t += LEAD + d + TAIL
    TEND = round(t + .1, 2); T = round(TEND + 4.2, 2)
    json.dump([{"t": v, "file": f"barb_{i}.wav"} for i, v in enumerate(VS)], open(os.path.join(D, "vo.json"), "w"))
    SPEC = [
     "[p:l2:bw] Un/s dégradé/I | [red] chez/s Kadio/B Coiffure/s | [white] ça/s se/s passe/s en/s cinq=5/G étapes/i | [p:b1] regarde/B",
     "[p:b6] D'abord/s on/s discute/I | [p:b6:bw] tu/s me/s montres/s ce/s que/s tu/s veux/B | [white] et/s on/s regarde/s ta/s forme/I de/s tête/B | [red] tes/s épis/B ta/s barbe/I",
     "[p:b2] Ensuite/s la/s ligne/s de/s base/I | [red] tondeuse/s à/s zéro=0/G | [p:b3:bw] en/s bas/B autour/s des/s oreilles/B | [white] et/s sur/s la/s nuque/I",
     "[red] Puis/s le/s dégradé/B | [p:b8] on/s remonte/s petit/s à/s petit/I | [white] sabot/B après/s sabot/B | [p:b8:bw] pour/s que/s la/s transition/s soit/s invisible/I",
     "[p:l1] Après/s le/s contour/I | [p:l1:bw] Au/s rasoir/B | [white] une/s ligne/s nette/B précise/I | [red] C'est/s ça/s la/s signature/I Kadio/B",
     "[p:b4] Et/s pour/s finir/s la/s barbe/I | [red] on/s la/s taille/B | [white] on/s la/s dessine/I | [p:b5] on/s l'hydrate/B",
     "[white] Résultat/s | [red] propre=Propre./G | [p:l4:bw] net=Net./G | [p:l4] et/s tu/s repars/s avec/s confiance/I",
     "[white] Coupe/s cinquante=50_$/G dollars=/x | [red] Coupe/s et/s barbe/s soixante=60_$/G | [p:l2:bw] Réserve/s ta/s place/B chez/s Kadio/I Coiffure/s à/s Longueuil/B"]
    SPEC2 = [
     "[v:barbier] Un/s dégradé/I | [red] chez/s Kadio/B Coiffure/s | [v:4326:bw] ça/s se/s passe/s en/s cinq=5/G étapes/i | [v:regarder] regarde/B",
     "[v:21296] D'abord/s on/s discute/I | [p:b6:bw] tu/s me/s montres/s ce/s que/s tu/s veux/B | [v:50756] et/s on/s regarde/s ta/s forme/I de/s tête/B | [red] tes/s épis/B ta/s barbe/I",
     "[p:b2] Ensuite/s la/s ligne/s de/s base/I | [v:47845:bw] tondeuse/s à/s zéro=0/G | [white] en/s bas/B autour/s des/s oreilles/B | [p:b3] et/s sur/s la/s nuque/I",
     "[red] Puis/s le/s dégradé/B | [v:monter] on/s remonte/s petit/s à/s petit/I | [p:b8:bw] sabot/B après/s sabot/B | [v:45298] pour/s que/s la/s transition/s soit/s invisible/I",
     "[v:40127] Après/s le/s contour/I | [p:l1:bw] Au/s rasoir/B | [white] une/s ligne/s nette/B précise/I | [v:signature] C'est/s ça/s la/s signature/I Kadio/B",
     "[v:47603] Et/s pour/s finir/s la/s barbe/I | [v:13122:bw] on/s la/s taille/B | [white] on/s la/s dessine/I | [v:50426] on/s l'hydrate/B",
     "[white] Résultat/s | [v:46316] propre=Propre./G | [p:l4:bw] net=Net./G | [v:confiance] et/s tu/s repars/s avec/s confiance/I",
     "[v:18296] Coupe/s cinquante=50_$/G dollars=/x | [red] Coupe/s et/s barbe/s soixante=60_$/G | [v:49878:bw] Réserve/s ta/s place/B chez/s Kadio/I Coiffure/s à/s Longueuil/B"]
    PAL = dict(a1="#f0505c", a2="#c8102e", a3="#8e0016", ai="#e0132b", ap="#ff2b40", as_="#9c0b20")
    PAL["as"] = PAL.pop("as_")
    if F == "barbedit2":
        PAL = {"a1": "#ffb15c", "a2": "#ff6a1a", "a3": "#b8360a", "ai": "#ff6a1a", "ap": "#ff8a3d", "as": "#b8460f"}
        SPEC = SPEC2
    def fit(st, txt):
        n = max(len(txt), 1)
        return {"s": 50, "i": 64, "B": min(160, int(1700 / n)), "I": min(190, int(2000 / n)), "G": min(400, int(1500 / n))}[st]
    shots = []
    for i, line in enumerate(SPEC):
        W = WORDS[i]; k = 0
        for part in line.split("|"):
            part = part.strip(); bg, toks = part[1:part.index("]")], part[part.index("]") + 1:].split()
            items = []
            for tk in toks:
                w, st = tk.rsplit("/", 1); disp = (w.split("=", 1)[1] if "=" in w else w).replace("_", " ")
                tt = round(VS[i] + W[k][1], 2); k += 1
                items.append((disp, st, tt))
            shots.append(dict(bg=bg, items=items, t=items[0][2] if shots else 0.0))
        assert k == len(W), (i, k, len(W))
    for j, s in enumerate(shots): s["end"] = shots[j + 1]["t"] if j + 1 < len(shots) else TEND
    css = """
@font-face { font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }
@font-face { font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }
@font-face { font-family: BD; src: url(fonts/bodoni-moda-latin-700-italic.woff2); font-weight: 700; font-style: italic; }
#root { --a1: %(a1)s; --a2: %(a2)s; --a3: %(a3)s; --ai: %(ai)s; --ap: %(ap)s; --as: %(as_)s; background: #000; color: #fff; font-family: ID; }
.shot { position: absolute; inset: 0; visibility: hidden; overflow: hidden; }
.shot.red { background: radial-gradient(120% 90% at 20% 15%, var(--a1) 0%, var(--a2) 45%, var(--a3) 100%); }
.shot.white { background: #fff; color: var(--a2); }
.shot .pic { position: absolute; inset: -2%; width: 104%; height: 104%; object-fit: cover; }
.shot.bw .pic { filter: grayscale(1) contrast(1.25) brightness(.9); }
.v { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.v.bw { filter: grayscale(1) contrast(1.25) brightness(.9); }
.shot.vid { background: transparent; }
.shot.photo:after { content: ""; position: absolute; inset: 0; background: radial-gradient(80% 60% at 50% 50%, rgba(0,0,0,.05), rgba(0,0,0,.55)); }
.stk { position: absolute; left: 50px; right: 50px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; text-align: center; z-index: 3; }
.ln { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; line-height: .95; }
.wd { display: inline-block; opacity: 0; white-space: nowrap; margin: 0 .13em; }
.photo .wd { text-shadow: 0 4px 30px rgba(0,0,0,.55); }
.s { font-weight: 700; letter-spacing: -.01em; }
.B, .G { font-weight: 900; letter-spacing: -.045em; }
.G { line-height: .85; }
.I, .i { font-family: BD; font-style: italic; font-weight: 700; letter-spacing: -.02em; }
.photo .I, .white .I, .white .G, .white .B, .photo .i, .white .i { color: var(--ai); }
.photo .I { color: var(--ap); }
.red .I, .red .i { color: #fff; }
.white .s { color: var(--as); }
#flash { position: absolute; inset: 0; background: #fff; opacity: 0; z-index: 50; }
#end { position: absolute; inset: 0; visibility: hidden; z-index: 40; background: radial-gradient(120% 90% at 20% 15%, var(--a1) 0%, var(--a2) 45%, var(--a3) 100%); }
#end .k { position: absolute; left: 0; right: 0; top: 560px; text-align: center; font: 900 150px/0.95 ID; letter-spacing: -.05em; }
#end .k em { display: block; font: italic 700 170px BD; letter-spacing: -.02em; }
#end .pr { position: absolute; left: 90px; right: 90px; top: 1000px; display: flex; gap: 24px; }
#end .pr div { flex: 1; padding: 30px 0; border-radius: 28px; background: #fff; color: var(--a2); text-align: center; font: 900 46px/1.2 ID; }
#end .pr small { display: block; font: 700 30px ID; color: var(--as); }
#end .a { position: absolute; left: 0; right: 0; top: 1300px; text-align: center; font: 700 40px/1.55 ID; color: rgba(255,255,255,.88); }
"""
    css = css.replace("%(a1)s", PAL["a1"]).replace("%(a2)s", PAL["a2"]).replace("%(a3)s", PAL["a3"]).replace("%(ai)s", PAL["ai"]).replace("%(ap)s", PAL["ap"]).replace("%(as_)s", PAL["as"])
    LIB = os.path.join(R, "..", "..", "bibliotheque"); LX = json.load(open(os.path.join(LIB, "index.json"))) if os.path.exists(os.path.join(LIB, "index.json")) else {"mots": {}}
    os.makedirs(os.path.join(D, "clips"), exist_ok=True); vids, used = [], set()
    def pick(m):
        if m.isdigit(): return m
        c = [v for v in LX["mots"].get(m, []) if os.path.exists(os.path.join(LIB, "clips", v + ".mp4"))]
        f = [v for v in c if v not in used] or c
        assert f, "aucun plan pour " + m
        used.add(f[0]); return f[0]
    body = ""
    for j, s in enumerate(shots):
        parts = s["bg"].split(":"); cls = "photo" if parts[0] == "p" else parts[0]
        if "bw" in parts: cls += " bw"
        if parts[0] == "v": cls = "photo vid" + (" bw" if "bw" in parts else "")
        h = f'<div class="shot {cls}" id="h{j}">' + (f'<img class="pic" src="photos/{parts[1]}.jpg">' if parts[0] == "p" else "")
        if parts[0] == "v":
            cid = pick(parts[1]); shutil.copy(os.path.join(LIB, "clips", cid + ".mp4"), os.path.join(D, "clips", cid + ".mp4"))
            vids.append((j, cid, s["t"], round(s["end"] - s["t"] + .05, 2), "bw" in parts))
        lines, cur = [], None
        for n, (disp, st, tt) in enumerate(s["items"]):
            if st == "x": continue
            if cur is None or st != cur[0] or st in "BIG": cur = [st, []]; lines.append(cur)
            cur[1].append((n, disp, st))
        h += '<div class="stk">' + "".join('<div class="ln">' + "".join(f'<span class="wd {st}" id="h{j}w{n}" style="font-size:{fit(st, disp)}px">{e(disp)}</span>' for n, disp, st in ws) + "</div>" for st, ws in lines) + "</div></div>"
        body += h
    body = "".join(f'<video id="vv{j}" class="v clip{" bw" if bw else ""}" src="clips/{cid}.mp4" muted playsinline data-start="{st}" data-duration="{du}" data-track-index="{k % 2}" style="z-index:{2 + j}"></video>' for k, (j, cid, st, du, bw) in enumerate(vids)) + body
    body += f'''<div id="end"><div class="k">Kadio Coiffure<em>Barbier.</em></div>
<div class="pr"><div>50 $<small>Coupe</small></div><div>60 $<small>Coupe + barbe</small></div></div>
<div class="a">615, Antoinette-Robidoux · Longueuil<br>514 919-5970 · kadiocoiffure.com</div></div><div id="flash"></div>'''
    SH = [dict(t=s["t"], end=s["end"], ph=s["bg"].startswith("p"), w=[(n, st, tt) for n, (d_, st, tt) in enumerate(s["items"]) if st != "x"]) for s in shots]
    js = "const SH = " + json.dumps(SH) + ", TE = " + str(TEND) + ";\n" + """
SH.forEach(function (s, j) {
  const p = "#h" + j; show(p, s.t, s.end); tl.set(p, { zIndex: 2 + j }, 0);
  if (j) { tl.fromTo(p, { scale: 1.08 }, { scale: 1, duration: .28, ease: "power3.out", immediateRender: false }, s.t); }
  if (s.ph) kb(p + " .pic", s.t, s.end - s.t + .1, { scale: 1.0 }, { scale: 1.1 });
  if (j && j % 3 === 0) cue(s.t - .03, "whoosh-fast.wav", .16); else if (j) cue(s.t, "click.wav", .1);
  s.w.forEach(function (w) { const q = p + "w" + w[0], big = w[1] !== "s" && w[1] !== "i";
    tl.fromTo(q, { opacity: 0, scale: big ? 1.35 : 1.15, filter: big ? "blur(10px)" : "blur(0px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: big ? .2 : .1, ease: "power3.out", immediateRender: false }, w[2]);
    tl.set(q, { opacity: 0 }, 0);
    if (w[1] === "G") { cue(w[2], "cut_hit_sub.wav", .35); tl.fromTo("#flash", { opacity: .55 }, { opacity: 0, duration: .25, immediateRender: false }, w[2]); }
  });
});
tl.set("#flash", { opacity: 0 }, 0);
show("#end", TE, null); fin("#end", TE, .45, { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", ease: "power4.inOut" }); cue(TE, "whoosh-cine.wav", .3);
fin("#end .k", TE + .3, .5, { opacity: 0, scale: 1.2, filter: "blur(12px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", ease: "power3.out" }); cue(TE + .3, "bass.wav", .35);
fin("#end .pr div", TE + .9, .4, { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: .15, ease: "back.out(2)" }); cue(TE + .9, "pop-bubble.wav", .22);
fin("#end .a", TE + 1.4, .5, { opacity: 0 }, { opacity: 1 });
const _V = JSON.parse('""" + json.dumps(VS) + """');
cue(_V[2] + 1.4, "tondeuse.wav", .4); cue(_V[3] + 1.6, "tondeuse.wav", .35); cue(_V[5] + 1.6, "ciseaux.wav", .45); cue(_V[6] + .5, "sparkle.wav", .3);
"""
    open(os.path.join(D, "index.html"), "w").write(page("Barbier, montage dynamique", css, body, js, T, ("m839", 0) if F == "barbedit2" else ("m1183", 40)))
elif F in ("talk1", "talk2"):
    # Style « montage dynamique » sur une vidéo face caméra (la vraie voix de la personne)
    import subprocess
    RU = os.path.join(R, "rushs"); W = json.load(open(os.path.join(RU, F + "_words.json")))
    shutil.copy(os.path.join(RU, F + ".mp4"), os.path.join(D, "base.mp4"))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(RU, F + ".mp4"), "-vn", "-af", "highpass=f=80,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=9", "-ar", "48000", "-ac", "1", os.path.join(D, "talk.wav")], check=True)
    DUR = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(RU, F + ".mp4")]).strip())
    json.dump([{"t": 0, "file": "talk.wav"}], open(os.path.join(D, "vo.json"), "w"))
    TEND = round(DUR - .15, 2); T = round(TEND + 3.4, 2)
    if F == "talk1":
        SPEC = "[talk] Nos/s formules/s d'entretien/I de/s LOX=locks/B | [acc] commencent/s à/s 65=65_$/G $=/x | [talk:z] et/s bien/s sûr/s les/s places/s sont/s limitées/I"
        PAL = {"a1": "#2f8f6e", "a2": "#0f5c45", "a3": "#062e22", "ai": "#e8b04a", "ap": "#f3c76a", "as": "#0f5c45"}
        SERIF = "fonts/cormorant-garamond-latin-600-italic.woff2"; MUS = ("m744", 0)
        END = ('Entretien <em>locks.</em>', [("65 $", "par mois"), ("Club Kadio", "abonnement")], "Places limitées · Réserve ta place")
    else:
        SPEC = "[talk] Est-ce/s que/s je/s dois/s m'abonner/I avant/s de/s venir/s ?=/x | [talk:z] Pas/s nécessairement/B | [acc] c'est/s une/s option/I | [talk] Un/s abonnement/s reste/s une/s option/I"
        PAL = {"a1": "#5b7bff", "a2": "#1f3cff", "a3": "#0a1a8f", "ai": "#1f3cff", "ap": "#9fb3ff", "as": "#1f3cff"}
        SERIF = "fonts/bodoni-moda-latin-700-italic.woff2"; MUS = ("m324", 0)
        END = ('Sans <em>obligation.</em>', [("19,99 $", "coupe + barbe /mois"), ("65 $", "entretien locks /mois")], "Viens comme tu es · Abonne-toi si tu veux")
    def fit(st, txt):
        n = max(len(txt), 1)
        return {"s": 58, "i": 64, "B": min(96, int(1500 / n)), "I": min(108, int(1700 / n)), "G": min(300, int(1300 / n))}[st]
    shots, k = [], 0
    for part in SPEC.split("|"):
        part = part.strip(); bg, toks = part[1:part.index("]")], part[part.index("]") + 1:].split(); items = []
        for tk in toks:
            w, st = tk.rsplit("/", 1); disp = (w.split("=", 1)[1] if "=" in w else w).replace("_", " ")
            items.append((disp, st, round(W[k][1], 2))); k += 1
        shots.append(dict(bg=bg, items=items, t=items[0][2] if shots else 0.0))
    assert k == len(W), (k, len(W))
    for j, s in enumerate(shots): s["end"] = shots[j + 1]["t"] if j + 1 < len(shots) else TEND
    LIB = os.path.join(R, "..", "..", "bibliotheque"); os.makedirs(os.path.join(D, "clips"), exist_ok=True)
    css = """
@font-face { font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }
@font-face { font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }
@font-face { font-family: SR; src: url(%SERIF%); font-weight: 700; font-style: italic; }
#root { background: #000; color: #fff; font-family: ID; }
#bw { position: absolute; inset: 0; overflow: hidden; z-index: 1; transform-origin: 50% 28%; }
#bw .v, .v { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.v.gray { filter: grayscale(1) contrast(1.25) brightness(.9); }
.shot { position: absolute; inset: 0; visibility: hidden; overflow: hidden; }
.shot.acc { background: radial-gradient(120% 90% at 20% 15%, %a1% 0%, %a2% 45%, %a3% 100%); }
.shot.white { background: #fff; color: %a2%; }
.shot.talk .stk { top: 74%; }
.shot.talk:after, .shot.vid:after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,.45) 85%); z-index: 1; }
.stk { position: absolute; left: 50px; right: 50px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; text-align: center; z-index: 3; }
.ln { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; line-height: 1.12; max-width: 900px; }
.wd { display: inline-block; opacity: 0; white-space: nowrap; margin: 0 .13em; }
.talk .wd, .vid .wd { text-shadow: 0 4px 30px rgba(0,0,0,.6); }
.s { font-weight: 700; letter-spacing: -.01em; }
.B, .G { font-weight: 900; letter-spacing: -.045em; }
.G { line-height: .85; }
.I, .i { font-family: SR; font-style: italic; font-weight: 700; letter-spacing: -.01em; }
.talk .I, .vid .I, .talk .i { color: %ap%; }
.white .I, .white .G, .white .B, .white .i { color: %ai%; }
.white .s { color: %as%; }
.acc .I, .acc .i { color: #fff; }
#flash { position: absolute; inset: 0; background: #fff; opacity: 0; z-index: 60; }
#end { position: absolute; inset: 0; visibility: hidden; z-index: 50; background: radial-gradient(120% 90% at 20% 15%, %a1% 0%, %a2% 45%, %a3% 100%); }
#end .k { position: absolute; left: 0; right: 0; top: 520px; text-align: center; font: 900 120px/1 ID; letter-spacing: -.05em; }
#end .k em { display: block; font: italic 700 170px SR; letter-spacing: -.01em; color: %ap%; }
#end .pr { position: absolute; left: 80px; right: 80px; top: 960px; display: flex; gap: 24px; }
#end .pr div { flex: 1; padding: 30px 0; border-radius: 28px; background: #fff; color: %a2%; text-align: center; font: 900 58px/1.15 ID; }
#end .pr small { display: block; font: 700 28px ID; color: %a3%; }
#end .n { position: absolute; left: 0; right: 0; top: 1240px; text-align: center; font: 700 42px ID; }
#end .a { position: absolute; left: 0; right: 0; top: 1360px; text-align: center; font: 700 38px/1.55 ID; color: rgba(255,255,255,.85); }
#end .logo { position: absolute; left: 0; right: 0; top: 380px; text-align: center; font: 900 40px ID; letter-spacing: .3em; }
"""
    for kk, v in PAL.items(): css = css.replace("%" + kk + "%", v)
    css = css.replace("%SERIF%", SERIF)
    body = f'<div id="bw"><video id="base" class="v clip" src="base.mp4" muted playsinline data-start="0" data-duration="{TEND}" data-track-index="0"></video></div>'
    vids = []
    for j, s in enumerate(shots):
        parts = s["bg"].split(":"); cls = {"talk": "talk", "acc": "acc", "white": "white", "v": "vid"}[parts[0]]
        if parts[0] == "v":
            cid = parts[1]; shutil.copy(os.path.join(LIB, "clips", cid + ".mp4"), os.path.join(D, "clips", cid + ".mp4"))
            body += f'<video id="vv{j}" class="v clip{" gray" if "bw" in parts else ""}" src="clips/{cid}.mp4" muted playsinline data-start="{s["t"]}" data-duration="{round(s["end"] - s["t"] + .05, 2)}" data-track-index="{1 + len(vids) % 2}" style="z-index:{5 + j}"></video>'
            vids.append(j)
        lines, cur = [], None
        for n, (disp, st, tt) in enumerate(s["items"]):
            if st == "x": continue
            if cur is None or (st == "G"): cur = [st, []]; lines.append(cur)  # version calme : une seule ligne qui se remplit
            cur[1].append((n, disp, st))
        body += f'<div class="shot {cls}" id="h{j}" style="z-index:{5 + j}"><div class="stk">' + "".join('<div class="ln">' + "".join(f'<span class="wd {st}" id="h{j}w{n}" style="font-size:{fit(st, disp)}px">{e(disp)}</span>' for n, disp, st in ws) + "</div>" for st, ws in lines) + "</div></div>"
    body += f'''<div id="end"><div class="logo">KADIO COIFFURE</div><div class="k">{END[0]}</div><div class="pr">{"".join(f"<div>{a}<small>{b}</small></div>" for a, b in END[1])}</div>
<div class="n">{END[2]}</div><div class="a">615, Antoinette-Robidoux · Longueuil<br>514 919-5970 · kadiocoiffure.com</div></div><div id="flash"></div>'''
    SH = [dict(t=s["t"], end=s["end"], bg=s["bg"], w=[(n, st, tt) for n, (d_, st, tt) in enumerate(s["items"]) if st != "x"]) for s in shots]
    js = "const SH = " + json.dumps(SH) + ", TE = " + str(TEND) + ";\n" + """
SH.forEach(function (s, j) {
  const p = "#h" + j, b = s.bg.split(":"); show(p, s.t, s.end);
  if (b[0] === "talk") { tl.set("#bw", { scale: b.indexOf("z") > 0 ? 1.32 : 1.0 }, s.t); tl.set("#base", { filter: b.indexOf("bw") > 0 ? "grayscale(1) contrast(1.25) brightness(.9)" : "none" }, s.t); }
  if (j && b[0] !== "talk") { fin(p, s.t, .25, { opacity: 0 }, { opacity: 1, ease: "power2.out" }); cue(s.t - .03, "whoosh-fast.wav", .12); }
  s.w.forEach(function (w) { const q = p + "w" + w[0], big = w[1] !== "s" && w[1] !== "i";
    tl.fromTo(q, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .18, ease: "power2.out", immediateRender: false }, w[2]);
    tl.set(q, { opacity: 0 }, 0);
    if (w[1] === "G") cue(w[2], "bass.wav", .22);
  });
});
tl.set("#flash", { opacity: 0 }, 0); tl.set("#bw", { scale: 1 }, 0);
show("#end", TE, null); fin("#end", TE, .45, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", ease: "power4.inOut" }); cue(TE, "whoosh-cine.wav", .3);
fin("#end .logo", TE + .3, .4, { opacity: 0 }, { opacity: 1 });
fin("#end .k", TE + .35, .5, { opacity: 0, scale: 1.2, filter: "blur(12px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", ease: "power3.out" }); cue(TE + .35, "bass.wav", .35);
fin("#end .pr div", TE + .9, .4, { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: .15, ease: "back.out(2)" }); cue(TE + .9, "pop-bubble.wav", .22);
fin("#end .n", TE + 1.3, .4, { opacity: 0 }, { opacity: 1 }); fin("#end .a", TE + 1.6, .5, { opacity: 0 }, { opacity: 1 });
"""
    open(os.path.join(D, "index.html"), "w").write(page("Kadio, montage face caméra", css, body, js, T, MUS))
elif F.startswith("serv_"):
    # Série services : style « montage dynamique » validé, une voix, palette + musique propres à chaque vidéo
    import soundfile as sf, subprocess, difflib, re
    K = F[5:]; VD = os.path.join(R, "vo", "serie"); CF = json.load(open(os.path.join(VD, "config.json")))[K]
    SCRIPT = json.load(open(os.path.join(VD, "scripts.json")))[K]
    norm = lambda w: re.sub(r"[^\w'-]", "", w.lower())
    NUM = {"soixante": "60", "soixante-cinq": "65", "cinquante-cinq": "55", "cinquante": "50", "dollars": "$"}
    WJ = os.path.join(VD, K + "_words.json")
    if not os.path.exists(WJ):
        allw = []
        for i in range(len(SCRIPT)):
            tmp = os.path.join(VD, f"_w{i}"); subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(VD, f"{K}_{i}.wav"), "-ar", "16000", "-ac", "1", tmp + ".wav"], check=True)
            subprocess.run(["whisper-cli", "-m", "/root/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin", "-l", "fr", "-ml", "1", "-sow", "-oj", "-of", tmp, "-np", "-t", "4", "-f", tmp + ".wav"], capture_output=True)
            j = json.load(open(tmp + ".json")); allw.append([[s["text"].strip(), s["offsets"]["from"] / 1000] for s in j["transcription"] if s["text"].strip()])
            os.remove(tmp + ".wav"); os.remove(tmp + ".json")
        json.dump(allw, open(WJ, "w"), ensure_ascii=False)
    WORDS = json.load(open(WJ))
    LEAD, TAIL = .35, .4; VS, t = [], 0.0
    for i in range(len(SCRIPT)):
        src = os.path.join(VD, f"{K}_{i}.wav"); shutil.copy(src, os.path.join(D, f"v_{i}.wav"))
        d = sf.info(src).duration; VS.append(round(t + LEAD, 2)); t += LEAD + d + TAIL
    TEND = round(t + .1, 2); T = round(TEND + (4.4 if CF.get("fx") else 3.6), 2)
    json.dump([{"t": v, "file": f"v_{i}.wav"} for i, v in enumerate(VS)], open(os.path.join(D, "vo.json"), "w"))
    def times(i, toks):
        W = WORDS[i]; a = [NUM.get(norm(x), norm(x)) for x in toks]; b = [norm(w) for w, _ in W]
        out = [None] * len(a)
        for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
            for q in range(blk.size): out[blk.a + q] = W[blk.b + q][1]
        known = [(q, v) for q, v in enumerate(out) if v is not None] or [(0, 0.0)]
        for q in range(len(out)):
            if out[q] is None:
                prv = [x for x in known if x[0] < q]; nxt = [x for x in known if x[0] > q]
                if prv and nxt: out[q] = prv[-1][1] + (nxt[0][1] - prv[-1][1]) * (q - prv[-1][0]) / (nxt[0][0] - prv[-1][0])
                elif prv: out[q] = prv[-1][1] + .25 * (q - prv[-1][0])
                else: out[q] = max(0.0, nxt[0][1] - .25 * (nxt[0][0] - q))
        for q in range(1, len(out)): out[q] = max(out[q], out[q - 1])
        return out
    def fit(st, txt):
        n = max(len(txt), 1)
        return {"s": 50, "i": 64, "B": min(160, int(1700 / n)), "I": min(190, int(2000 / n)), "G": min(400, int(1500 / n))}[st]
    shots = []
    for i, line in enumerate(CF["spec"]):
        parts = [p.strip() for p in line.split("|")]
        alltoks = [tk for p in parts for tk in p[p.index("]") + 1:].split()]
        tt = times(i, [tk.rsplit("/", 1)[0].split("=")[0] for tk in alltoks]); k = 0
        for p in parts:
            bg, toks = p[1:p.index("]")], p[p.index("]") + 1:].split(); items = []
            for tk in toks:
                w, st = tk.rsplit("/", 1); disp = (w.split("=", 1)[1] if "=" in w else w).replace("_", " ")
                items.append((disp, st, round(VS[i] + tt[k], 2))); k += 1
            shots.append(dict(bg=bg, items=items, t=items[0][2] if shots else 0.0))
    for j, s in enumerate(shots): s["end"] = shots[j + 1]["t"] if j + 1 < len(shots) else TEND
    a1, a2, a3, ai, ap, as_ = CF["pal"]
    css = f"""
@font-face {{ font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }}
@font-face {{ font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }}
@font-face {{ font-family: SR; src: url(fonts/{CF['serif']}); font-weight: 700; font-style: italic; }}
#root {{ background: #000; color: #fff; font-family: ID; }}
.shot {{ position: absolute; inset: 0; visibility: hidden; overflow: hidden; }}
.shot.acc {{ background: radial-gradient(120% 90% at 20% 15%, {a1} 0%, {a2} 45%, {a3} 100%); }}
.shot.white {{ background: #fff; color: {a2}; }}
.shot .pic {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }}
.shot.bw .pic {{ filter: grayscale(1) contrast(1.25) brightness(.9); }}
.shot.photo:after, .shot.vid:after {{ content: ""; position: absolute; inset: 0; background: radial-gradient(80% 60% at 50% 50%, rgba(0,0,0,.08), rgba(0,0,0,.55)); z-index: 1; }}
.shot.vid {{ background: transparent; }}
.v {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }}
.v.gray {{ filter: grayscale(1) contrast(1.25) brightness(.9); }}
.stk {{ position: absolute; left: 50px; right: 50px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; text-align: center; z-index: 3; }}
.ln {{ display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; line-height: .95; }}
.wd {{ display: inline-block; opacity: 0; white-space: nowrap; margin: 0 .13em; }}
.photo .wd, .vid .wd {{ text-shadow: 0 4px 30px rgba(0,0,0,.6); }}
.s {{ font-weight: 700; letter-spacing: -.01em; }}
.B, .G {{ font-weight: 900; letter-spacing: -.045em; }}
.G {{ line-height: .85; }}
.I, .i {{ font-family: SR; font-style: italic; font-weight: 700; letter-spacing: -.01em; }}
.photo .I, .vid .I, .photo .i, .vid .i {{ color: {ap}; }}
.white .I, .white .G, .white .B, .white .i {{ color: {ai}; }}
.white .s {{ color: {as_}; }}
.acc .I, .acc .i {{ color: #fff; }}
#flash {{ position: absolute; inset: 0; background: #fff; opacity: 0; z-index: 60; }}
#end {{ position: absolute; inset: 0; visibility: hidden; z-index: 50; background: radial-gradient(120% 90% at 20% 15%, {a1} 0%, {a2} 45%, {a3} 100%); }}
#end .logo {{ position: absolute; left: 0; right: 0; top: 400px; text-align: center; font: 900 40px ID; letter-spacing: .3em; }}
#end .k {{ position: absolute; left: 0; right: 0; top: 530px; text-align: center; font: 900 150px/0.95 ID; letter-spacing: -.05em; }}
#end .k em {{ display: block; font: italic 700 170px SR; letter-spacing: -.01em; color: #fff; }}
#end .pr {{ position: absolute; left: 90px; right: 90px; top: 1000px; display: flex; gap: 24px; }}
#end .pr div {{ flex: 1; padding: 30px 0; border-radius: 28px; background: #fff; color: {a2}; text-align: center; font: 900 54px/1.15 ID; }}
#end .pr small {{ display: block; font: 700 28px ID; color: {a3}; }}
#end .a {{ position: absolute; left: 0; right: 0; top: 1300px; text-align: center; font: 700 40px/1.55 ID; color: rgba(255,255,255,.9); }}
"""
    FXD = os.path.join(R, "..", "effets")
    if CF.get("fx"): css += open(os.path.join(FXD, "effets.css")).read()
    LIB = os.path.join(R, "..", "..", "bibliotheque"); os.makedirs(os.path.join(D, "clips"), exist_ok=True)
    body, vids = "", []
    for j, s in enumerate(shots):
        parts = s["bg"].split(":"); kind = parts[0]
        cls = {"p": "photo", "v": "vid", "acc": "acc", "white": "white"}[kind] + (" bw" if "bw" in parts else "")
        h = f'<div class="shot {cls}" id="h{j}" style="z-index:{5 + j}">'
        if kind == "p":
            fx = next((x[2:] for x in parts if x.startswith("f=")), "50,50,1").split(",")
            h += f'<img class="pic" src="photos/{parts[1]}.jpg" style="object-position:{fx[0]}% {fx[1]}%;transform-origin:{fx[0]}% {fx[1]}%" data-s="{fx[2]}">'
        if kind == "v":
            cid = parts[1]; shutil.copy(os.path.join(LIB, "clips", cid + ".mp4"), os.path.join(D, "clips", cid + ".mp4"))
            body += f'<video id="vv{j}" class="v clip{" gray" if "bw" in parts else ""}" src="clips/{cid}.mp4" muted playsinline data-start="{s["t"]}" data-duration="{round(s["end"] - s["t"] + .05, 2)}" data-track-index="{len(vids) % 2}" style="z-index:{5 + j}"></video>'
            vids.append(j)
        lines, cur = [], None
        for n, (disp, st, tt_) in enumerate(s["items"]):
            if st == "x": continue
            if cur is None or st != cur[0] or st in "BIG": cur = [st, []]; lines.append(cur)
            cur[1].append((n, disp, st))
        h += '<div class="stk">' + "".join('<div class="ln">' + "".join(f'<span class="wd {st}" id="h{j}w{n}" style="font-size:{fit(st, disp)}px">{e(disp)}</span>' for n, disp, st in ws) + "</div>" for st, ws in lines) + "</div></div>"
        body += h
    body += f'''<div id="end"><div class="logo">KADIO COIFFURE</div><div class="k">{e(CF["end"][0])}<em>{e(CF["end"][1])}</em></div>
<div class="pr">{"".join(f"<div>{e(a)}<small>{e(b)}</small></div>" for a, b in CF["prix"])}</div>
<div class="a">615, Antoinette-Robidoux · Longueuil<br>514 919-5970 · kadiocoiffure.com</div></div><div id="flash"></div>'''
    SH = [dict(t=s["t"], end=s["end"], w=[(n, st, tt_) for n, (d_, st, tt_) in enumerate(s["items"]) if st != "x"]) for s in shots]
    js = "const SH = " + json.dumps(SH) + ", TE = " + str(TEND) + ";\n" + """
SH.forEach(function (s, j) {
  const p = "#h" + j; show(p, s.t, s.end);
  if (j) { tl.fromTo(p, { scale: 1.08 }, { scale: 1, duration: .28, ease: "power3.out", immediateRender: false }, s.t);
    if (j % 3 === 0) cue(s.t - .03, "whoosh-fast.wav", .16); else cue(s.t, "click.wav", .1); }
  const im = document.querySelector(p + " .pic"); if (im) { const z = parseFloat(im.dataset.s); kb(p + " .pic", s.t, s.end - s.t + .1, { scale: z }, { scale: z * 1.08 }); }
  s.w.forEach(function (w) { const q = p + "w" + w[0], big = w[1] !== "s" && w[1] !== "i";
    tl.fromTo(q, { opacity: 0, scale: big ? 1.35 : 1.15, filter: big ? "blur(10px)" : "blur(0px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: big ? .2 : .1, ease: "power3.out", immediateRender: false }, w[2]);
    tl.set(q, { opacity: 0 }, 0);
    if (w[1] === "G") { cue(w[2], "cut_hit_sub.wav", .3); tl.fromTo("#flash", { opacity: .45 }, { opacity: 0, duration: .25, immediateRender: false }, w[2]); }
  });
});
tl.set("#flash", { opacity: 0 }, 0);
show("#end", TE, null); fin("#end", TE, .45, { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", ease: "power4.inOut" }); cue(TE, "whoosh-cine.wav", .3);
fin("#end .logo", TE + .3, .4, { opacity: 0 }, { opacity: 1 });
fin("#end .k", TE + .35, .5, { opacity: 0, scale: 1.2, filter: "blur(12px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", ease: "power3.out" }); cue(TE + .35, "bass.wav", .35);
fin("#end .pr div", TE + .9, .4, { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: .15, ease: "back.out(2)" }); cue(TE + .9, "pop-bubble.wav", .22);
fin("#end .a", TE + 1.4, .5, { opacity: 0 }, { opacity: 1 });
"""
    if CF.get("fx"): js += open(os.path.join(FXD, "effets.js")).read() + "\nconst V = " + json.dumps(VS) + ", TT = " + str(T) + ";\n" + "\n".join(CF["fx"]) + "\n"
    open(os.path.join(D, "index.html"), "w").write(page("Kadio, série services", css, body, js, T, tuple(CF["mus"])))
elif F == "effets":
    # Démo de la bibliothèque d'effets (montage/effets) sur les photos du salon
    FXD = os.path.join(R, "..", "effets")
    css = open(os.path.join(FXD, "effets.css")).read() + """
@font-face { font-family: ID; src: url(fonts/InterDisplay-Bold.otf); font-weight: 700; }
@font-face { font-family: ID; src: url(fonts/InterDisplay-Black.otf); font-weight: 900; }
@font-face { font-family: SR; src: url(fonts/cormorant-garamond-latin-600-italic.woff2); font-weight: 700; font-style: italic; }
#root { background: #111; color: #fff; font-family: ID; }
.bgp { position: absolute; inset: 0; visibility: hidden; overflow: hidden; }
.bgp img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ttl { position: absolute; left: 50px; top: 70px; padding: 14px 26px; background: #fff; color: #111; font: 900 40px ID; z-index: 95; visibility: hidden; }
"""
    E = [("Curseur", "s_coupe"), ("Carte app", "s_stitch"), ("Sous-titre deux tons", "s_locks"), ("Cadran", "s_design"), ("Touches", "s_coupe"),
         ("Anneau", "s_stitch"), ("Mur de posts", "s_design"), ("Commentaires", "s_locks"), ("Croquis", "s_creative"), ("Lame", "s_coupe"),
         ("Mise au point", "s_design"), ("Billet", "s_coupe"), ("Note vocale", "s_stitch"), ("Image choc", "s_coupe"), ("Zoom dolly", "s_locks"),
         ("Une de journal", "s_design"), ("Déchirure", "s_creative"), ("Couches 3D", "s_stitch"), ("Corps en code", "s_stitch"), ("Envol", "s_creative"), ("Texte derrière", "s_stitch"), ("Clones", "s_coupe"), ("Pile de têtes", "s_design")]
    DU = 2.2; T = round(len(E) * DU + 1.5, 2)
    body = "".join(f'<div class="bgp" id="bg{i}"><img src="photos/{p}.jpg"></div>' for i, (_, p) in enumerate(E))
    body += '<div class="ttl">23 effets · Kadio Coiffure</div>'
    PH = ["photos/" + x for x in ("s_stitch.jpg", "s_locks.jpg", "s_creative.jpg", "s_design.jpg", "s_coupe.jpg", "b1.jpg", "b2.jpg", "b3.jpg", "b4.jpg", "b5.jpg", "b6.jpg", "b8.jpg", "l1.jpg", "l2.jpg")]
    js = open(os.path.join(FXD, "effets.js")).read() + "\nconst DU = " + str(DU) + ", PH = " + json.dumps(PH) + ";\n" + """
const NE = 23;
for (let i = 0; i < NE; i++) { show("#bg" + i, i * DU, i === NE - 1 ? null : (i + 1) * DU); kb("#bg" + i + " img", i * DU, DU, { scale: 1.12 }, { scale: 1.0 }); }
show(".ttl", 0, 2.0);
const A = (i) => i * DU + .15, D2 = DU - .2;
FX.curseur(A(0), D2, { x: 540, y: 820 });
FX.carte(A(1), D2, { titre: "Kadio Coiffure", sous: "Réservation en ligne", bouton: "Réserver", encours: "Réservation…", fini: "Confirmé ✓", icone: "K" });
FX.bande([["Une", A(2) + .1], ["coupe", A(2) + .4], ["nette,", A(2) + .7], ["chaque", A(2) + 1.0], ["fois.", A(2) + 1.35]], { par: 5 });
FX.cadran(A(3), D2, { cible: 5 });
FX.touches(A(4), D2, { mot: "KADIO" });
FX.anneau(A(5), D2, { texte: "NATTES · DESIGN · CROISÉ · " });
FX.mur(A(6), D2, { images: PH, n: 72, total: 1711, suffixe: " clients" });
FX.commentaires(A(7), D2, { liste: [["kadiocoiffure", "Commente RDV pour réserver 👇"], ["mariama", "RDV"], ["jo.b", "RDV samedi ?"]] });
FX.croquis(A(8), D2, { mot: "unique", couleur: "#fff", top: 760 });
FX.lame(A(9), D2, { image: "photos/s_coupe.jpg", etiquettes: ["Dégradé", "Contour", "Barbe"] });
FX.miseaupoint(A(10), D2, "#bg10 img", { de: 22, a: 0 });
FX.billet(A(11), D2, { image: "photos/s_coupe.jpg", num: "50", texte: "CLUB KADIO" });
FX.notevocale(A(12), D2, { top: 300 });
FX.impact(A(13), D2, { image: "photos/s_coupe.jpg", mot: "NET." });
FX.dolly(A(14), D2, "#bg14 img");
FX.journal(A(15), D2, { image: "photos/s_design.jpg", titre: "Twists parfaits", sous: "Séparations tracées à la main" });
FX.dechirure(A(16), D2);
FX.couches(A(17), D2, { image: "photos/s_stitch.jpg", libelles: ["PHOTO", "COULEUR", "TEXTE", "SON"] });
FX.code(A(18), D2, { ascii: "photos/ascii_stitch.png" });
FX.envol(A(19), D2, { image: "photos/s_creative.jpg" });
FX.derriere(A(20), D2, { image: "photos/s_stitch.jpg", detoure: "photos/cut_s_stitch.png", mot: "NATTES" });
FX.clones(A(21), D2, { image: "photos/s_coupe.jpg", detoure: "photos/cut_s_coupe.png", n: 5 });
FX.pile(A(22), D2 + .6, { image: "photos/s_design.jpg", detoure: "photos/cut_s_design.png", n: 4 });
FX.liste(.2, T - .3, ["Curseur", "Carte app", "Sous-titre", "Cadran", "Touches", "Anneau", "Mur", "Commentaires", "Croquis", "Lame", "Mise au point", "Billet", "Note vocale", "Image choc", "Zoom dolly", "Journal", "Déchirure", "Couches 3D", "Code", "Envol", "Derrière", "Clones", "Pile"], Array.from({ length: NE }, (_, i) => i * DU));
"""
    open(os.path.join(D, "index.html"), "w").write(page("Bibliothèque d'effets Kadio", css, body, js, T, ("m1183", 20)))
print(F, "ok")
