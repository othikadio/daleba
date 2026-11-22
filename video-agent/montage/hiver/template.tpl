<!doctype html>
<html lang="fr" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<script src="gsap.min.js"></script>
<style>
@font-face { font-family: "{{FONT}}"; src: url(fonts/{{FF}}); }
@font-face { font-family: Outfit; src: url(fonts/outfit-latin-700-normal.woff2); font-weight: 700; }
@font-face { font-family: Outfit; src: url(fonts/outfit-latin-900-normal.woff2); font-weight: 900; }
@font-face { font-family: Outfit; src: url(fonts/outfit-latin-300-normal.woff2); font-weight: 300; }
:root { --bg: {{BG}}; --bg2: {{BG2}}; --fg: {{FG}}; --ac: {{AC}}; --ac2: {{AC2}}; --ink: {{INK}}; --H: "{{FONT}}"; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: var(--bg); color: var(--fg); font-family: Outfit; }
.layer { position: absolute; inset: 0; }
.ch { display: inline-block; white-space: pre; } .w { display: inline-block; white-space: nowrap; }
.grad { background: radial-gradient(120% 80% at 20% 10%, var(--bg2), var(--bg) 60%); }
.blob { position: absolute; border-radius: 50%; filter: blur(80px); opacity: .55; }
.b1 { width: 700px; height: 700px; left: -200px; top: 200px; background: var(--ac); }
.b2 { width: 600px; height: 600px; right: -220px; top: 900px; background: var(--ac2); }
.b3 { width: 500px; height: 500px; left: 200px; top: 1500px; background: var(--ac); opacity: .35; }
.bigico { position: absolute; width: 1100px; height: 1100px; left: -10px; top: 420px; color: var(--fg); opacity: .06; }
.v { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; object-fit: cover; }
#tint { background: linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,.1) 35%, rgba(0,0,0,.15) 60%, rgba(0,0,0,.6)); opacity: 0; }
#snow .sn { position: absolute; top: -40px; border-radius: 50%; background: #fff; filter: blur(1.5px); }
#frost { background: radial-gradient(130% 75% at 50% 50%, transparent 55%, rgba(220,245,255,.55) 100%); opacity: 0; pointer-events: none; }
.sc { visibility: hidden; }
/* 0 accroche */
.temp { position: absolute; left: 0; right: 0; top: 230px; text-align: center; font: 300px/1 var(--H); color: var(--ac); letter-spacing: -.02em; }
.hook { position: absolute; left: 70px; right: 70px; top: 640px; text-align: center; font: 150px/1.02 var(--H); text-transform: uppercase; }
.hl { white-space: nowrap; } .hl.acc { color: var(--ac2); }
.ename, .tipbig, .stitle { white-space: nowrap; } .st { flex: 1; min-width: 0; } .st b { white-space: nowrap; }
/* 1 pourquoi */
.why { position: absolute; left: 0; right: 0; top: 300px; text-align: center; font: 900 54px Outfit; letter-spacing: .3em; color: var(--ac); }
.words { position: absolute; left: 80px; right: 80px; top: 470px; display: flex; flex-direction: column; align-items: center; gap: 36px; }
.word { padding: 18px 56px; font: 150px/1 var(--H); background: var(--ac2); color: #fff; border-radius: 28px; }
.word:nth-child(2) { background: var(--ac); color: var(--ink); }
.word:nth-child(3) { background: var(--fg); color: var(--ink); }
.crack { position: absolute; left: 0; top: 1150px; width: 1080px; height: 300px; }
.crack path { fill: none; stroke: var(--fg); stroke-width: 10; stroke-linejoin: round; stroke-dasharray: 1400; stroke-dashoffset: 1400; }
/* 2 étapes */
.stitle { position: absolute; left: 0; right: 0; top: 260px; text-align: center; font: 110px/1 var(--H); color: var(--ac); }
.steps { position: absolute; left: 70px; right: 70px; top: 440px; display: flex; flex-direction: column; gap: 40px; }
.step { position: relative; display: flex; align-items: center; gap: 36px; padding: 36px 44px; border-radius: 40px; background: rgba(255,255,255,.14); border: 3px solid rgba(255,255,255,.35); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
.num { position: absolute; left: -26px; top: -26px; width: 84px; height: 84px; border-radius: 50%; background: var(--ac2); color: #fff; font: 900 50px/84px Outfit; text-align: center; }
.ico { width: 150px; height: 150px; flex: none; color: var(--ac); }
.st b { display: block; font: 96px/1 var(--H); }
.st small { display: block; margin-top: 10px; font: 700 44px Outfit; opacity: .85; }
/* 3 astuce */
.tip { position: absolute; left: 90px; right: 90px; top: 360px; padding: 70px 50px; text-align: center; border-radius: 60px; background: rgba(255,255,255,.14); border: 3px solid rgba(255,255,255,.35); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
.tipico { width: 220px; height: 220px; color: var(--ac2); }
.tipbig { margin-top: 20px; font: 190px/1 var(--H); color: var(--ac); }
.tipsub { font: 700 70px Outfit; }
.tipnote { margin-top: 40px; display: inline-block; padding: 16px 40px; border-radius: 999px; background: var(--ac2); color: #fff; font: 700 48px Outfit; }
.prices { position: absolute; left: 90px; right: 90px; top: 420px; display: flex; flex-direction: column; gap: 50px; }
.price { display: flex; justify-content: space-between; align-items: center; padding: 40px 54px; border-radius: 36px; background: #fff; color: var(--ink); font: 110px/1 var(--H); }
.price b { color: var(--ac); font-weight: 400; }
.prices + .tipnote { position: absolute; left: 0; right: 0; top: 1060px; margin: 0 auto; width: max-content; }
/* 4 fin */
.end { position: absolute; left: 70px; right: 70px; top: 470px; text-align: center; }
.eyebrow { font: 900 40px Outfit; letter-spacing: .25em; color: var(--ac); text-transform: uppercase; }
.ename { margin-top: 30px; font: 190px/.98 var(--H); }
.rule { width: 320px; height: 10px; margin: 50px auto; background: var(--ac2); border-radius: 5px; }
.lieu { font: 700 48px Outfit; } .pin { width: 50px; height: 50px; vertical-align: -10px; color: var(--ac); }
.site { margin-top: 30px; font: 900 64px Outfit; color: var(--ac); }
.tel { display: inline-block; margin-top: 40px; padding: 24px 60px; border-radius: 999px; background: var(--ac2); color: #fff; font: 900 70px Outfit; }
/* sous-titres + puce */
.sub { position: absolute; left: 80px; right: 80px; top: 1600px; text-align: center; visibility: hidden; }
.sub span { display: inline; padding: 8px 18px; line-height: 1.55; background: rgba(0,0,0,.62); color: #fff; font: 700 42px Outfit; border-radius: 12px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
#chip { position: absolute; left: 60px; right: 60px; top: 80px; display: flex; justify-content: space-between; align-items: center; font: 900 34px Outfit; letter-spacing: .18em; }
#chip span { padding: 12px 26px; border-radius: 999px; background: var(--ac); color: var(--ink); }
#chip .cs { width: 32px; height: 32px; vertical-align: -6px; }
#chip b { padding: 12px 22px; border-radius: 999px; background: rgba(255,255,255,.2); }
#ai { position: absolute; left: 0; right: 0; bottom: 60px; text-align: center; font: 700 22px Outfit; letter-spacing: .12em; color: rgba(255,255,255,.7); text-transform: uppercase; }
#flash { background: #fff; opacity: 0; pointer-events: none; }

/* ===== variantes ===== */
[data-mode="satin"] .step, [data-mode="satin"] .tip { border-radius: 90px; background: rgba(255,143,199,.2); border-color: rgba(255,200,230,.6); }
[data-mode="satin"] .word { border-radius: 999px; }
[data-mode="alerte"] .grad { background: repeating-linear-gradient(135deg, var(--bg) 0 60px, var(--bg2) 60px 120px); opacity: .5; }
[data-mode="alerte"] .blob { display: none; }
[data-mode="alerte"] #snow .sn { background: var(--ac2); }
[data-mode="alerte"] .word, [data-mode="alerte"] .step, [data-mode="alerte"] .tip, [data-mode="alerte"] .price { border-radius: 0; border: 6px solid var(--fg); box-shadow: 16px 16px 0 var(--fg); backdrop-filter: none; background: #fff; color: var(--fg); }
[data-mode="alerte"] .word:nth-child(1) { background: var(--ac); color: #fff; }
[data-mode="alerte"] .num { border-radius: 0; background: var(--ac); }
[data-mode="alerte"] #chip b { background: var(--fg); color: #fff; }
[data-mode="alerte"] .tipnote, [data-mode="alerte"] .tel { border-radius: 0; background: var(--ac2); }
[data-mode="pop"] .grad { background: radial-gradient(circle, rgba(0,0,0,.16) 3px, transparent 4px) 0 0/28px 28px, radial-gradient(circle at 50% 35%, var(--bg), var(--bg2)); }
[data-mode="pop"] .blob { display: none; }
[data-mode="pop"] .hook, [data-mode="pop"] .temp, [data-mode="pop"] .stitle, [data-mode="pop"] .ename { -webkit-text-stroke: 6px var(--fg); paint-order: stroke fill; color: #fff; text-shadow: 12px 12px 0 var(--fg); }
[data-mode="pop"] .temp { color: var(--ac2); } [data-mode="pop"] .hl.acc { color: var(--ac); }
[data-mode="pop"] .word, [data-mode="pop"] .step, [data-mode="pop"] .price, [data-mode="pop"] .tip { border: 8px solid var(--fg); box-shadow: 14px 14px 0 var(--fg); backdrop-filter: none; background: #fff; color: var(--fg); transform: rotate(-2deg); }
[data-mode="pop"] .step:nth-child(2) { transform: rotate(2deg); }
[data-mode="pop"] .ico { color: var(--ac); } [data-mode="pop"] .why { color: var(--fg); }
[data-mode="pop"] #snow .sn { background: #fff; box-shadow: 0 0 0 3px var(--fg); filter: none; }
[data-mode="pop"] .burst { position: absolute; left: 140px; top: 120px; width: 800px; height: 800px; background: var(--ac); clip-path: polygon(50% 0,58% 32%,85% 10%,68% 40%,100% 45%,70% 58%,92% 88%,58% 70%,50% 100%,42% 70%,8% 88%,30% 58%,0 45%,32% 40%,15% 10%,42% 32%); }
[data-mode="vapeur"] .blob { filter: blur(120px); }
[data-mode="vapeur"] #snow .sn { background: rgba(255,255,255,.7); filter: blur(10px); }
[data-mode="vapeur"] .step, [data-mode="vapeur"] .tip { border-radius: 30px 90px 30px 90px; }
</style>
</head>
<body>
<div id="root" data-mode="" data-composition-id="main" data-start="0" data-duration="{{TOTAL}}" data-width="1080" data-height="1920">
{{BODY}}
</div>
<script>
function fitAll() {
  document.querySelectorAll(".hl, .ename, .tipbig, .stitle, .st b, .word, .price, .temp").forEach(function (el) {
    const box = el.classList.contains("word") ? el.parentElement : el;
    let fs = parseFloat(getComputedStyle(el).fontSize), n = 0;
    const over = () => el.classList.contains("word") ? el.offsetWidth > box.clientWidth : el.scrollWidth > el.clientWidth + 1;
    while (over() && fs > 30 && n++ < 60) { fs *= .96; el.style.fontSize = fs + "px"; }
  });
}
fitAll(); if (document.fonts) document.fonts.ready.then(fitAll);
const CFG = {{CFG}}; const SC = CFG.scenes; const T = CFG.total; const M = CFG.mode;
document.getElementById("root").dataset.mode = M;
if (M === "pop") { const b = document.createElement("div"); b.className = "burst"; document.querySelector("#s0").prepend(b); }
const CUES = []; const cue = (t, file, gain) => CUES.push({ t: +Math.max(0, t).toFixed(3), file: file, gain: gain == null ? .5 : gain });
const tl = gsap.timeline({ paused: true });
const A = (s) => SC[s][0], E = (s) => SC[s][0] + SC[s][1];
function from(els, t, a, b, f, g) { tl.fromTo(els, a, Object.assign({ immediateRender: false }, b), t); tl.set(els, a, 0); if (f) cue(t, f, g); }
function vis(sel, t0, t1) { tl.set(sel, { autoAlpha: 0 }, 0); tl.set(sel, { autoAlpha: 1 }, t0); tl.set(sel, { autoAlpha: 0 }, t1); }
function flash(t, o) { tl.fromTo("#flash", { opacity: o || .7 }, { opacity: 0, duration: .3, ease: "power2.out", immediateRender: false }, t); }
tl.set("#flash", { opacity: 0 }, 0);

// ---- style d'entrée propre à chaque vidéo ----
const IN = {
  givre:  { a: { opacity: 0, y: 40, filter: "blur(16px)", scale: 1.08 }, b: { opacity: 1, y: 0, filter: "blur(0px)", scale: 1, duration: .6, ease: "power3.out" }, s: "sparkle.wav" },
  satin:  { a: { opacity: 0, x: -140, skewX: -18 }, b: { opacity: 1, x: 0, skewX: 0, duration: .8, ease: "elastic.out(1,.6)" }, s: "swoosh-wind.wav" },
  alerte: { a: { opacity: 0, scale: 1.6, rotate: -4 }, b: { opacity: 1, scale: 1, rotate: 0, duration: .28, ease: "power4.in" }, s: "cut_hit_sub.wav" },
  pop:    { a: { opacity: 0, scale: 0, rotate: -20 }, b: { opacity: 1, scale: 1, rotate: 0, duration: .5, ease: "back.out(2.6)" }, s: "pop-hard.wav" },
  vapeur: { a: { opacity: 0, y: 120, filter: "blur(24px)" }, b: { opacity: 1, y: 0, filter: "blur(0px)", duration: .9, ease: "power2.out" }, s: "woosh-air.wav" },
}[M];
const shake = (t) => { if (M === "alerte" || M === "pop") tl.fromTo("#root", { x: -14 }, { x: 0, duration: .35, ease: "elastic.out(1,.3)", immediateRender: false }, t); };
const ins = (els, t, st, snd, g) => from(els, t, IN.a, Object.assign({}, IN.b, { stagger: st || 0 }), snd === undefined ? IN.s : snd, g == null ? .35 : g);

// ---- fond ----
tl.to(".b1", { x: 300, y: 500, duration: T, ease: "sine.inOut" }, 0);
tl.to(".b2", { x: -360, y: -400, duration: T, ease: "sine.inOut" }, 0);
tl.to(".b3", { x: 260, y: -700, duration: T, ease: "sine.inOut" }, 0);
tl.fromTo(".bigico", { rotate: -10, scale: .9 }, { rotate: 14, scale: 1.1, duration: T, ease: "none", immediateRender: false }, 0);
document.querySelectorAll("#snow .sn").forEach(function (f, i) {
  const d = M === "vapeur" ? 7 + (i % 5) : 4 + (i % 6) * .9, ph = ((i * .37) % d) / d, dx = (i % 2 ? 70 : -70);
  const y0 = M === "vapeur" ? 1980 : -40, y1 = M === "vapeur" ? -60 : 1980, ym = y0 + (y1 - y0) * ph;
  tl.fromTo(f, { y: ym, x: dx * ph }, { y: y1, x: dx, duration: d * (1 - ph), ease: "none", immediateRender: false }, 0);
  tl.set(f, { y: ym, x: dx * ph }, 0);
  tl.fromTo(f, { y: y0, x: 0 }, { y: y1, x: dx, duration: d, ease: "none", repeat: Math.ceil(T / d) + 1, immediateRender: false }, d * (1 - ph));
});
CFG.vids.forEach(function (v) { tl.fromTo(v[0], { scale: 1.04 }, { scale: 1.14, duration: 10, ease: "none", immediateRender: false }, v[1]); });
// teinte quand un plan vidéo est visible
CFG.vids.forEach(function (v) { const el = document.querySelector(v[0]); const s = +el.dataset.start, d = +el.dataset.duration; tl.set("#tint", { opacity: 1 }, s); tl.set("#tint", { opacity: 0 }, s + d); });
if (M === "givre" || M === "alerte") { tl.fromTo("#frost", { opacity: 0 }, { opacity: 1, duration: 2, immediateRender: false }, A(0) + .2); tl.to("#frost", { opacity: .4, duration: 1 }, A(2)); }
cue(0, "winter-wind.wav", .25);

// ---- scènes ----
for (let s = 0; s < 5; s++) vis("#s" + s, A(s), s === 4 ? T + 1 : E(s));
for (let s = 0; s < 4; s++) vis("#sub" + s, A(s) + .3, E(s) - .05);
for (let s = 1; s < 5; s++) { flash(A(s), M === "alerte" ? .9 : .5); cue(A(s) - .15, s % 2 ? "whoosh-cine.wav" : "whoosh-fast.wav", .35); }

// 0 : température qui descend + accroche
const t0 = A(0), tmp = document.querySelector(".temp"), end = CFG.temp, st0 = CFG.temp < 0 ? 5 : 12;
for (let k = 0; k <= 12; k++) { const v = Math.round(st0 + (end - st0) * k / 12); tl.set(tmp, { textContent: v + "°" }, t0 + .1 + k * .07); if (k % 3 === 0) cue(t0 + .1 + k * .07, "fit_tick_domino.wav", .2); }
from(tmp, t0 + .05, { scale: .5, opacity: 0 }, { scale: 1, opacity: 1, duration: .5, ease: "back.out(2)" });
tl.to(tmp, { scale: 1.08, duration: .12, yoyo: true, repeat: 1 }, t0 + 1.0); cue(t0 + 1.0, "bass.wav", .5);
if (M === "pop") from(".burst", t0, { scale: 0, rotate: -40 }, { scale: 1, rotate: 0, duration: .6, ease: "back.out(2)" });
if (M === "pop") tl.to(".burst", { rotate: 25, duration: SC[0][1], ease: "none" }, t0 + .6);
document.querySelectorAll(".hl").forEach(function (h, i) { ins(h.querySelectorAll(".ch"), t0 + .9 + i * .45, .025, i === 0 ? undefined : null); });
shake(t0 + 1.0);

// 1 : pourquoi
const t1 = A(1);
from(".why", t1 + .15, { opacity: 0, letterSpacing: ".8em" }, { opacity: 1, letterSpacing: ".3em", duration: .6, ease: "expo.out" }, "type-click.wav", .3);
document.querySelectorAll(".word").forEach(function (w, i) { const tt = t1 + .6 + i * Math.min(.9, (SC[1][1] - 1.6) / 3); ins(w, tt); shake(tt); });
tl.to(".crack path", { strokeDashoffset: 0, duration: .5, ease: "power2.in" }, E(1) - 1.1); cue(E(1) - 1.1, "glitch_mid.wav", .3);
tl.set(".crack path", { strokeDashoffset: 1400 }, 0);

// 2 : étapes
const t2 = A(2), stp = document.querySelectorAll(".step");
from(".stitle", t2 + .1, { opacity: 0, y: -60 }, { opacity: 1, y: 0, duration: .5, ease: "expo.out" }, "click.wav", .3);
stp.forEach(function (c, i) {
  const tt = t2 + .5 + i * Math.min(1.4, (SC[2][1] - 1.2) / stp.length);
  ins(c, tt); from(c.querySelector(".num"), tt + .25, { scale: 0 }, { scale: 1, duration: .4, ease: "back.out(3)" }, "pop-bubble.wav", .3);
  from(c.querySelector(".ico"), tt + .2, { rotate: -30, scale: .4 }, { rotate: 0, scale: 1, duration: .6, ease: "back.out(2)" });
});

// 3 : astuce / prix
const t3 = A(3);
if (document.querySelector(".tip")) {
  ins(".tip", t3 + .1); from(".tipico", t3 + .35, { scale: 0, rotate: -90 }, { scale: 1, rotate: 0, duration: .6, ease: "back.out(2)" }, "sparkle.wav", .3);
  from(".tipbig", t3 + .6, { scale: 2.2, opacity: 0 }, { scale: 1, opacity: 1, duration: .45, ease: "power4.out" }, "bass.wav", .45);
  from(".tip .tipnote", t3 + 1.2, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .4, ease: "back.out(2)" }, "notif-positive.wav", .3);
  tl.to(".tipbig", { scale: 1.06, duration: .4, yoyo: true, repeat: 3, ease: "sine.inOut" }, t3 + 1.4);
} else {
  document.querySelectorAll(".price").forEach(function (p, i) { const tt = t3 + .3 + i * 1.3; ins(p, tt); from(p.querySelector("b"), tt + .3, { scale: 0 }, { scale: 1, duration: .45, ease: "back.out(3)" }, "notif-positive.wav", .35); shake(tt); });
  from(".prices + .tipnote", t3 + 2.8, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .4 }, "pop-bubble.wav", .3);
}

// 4 : fin
const t4 = A(4);
from(".eyebrow", t4 + .15, { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: .5 }, "sparkle.wav", .3);
ins(document.querySelectorAll(".ename .ch"), t4 + .35, .04, "bass.wav", .5);
from(".rule", t4 + 1.0, { scaleX: 0 }, { scaleX: 1, duration: .6, ease: "expo.out" });
from(".lieu", t4 + 1.2, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .5 });
from(".site", t4 + 1.5, { opacity: 0, scale: .7 }, { opacity: 1, scale: 1, duration: .45, ease: "back.out(2)" }, "type-click.wav", .3);
from(".tel", t4 + 1.8, { scale: 0 }, { scale: 1, duration: .5, ease: "back.out(2)" }, "notif-positive.wav", .35);
tl.to(".tel", { scale: 1.06, duration: .35, yoyo: true, repeat: 5, ease: "sine.inOut" }, t4 + 2.4);
from("#chip", 0, { opacity: 0, y: -40 }, { opacity: 1, y: 0, duration: .5, ease: "expo.out" });
// sous-titres
for (let s = 0; s < 4; s++) from("#sub" + s, A(s) + .3, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .3 });

window.__cues = CUES;
window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
