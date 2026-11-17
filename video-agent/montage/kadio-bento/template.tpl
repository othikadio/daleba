<!doctype html>
<html lang="fr" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="gsap.min.js"></script>
    <style>
      @font-face { font-family: "K Sans"; src: url("fonts/InterDisplay-Black.otf") format("opentype"); font-weight: 900; }
      @font-face { font-family: "K Sans"; src: url("fonts/InterDisplay-Bold.otf") format("opentype"); font-weight: 700; }
      @font-face { font-family: "K Emoji"; src: url("fonts/NotoColorEmoji.ttf") format("truetype"); }
      :root { --bg: #0c0b10; --vio: #8b5cf6; --lime: #c6ff3d; --white: #f7f5ff; --font: "K Sans", "K Emoji", sans-serif; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: var(--bg); }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: var(--font); color: var(--white); background: var(--bg); }
      #dots { position: absolute; inset: -60px; background: radial-gradient(circle, rgba(139,92,246,.35) 2px, transparent 3px) 0 0 / 46px 46px; }
      .scene { position: absolute; inset: 0; }
      .ch { display: inline-block; white-space: pre; } .sp { display: inline-block; width: .24em; }
      .tile { position: absolute; background-size: cover; background-position: 50% 40%; border-radius: 34px; overflow: hidden; }
      .tile.g, .tile.m { border: 4px solid rgba(247,245,255,.12); }
      .tile.full { border-radius: 0; }
      .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(12,11,16,0) 35%, rgba(12,11,16,.92) 75%); }
      .hookbox { position: absolute; left: 70px; right: 70px; top: 640px; padding: 50px 50px 60px; border-radius: 40px; background: var(--lime); color: var(--bg);
        box-shadow: 0 40px 100px rgba(0,0,0,.6); transform: rotate(-2deg); }
      .hk1 { font-size: 36px; font-weight: 900; letter-spacing: .25em; color: var(--vio); }
      .hk2 { font-size: 132px; font-weight: 900; letter-spacing: -.045em; line-height: 1; margin-top: 12px; }
      .hk2.v { color: var(--vio); }
      .mega { position: absolute; left: 0; right: 0; text-align: center; font-size: 210px; font-weight: 900; letter-spacing: -.05em; line-height: 1; }
      .mega.o { color: transparent; -webkit-text-stroke: 5px var(--lime); }
      .stk { position: absolute; padding: 20px 34px; border-radius: 18px; font-size: 42px; font-weight: 900; transform: rotate(var(--r)); box-shadow: 0 16px 40px rgba(0,0,0,.45); }
      .stk.lime { background: var(--lime); color: var(--bg); } .stk.vio { background: var(--vio); color: var(--white); }
      .idx { position: absolute; left: 60px; top: 200px; font-size: 220px; font-weight: 900; line-height: 1; color: transparent; -webkit-text-stroke: 4px var(--vio); }
      .cat { position: absolute; left: 60px; top: 410px; font-size: 92px; font-weight: 900; letter-spacing: -.03em; line-height: 1; }
      .card { transform: rotate(var(--r)); border: 6px solid var(--white); box-shadow: 0 40px 90px rgba(0,0,0,.6); }
      .card .bar { position: absolute; left: 0; right: 0; height: 120px; top: -140px; background: linear-gradient(180deg, transparent, rgba(198,255,61,.55), transparent); mix-blend-mode: screen; }
      .price { position: absolute; width: 330px; height: 330px; border-radius: 50%; background: var(--lime); color: var(--bg); display: flex; flex-direction: column;
        align-items: center; justify-content: center; font-size: 104px; font-weight: 900; letter-spacing: -.04em; line-height: 1; box-shadow: 0 0 0 14px rgba(198,255,61,.25), 0 30px 80px rgba(0,0,0,.5); }
      .price small { font-size: 40px; letter-spacing: .15em; margin-bottom: 6px; color: var(--vio); }
      .tags { position: absolute; display: flex; gap: 14px; }
      .tags span { padding: 16px 26px; border-radius: 999px; background: var(--vio); font-size: 36px; font-weight: 900; }
      .cmp { position: absolute; left: 620px; right: 50px; top: 560px; }
      .cmp .was { font-size: 38px; font-weight: 700; line-height: 1.35; opacity: .85; }
      .cmp .was s { font-size: 80px; font-weight: 900; color: #ff5c7a; text-decoration-thickness: 8px; }
      .cmp .now { margin-top: 70px; padding: 40px 30px; border-radius: 34px; background: var(--lime); color: var(--bg); text-align: center; transform: rotate(3deg); }
      .cmp .now small { display: block; font-size: 30px; letter-spacing: .2em; color: var(--vio); }
      .cmp .now b { display: block; font-size: 96px; letter-spacing: -.04em; margin: 10px 0; }
      .cmp .now em { font-style: normal; font-size: 26px; font-weight: 700; }
      .cta { position: absolute; left: 60px; right: 60px; top: 560px; padding: 60px 50px; border-radius: 44px; background: var(--vio); text-align: center;
        box-shadow: 0 40px 120px rgba(0,0,0,.7), 0 0 0 10px rgba(198,255,61,.9); }
      .c1 { font-size: 46px; font-weight: 900; letter-spacing: .2em; color: var(--lime); }
      .c2 { font-size: 170px; font-weight: 900; letter-spacing: -.05em; line-height: 1; margin: 16px 0 34px; }
      .c3 { display: inline-block; padding: 26px 46px; border-radius: 999px; background: var(--lime); color: var(--bg); font-size: 72px; font-weight: 900; }
      .c4 { margin-top: 26px; font-size: 44px; font-weight: 700; }
      #top { position: absolute; left: 60px; right: 60px; top: 80px; display: flex; justify-content: space-between; align-items: center; font-size: 30px; font-weight: 900; letter-spacing: .2em; }
      #top i { font-style: normal; color: var(--lime); }
      #tape { position: absolute; left: 0; right: 0; top: 1745px; height: 96px; background: var(--lime); overflow: hidden; display: flex; align-items: center; }
      #tape .mq { white-space: nowrap; font-size: 46px; font-weight: 900; color: var(--bg); letter-spacing: .06em; }
      #push { position: absolute; left: 0; right: 0; top: 0; height: 1920px; background: var(--lime); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{{TOTAL}}" data-width="1080" data-height="1920">
      <div id="bg" class="clip" data-start="0" data-duration="{{TOTAL}}" data-track-index="0" style="position:absolute;inset:0"><div id="dots"></div></div>
{{SCENES}}
      <div id="chrome" class="clip" data-start="0" data-duration="{{TOTAL}}" data-track-index="3" style="position:absolute;inset:0">
        <div id="top"><span>KADIO <i>COIFFURE</i></span><span id="num">01/07</span></div>
        <div id="tape"><div class="mq">KADIO COIFFURE ✦ LONGUEUIL ✦ NATTES ✦ DESIGN ✦ TWISTS ✦ LOCS ✦ BARBIER ✦ 514 919-5970 ✦ KADIO COIFFURE ✦ LONGUEUIL ✦ NATTES ✦ DESIGN ✦ TWISTS ✦ LOCS ✦ BARBIER ✦ 514 919-5970 ✦</div></div>
        <div id="push"></div>
      </div>
    </div>
    <script>
      const CFG = {{CFG}};
      const CUES = []; const cue = (t, file, gain = .5) => CUES.push({ t: +t.toFixed(3), file, gain });
      document.querySelectorAll(".split").forEach((el) => { el.innerHTML = [...el.textContent].map(c => c === " " ? '<span class="sp"> </span>' : `<span class="ch">${c}</span>`).join(""); });
      const tl = gsap.timeline({ paused: true }); const T = CFG.total, P = "expo.out", B = "back.out(1.7)";
      const S = (i) => document.getElementById("s" + i), q = (i, sel) => [...S(i).querySelectorAll(sel)];
      const st = (i) => CFG.scenes[i][0], en = (i) => CFG.scenes[i][0] + CFG.scenes[i][1];
      function chars(els, t, s = .035, file = "click.wav") { tl.set(els, { opacity: 0 }, 0);
        tl.fromTo(els, { y: 90, opacity: 0, skewX: -20 }, { y: 0, opacity: 1, skewX: 0, duration: .5, ease: P, stagger: s, immediateRender: false }, t); if (file) cue(t, file, .35); }
      function slam(els, t, file = "pop-hard.wav", g = .45) { tl.set(els, { opacity: 0 }, 0);
        tl.fromTo(els, { scale: 1.8, opacity: 0, rotate: 8 }, { scale: 1, opacity: 1, rotate: (k, el) => el.style.getPropertyValue("--r") || 0, duration: .38, ease: "power4.in", stagger: .14, immediateRender: false }, t);
        els.forEach((e, k) => cue(t + .34 + k * .14, file, g)); }
      function card(el, t, dir) { tl.set(el, { opacity: 0 }, 0);
        tl.fromTo(el, { y: 1300 * dir, rotate: 18 * dir, opacity: 1 }, { y: 0, rotate: el.style.getPropertyValue("--r"), duration: .7, ease: P, immediateRender: false }, t);
        cue(t, "woosh-air.wav", .3); cue(t + .45, "shutter.wav", .5); }
      // fond et ruban
      tl.fromTo("#dots", { x: 0, y: 0 }, { x: -46 * 6, y: -46 * 12, duration: T, ease: "none" }, 0);
      tl.fromTo("#tape .mq", { x: 0 }, { x: -1900, duration: T, ease: "none" }, 0);
      tl.set("#push", { yPercent: 100 }, 0);
      // transitions : poussée verticale (bande citron qui balaie de bas en haut)
      for (let i = 1; i < CFG.scenes.length; i++) { const t = st(i);
        tl.fromTo("#push", { yPercent: 100 }, { yPercent: 0, duration: .26, ease: "power3.in", immediateRender: false }, t - .26);
        tl.fromTo("#push", { yPercent: 0 }, { yPercent: -100, duration: .34, ease: "power3.out", immediateRender: false }, t);
        tl.fromTo(S(i), { y: 260 }, { y: 0, duration: .6, ease: P, immediateRender: false }, t);
        tl.to(S(i - 1), { y: -260, duration: .26, ease: "power3.in" }, t - .26);
        tl.set("#num", { textContent: "0" + (i + 1) + "/07" }, t);
        cue(t - .3, "whoosh-cine.wav", .45); }
      // 0 : la grille s'assemble
      q(0, ".tile.g").forEach((g, k) => { const t = .05 + k * .16; tl.set(g, { opacity: 0 }, 0);
        tl.fromTo(g, { scale: .2, opacity: 0, rotate: k % 2 ? 10 : -10 }, { scale: 1, opacity: .55, rotate: 0, duration: .5, ease: B, immediateRender: false }, t); cue(t, "pop-whoosh.wav", .45); });
      tl.set(q(0, ".hookbox"), { scale: 0 }, 0); tl.to(q(0, ".hookbox"), { scale: 1, duration: .55, ease: B }, 1.1); cue(1.1, "bass.wav", .5);
      q(0, ".hk2").forEach((h, k) => chars([...h.querySelectorAll(".ch")], 1.4 + k * .4, .03, k ? null : "click.wav"));
      // 1 : plongée dans la photo
      tl.fromTo(q(1, ".tile.full"), { scale: 1.6 }, { scale: 1.05, duration: CFG.scenes[1][1], ease: "power2.out", immediateRender: false }, st(1));
      chars(q(1, ".mega:not(.o) .ch"), st(1) + .3, .05); chars(q(1, ".mega.o .ch"), st(1) + .7, .04, null);
      slam(q(1, ".stk"), st(1) + 1.5);
      // 2-4 fiches
      [2, 3, 4].forEach((i) => {
        tl.set(q(i, ".idx"), { opacity: 0 }, 0); tl.fromTo(q(i, ".idx"), { x: -300, opacity: 0 }, { x: 0, opacity: 1, duration: .6, ease: P, immediateRender: false }, st(i) + .1);
        chars(q(i, ".cat"), st(i) + .3, 0, "click.wav");
        q(i, ".card").forEach((c, k) => card(c, st(i) + .5 + k * .45, k ? -1 : 1));
        if (i === 3) q(i, ".flip").forEach((c, k) => tl.fromTo(c, { rotateY: 180 }, { rotateY: 0, duration: .7, ease: P, immediateRender: false }, st(i) + .5 + k * .45));
        if (i === 4) q(i, ".bar").forEach((b, k) => tl.fromTo(b, { y: 0 }, { y: 1100, duration: 1.4, ease: "power1.inOut", repeat: 1, immediateRender: false }, st(i) + 1.3 + k * .3));
      });
      [2, 3].forEach((i) => { const p = q(i, ".price"); tl.set(p, { scale: 0 }, 0);
        tl.to(p, { scale: 1, rotate: -8, duration: .55, ease: B }, st(i) + 1.6); cue(st(i) + 1.6, "notif-positive.wav", .3);
        tl.to(p, { rotate: 8, duration: 1.2, yoyo: true, repeat: 1, ease: "sine.inOut" }, st(i) + 2.2); });
      slam(q(3, ".tags span"), st(3) + 1.3, "click.wav", .4);
      slam(q(4, ".stk"), st(4) + 1.8, "pop-hard.wav", .4);
      // 5 barbier : comparaison
      tl.set(q(5, ".was"), { opacity: 0 }, 0); tl.fromTo(q(5, ".was"), { x: 200, opacity: 0 }, { x: 0, opacity: .85, duration: .5, ease: P, immediateRender: false }, st(5) + 1.0);
      tl.set(q(5, ".now"), { scale: 0 }, 0); tl.to(q(5, ".now"), { scale: 1, duration: .55, ease: B }, st(5) + 2.4); cue(st(5) + 2.4, "bass.wav", .5);
      const o = { v: 0 }, cp = document.getElementById("clubp");
      tl.fromTo(o, { v: 0 }, { v: 19.99, duration: .9, ease: "power3.out", onUpdate: () => (cp.textContent = o.v.toFixed(2).replace(".", ",") + " $"), immediateRender: false }, st(5) + 2.6);
      cue(st(5) + 3.5, "tone-correct.wav", .35);
      // 6 fin : mosaïque + carte
      q(6, ".tile.m").forEach((g, k) => { tl.set(g, { opacity: 0 }, 0); tl.fromTo(g, { scale: 1.3, opacity: 0 }, { scale: 1, opacity: .35, duration: .6, ease: P, immediateRender: false }, st(6) + k * .06); });
      tl.set(q(6, ".cta"), { scale: 0, rotate: -10 }, 0); tl.to(q(6, ".cta"), { scale: 1, rotate: -2, duration: .6, ease: B }, st(6) + .5); cue(st(6) + .5, "bass.wav", .5);
      chars(q(6, ".c2 .ch"), st(6) + .9, .05);
      tl.set(q(6, ".c3"), { scale: 0 }, 0); tl.to(q(6, ".c3"), { scale: 1, duration: .5, ease: B }, st(6) + 1.6); cue(st(6) + 1.6, "notif-positive.wav", .4);
      tl.to(q(6, ".c3"), { scale: 1.06, duration: .35, yoyo: true, repeat: 5, ease: "sine.inOut" }, st(6) + 2.2);
      window.__cues = CUES;
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
