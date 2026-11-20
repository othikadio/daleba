<!doctype html>
<html lang="fr" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<script src="gsap.min.js"></script>
<style>
@font-face { font-family: "{{FONT}}"; src: url(fonts/{{FF}}); }
@font-face { font-family: Outfit; src: url(fonts/outfit-latin-700-normal.woff2); font-weight: 700; }
@font-face { font-family: Outfit; src: url(fonts/outfit-latin-300-normal.woff2); font-weight: 300; }
:root { --bg: {{BG}}; --fg: {{FG}}; --ac: {{AC}}; --ac2: {{AC2}}; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
#root { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: var(--bg); }
.layer { position: absolute; inset: 0; }
.v { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; object-fit: cover; filter: saturate(1.12) contrast(1.05); }
.shade { background: linear-gradient(180deg, rgba(0,0,0,.35) 0%, transparent 25%, transparent 50%, rgba(0,0,0,.72) 100%); }
.ch { display: inline-block; white-space: pre; } .w { display: inline-block; white-space: nowrap; }
.hook { position: absolute; left: 70px; right: 70px; bottom: 420px; font: 120px/1.02 "{{FONT}}"; color: #fff; text-transform: uppercase; text-shadow: 0 8px 40px rgba(0,0,0,.55); }
.hook .last { color: var(--ac); }
.name { position: absolute; left: 70px; right: 70px; bottom: 600px; font: 112px/1.02 "{{FONT}}"; color: #fff; text-shadow: 0 8px 40px rgba(0,0,0,.55); }
.keys { position: absolute; left: 70px; right: 70px; top: 1360px; display: flex; flex-wrap: wrap; gap: 18px; }
.key { padding: 16px 32px; border-radius: 999px; background: var(--ac); color: #fff; font: 700 44px Outfit; box-shadow: 0 10px 30px rgba(0,0,0,.3); }
.key:nth-child(2) { background: var(--ac2); }
.key:nth-child(3) { background: #fff; color: #1a1a1a; }
.offre { position: absolute; left: 70px; right: 70px; bottom: 420px; }
.tag { display: inline-block; padding: 10px 26px; background: #fff; color: #111; font: 700 34px Outfit; letter-spacing: .25em; }
.ot { margin-top: 24px; font: 104px/1.04 "{{FONT}}"; color: #fff; text-shadow: 0 8px 40px rgba(0,0,0,.55); }
.sub { position: absolute; left: 90px; right: 90px; top: 1560px; text-align: center; }
.sub span { display: inline; padding: 6px 14px; line-height: 1.6; background: rgba(0,0,0,.55); color: #fff; font: 700 38px Outfit; box-decoration-break: clone; -webkit-box-decoration-break: clone; border-radius: 10px; }
.endbg { background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--bg) 70%, #fff), var(--bg) 70%); }
.fl { position: absolute; color: var(--ac); opacity: .55; font-style: normal; }
.end { position: absolute; left: 70px; right: 70px; top: 620px; text-align: center; color: var(--fg); }
.eyebrow { font: 700 40px Outfit; letter-spacing: .3em; color: var(--ac); text-transform: uppercase; }
.ename { margin-top: 26px; font: 116px/1.04 "{{FONT}}"; }
.rule { width: 300px; height: 6px; margin: 44px auto; background: var(--ac); border-radius: 3px; }
.lieu { font: 300 46px Outfit; }
.tel { display: inline-block; margin-top: 40px; padding: 20px 50px; border-radius: 999px; background: var(--ac); color: #fff; font: 700 64px Outfit; }
.badge { position: absolute; left: 0; right: 0; top: 150px; text-align: center; font: 700 22px Outfit; letter-spacing: .25em; color: rgba(255,255,255,.75); text-transform: uppercase; }
#flash { background: #fff; opacity: 0; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{{TOTAL}}" data-width="1080" data-height="1920">
{{BODY}}
</div>
<script>
const CFG = {{CFG}}; const SC = CFG.scenes; const T = CFG.total;
const CUES = []; const cue = (t, file, gain) => CUES.push({ t: +Math.max(0, t).toFixed(3), file: file, gain: gain == null ? .5 : gain });
const tl = gsap.timeline({ paused: true });
function from(els, t, a, b, f, g) { tl.fromTo(els, a, Object.assign({ immediateRender: false }, b), t); tl.set(els, a, 0); if (f) cue(t, f, g); }
function flash(t) { tl.set("#flash", { opacity: 0 }, 0); tl.fromTo("#flash", { opacity: .7 }, { opacity: 0, duration: .3, ease: "power2.out", immediateRender: false }, t); }
// zoom lent sur chaque plan
["#b0", "#b1", "#b2"].forEach(function (id, i) { tl.fromTo(id, { scale: 1.02 }, { scale: 1.12, duration: Math.min(SC[i][1], 5), ease: "none", immediateRender: false }, SC[i][0]); });
// 0 : accroche
from("#s0 .ch", SC[0][0] + .35, { opacity: 0, yPercent: 80, rotate: 6 }, { opacity: 1, yPercent: 0, rotate: 0, duration: .5, stagger: .035, ease: "back.out(1.6)" }, "pop-bubble.wav", .35);
cue(SC[0][0] + .9, "sparkle.wav", .25);
// 1 : nom + valeurs
flash(SC[1][0]); cue(SC[1][0] - .2, "whoosh-cine.wav", .4);
from("#s1 .ch", SC[1][0] + .2, { opacity: 0, y: 60, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: .5, stagger: .03, ease: "power3.out" });
document.querySelectorAll("#s1 .key").forEach(function (k, i) { from(k, SC[1][0] + 1.0 + i * .35, { scale: 0, rotate: -8 }, { scale: 1, rotate: 0, duration: .45, ease: "back.out(2)" }, "pop-hard.wav", .3); });
// 2 : offre
flash(SC[2][0]); cue(SC[2][0] - .2, "woosh-air.wav", .4);
from("#s2 .tag", SC[2][0] + .2, { opacity: 0, x: -80 }, { opacity: 1, x: 0, duration: .4, ease: "expo.out" }, "click.wav", .3);
from("#s2 .ot", SC[2][0] + .45, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: .6, ease: "expo.out" });
// 3 : fin
flash(SC[3][0]); cue(SC[3][0], "bass.wav", .5);
from("#s3 .eyebrow", SC[3][0] + .2, { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: .5 }, "sparkle.wav", .3);
from("#s3 .ch", SC[3][0] + .35, { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1, duration: .45, stagger: .03, ease: "power4.out" });
from("#s3 .rule", SC[3][0] + 1.0, { scaleX: 0 }, { scaleX: 1, duration: .6, ease: "expo.out" });
from("#s3 .lieu", SC[3][0] + 1.2, { opacity: 0 }, { opacity: 1, duration: .5 });
from("#s3 .tel", SC[3][0] + 1.5, { scale: 0 }, { scale: 1, duration: .5, ease: "back.out(2)" }, "notif-positive.wav", .35);
tl.to("#s3 .tel", { scale: 1.06, duration: .35, yoyo: true, repeat: 5, ease: "sine.inOut" }, SC[3][0] + 2.2);
document.querySelectorAll(".fl").forEach(function (f, i) { tl.fromTo(f, { y: -60, rotate: 0 }, { y: 260, rotate: i % 2 ? 90 : -90, duration: SC[3][1], ease: "none", immediateRender: false }, SC[3][0]); });
// sous-titres
document.querySelectorAll(".sub").forEach(function (s) { from(s, +s.dataset.start, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .3 }); });
window.__cues = CUES;
window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
