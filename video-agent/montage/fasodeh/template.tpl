<!doctype html>
<html lang="fr" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="gsap.min.js"></script>
    <style>
      @font-face { font-family: "F Poster"; src: url("fonts/InterDisplay-Black.otf") format("opentype"); font-weight: 900; }
      @font-face { font-family: "F Poster"; src: url("fonts/InterDisplay-Bold.otf") format("opentype"); font-weight: 700; }
      @font-face { font-family: "F Serif"; src: url("fonts/Caladea-Bold.ttf") format("truetype"); font-weight: 700; }
      @font-face { font-family: "F Emoji"; src: url("fonts/NotoColorEmoji.ttf") format("truetype"); }
      :root { --indigo: #16195a; --red: #e63946; --yel: #ffd23d; --grn: #1a8f5a; --cream: #fff4dc; --font: "F Poster", "F Emoji", sans-serif; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: var(--indigo); }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: var(--font); color: var(--cream); background: var(--indigo); }
      /* fond : motif wax animé */
      #pat { position: absolute; inset: -200px; opacity: .22;
        background:
          radial-gradient(circle at 50% 50%, var(--yel) 0 14px, transparent 15px) 0 0 / 120px 120px,
          radial-gradient(circle at 50% 50%, transparent 0 30px, var(--red) 31px 38px, transparent 39px) 0 0 / 120px 120px,
          conic-gradient(from 45deg, var(--grn) 0 25%, transparent 0 50%, var(--grn) 0 75%, transparent 0) 60px 60px / 120px 120px; }
      #vign { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, rgba(22,25,90,0) 30%, rgba(8,8,40,.85) 100%); }
      .scene { position: absolute; inset: 0; }
      .center { position: absolute; left: 0; right: 0; text-align: center; }
      .ch { display: inline-block; white-space: pre; } .sp { display: inline-block; width: .25em; }
      .pre { font-size: 40px; font-weight: 900; letter-spacing: .3em; color: var(--yel); }
      .poster { font-size: 132px; font-weight: 900; line-height: 1; letter-spacing: -.02em; transform: skewX(-6deg); color: var(--cream);
        text-shadow: 6px 6px 0 var(--red), 12px 12px 0 #0b0c30; }
      .poster.y { color: var(--yel); text-shadow: 6px 6px 0 var(--red), 12px 12px 0 #0b0c30; }
      .poster.big { font-size: 190px; }
      .sub { font-family: "F Serif"; font-size: 48px; padding: 0 70px; color: var(--cream); }
      .small { font-size: 34px; font-weight: 700; letter-spacing: .06em; color: var(--yel); padding: 0 60px; }
      .bulb { position: absolute; width: 22px; height: 22px; border-radius: 50%; background: #ffe9a8; box-shadow: 0 0 14px 4px rgba(255,210,61,.8); }
      .spot { position: absolute; left: 90px; top: 380px; width: 900px; height: 1000px; border-radius: 50%;
        background: radial-gradient(ellipse at 50% 50%, rgba(255,240,200,.35) 0%, rgba(255,240,200,.08) 45%, transparent 70%); }
      .curtain { position: absolute; top: 0; bottom: 0; width: 560px;
        background: repeating-linear-gradient(90deg, #7a0f1c 0 40px, #a3172a 40px 70px, #5c0a15 70px 90px); box-shadow: 0 0 60px rgba(0,0,0,.7); }
      .curtain.l { left: 0; } .curtain.r { right: 0; }
      .rays { position: absolute; left: -760px; top: -700px; width: 2600px; height: 2600px; border-radius: 50%;
        background: repeating-conic-gradient(from 0deg, var(--red) 0 10deg, var(--yel) 10deg 20deg); opacity: .9; }
      .disc { position: absolute; left: 240px; top: 300px; width: 600px; height: 600px; border-radius: 50%; background-size: cover; background-position: 50% 15%;
        border: 14px solid var(--cream); box-shadow: 0 0 0 10px var(--red), 0 30px 80px rgba(0,0,0,.5); }
      .ribbon { position: absolute; left: 140px; right: 140px; height: 110px; background: var(--red); display: flex; align-items: center; justify-content: center;
        transform: rotate(-3deg); box-shadow: 0 14px 30px rgba(0,0,0,.4); }
      .ribbon::before, .ribbon::after { content: ""; position: absolute; top: 18px; width: 90px; height: 110px; background: #a3172a; z-index: -1; }
      .ribbon::before { left: -70px; clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 30% 50%); }
      .ribbon::after { right: -70px; clip-path: polygon(0 0, 100% 0, 70% 50%, 100% 100%, 0 100%); }
      .ribbon span { font-size: 54px; font-weight: 900; letter-spacing: .08em; color: var(--cream); }
      .pola { position: absolute; width: 470px; padding: 22px 22px 90px; background: var(--cream); box-shadow: 0 30px 70px rgba(0,0,0,.5); transform: rotate(var(--r)); }
      .pola.solo { width: 500px; }
      .pola .ph { width: 100%; height: 500px; background-size: cover; background-position: 50% 25%; }
      .pola .lab { position: absolute; left: 0; right: 0; bottom: 24px; text-align: center; font-size: 32px; font-weight: 900; letter-spacing: .04em; }
      .pola .tape { position: absolute; left: 50%; top: -24px; width: 170px; height: 52px; margin-left: -85px; background: rgba(255,210,61,.85); transform: rotate(-4deg); }
      .chips { position: absolute; left: 0; right: 0; text-align: center; }
      .chip { display: inline-block; margin: 0 12px; padding: 20px 36px; border-radius: 16px; font-size: 46px; font-weight: 900; color: var(--indigo); transform: rotate(-2deg);
        box-shadow: 6px 6px 0 #0b0c30; }
      .wax { position: absolute; left: 0; right: 0; top: 1180px; height: 170px; opacity: .95;
        background: repeating-linear-gradient(90deg, var(--yel) 0 60px, var(--red) 60px 120px, var(--grn) 120px 180px, var(--indigo) 180px 200px),
        var(--yel); -webkit-mask: radial-gradient(circle at 50% 50%, #000 0 34px, transparent 35px) 0 0 / 85px 85px; }
      .flag { position: absolute; left: 380px; top: 1160px; width: 320px; height: 210px; box-shadow: 0 20px 50px rgba(0,0,0,.5); }
      .flag .fr { position: absolute; left: 0; right: 0; top: 0; height: 50%; background: #ef2b2d; } .flag .fg { position: absolute; left: 0; right: 0; bottom: 0; height: 50%; background: #009e49; }
      .flag b { position: absolute; left: 0; right: 0; top: 46px; text-align: center; font-size: 110px; line-height: 1; color: #fcd116; font-family: "F Serif"; }
      .quote { position: absolute; left: 90px; right: 90px; top: 1420px; text-align: center; font-family: "F Serif"; font-size: 50px; line-height: 1.2; }
      .quote b { color: var(--yel); }
      .count { font-size: 320px; font-weight: 900; line-height: 1; color: var(--yel); text-shadow: 10px 10px 0 var(--red), 20px 20px 0 #0b0c30; }
      .tk { position: absolute; left: 70px; right: 70px; height: 220px; display: flex; border-radius: 22px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,.45); }
      .tk .tl { flex: 1; background: var(--cream); color: var(--indigo); padding: 40px 40px; display: flex; flex-direction: column; justify-content: center;
        border-right: 6px dashed var(--tc); }
      .tk .tl b { font-size: 50px; font-weight: 900; } .tk .tl span { font-family: "F Serif"; font-size: 38px; margin-top: 8px; opacity: .8; }
      .tk .tr { width: 300px; background: var(--tc); display: flex; align-items: center; justify-content: center; }
      .tk .tr em { font-style: normal; font-size: 78px; font-weight: 900; color: var(--cream); }
      .tel { display: inline-block; padding: 30px 56px; border-radius: 999px; background: var(--yel); color: var(--indigo); font-size: 80px; font-weight: 900; box-shadow: 8px 8px 0 var(--red); }
      #iris { position: absolute; inset: 0; background: var(--red); }
      #club { position: absolute; left: 0; top: 0; width: 120px; height: 420px; }
      #brand { position: absolute; left: 0; right: 0; top: 92px; text-align: center; font-size: 34px; font-weight: 900; letter-spacing: .35em; color: var(--yel); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{{TOTAL}}" data-width="1080" data-height="1920">
      <div id="bg" class="clip" data-start="0" data-duration="{{TOTAL}}" data-track-index="0" style="position:absolute;inset:0"><div id="pat"></div><div id="vign"></div></div>
{{SCENES}}
      <div id="chrome" class="clip" data-start="0" data-duration="{{TOTAL}}" data-track-index="3" style="position:absolute;inset:0">
        {{BULBS}}
        <div id="brand">FASO DÉH</div>
        <div id="iris"></div>
        <svg id="club" viewBox="0 0 120 420"><defs><linearGradient id="cg" x1="0" x2="1"><stop offset="0" stop-color="#c9ced6"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#8d939c"/></linearGradient></defs>
          <path d="M60 10 C 40 10, 46 70, 46 110 C 46 160, 14 220, 14 300 C 14 370, 40 410, 60 410 C 80 410, 106 370, 106 300 C 106 220, 74 160, 74 110 C 74 70, 80 10, 60 10 Z" fill="url(#cg)" stroke="#16195a" stroke-width="6"/>
          <path d="M28 250 C 50 240, 70 240, 92 250 M22 300 C 50 290, 70 290, 98 300" stroke="#e63946" stroke-width="12" fill="none"/></svg>
      </div>
    </div>
    <script>
      const CFG = {{CFG}};
      const CUES = []; const cue = (t, file, gain = .5) => CUES.push({ t: +t.toFixed(3), file, gain });
      document.querySelectorAll(".split").forEach((el) => { el.innerHTML = [...el.textContent].map(c => c === " " ? '<span class="sp"> </span>' : `<span class="ch">${c}</span>`).join(""); });
      const tl = gsap.timeline({ paused: true }); const T = CFG.total, P = "power4.out", B = "back.out(1.8)";
      const S = (i) => document.getElementById("s" + i), q = (i, sel) => [...S(i).querySelectorAll(sel)];
      const st = (i) => CFG.scenes[i][0], en = (i) => CFG.scenes[i][0] + CFG.scenes[i][1];
      function stamp(els, t, file = "accent.wav", g = .35) { tl.set(els, { opacity: 0 }, 0);
        tl.fromTo(els, { scale: 2.6, opacity: 0, rotate: -12 }, { scale: 1, opacity: 1, rotate: 0, duration: .32, ease: "power4.in", stagger: .06, immediateRender: false }, t); if (file) cue(t + .3, file, g); }
      function letters(els, t, s = .03) { tl.set(els, { opacity: 0 }, 0);
        tl.fromTo(els, { y: -120, opacity: 0, rotate: -20 }, { y: 0, opacity: 1, rotate: 0, duration: .45, ease: "bounce.out", stagger: s, immediateRender: false }, t); }
      function toss(el, t, from) { tl.set(el, { opacity: 0 }, 0);
        tl.fromTo(el, { x: from[0], y: from[1], rotate: from[2], opacity: 1 }, { x: 0, y: 0, rotate: el.style.getPropertyValue("--r") || 0, duration: .7, ease: "back.out(1.4)", immediateRender: false }, t);
        cue(t, "swoosh.wav", .3); cue(t + .55, "shutter.wav", .55); }
      // fond vivant + ampoules
      tl.fromTo("#pat", { x: 0, y: 0, rotate: 0 }, { x: -120, y: -240, rotate: 6, duration: T, ease: "none" }, 0);
      [...document.querySelectorAll(".bulb")].forEach((b, k) => { for (let s = 0; s < T; s += .5) tl.set(b, { opacity: (Math.floor(s / .5) + k) % 2 ? .35 : 1 }, s); });
      tl.set("#iris", { clipPath: "circle(0% at 50% 50%)" }, 0); tl.set("#club", { opacity: 0 }, 0);
      // transitions : quille qui traverse + iris rouge
      for (let i = 1; i < CFG.scenes.length; i++) { const t = st(i);
        tl.set("#club", { opacity: 1 }, t - .5);
        tl.fromTo("#club", { x: -200, y: 1500, rotate: 0 }, { x: 1150, y: 200, rotate: 720, duration: .6, ease: "power1.inOut", immediateRender: false }, t - .5);
        tl.set("#club", { opacity: 0 }, t + .12);
        tl.fromTo("#iris", { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)", duration: .3, ease: "power3.in", immediateRender: false }, t - .3);
        tl.fromTo("#iris", { clipPath: "circle(75% at 50% 50%)" }, { clipPath: "circle(0% at 50% 50%)", duration: .4, ease: "power3.out", immediateRender: false }, t);
        tl.to("#iris", { backgroundColor: ["#e63946", "#1d3fa6", "#1a8f5a", "#ffd23d", "#e63946", "#1d3fa6"][i - 1], duration: .01 }, t - .31);
        cue(t - .5, "whoosh.wav", .45); }
      tl.fromTo("#brand", { opacity: 0, y: -30 }, { opacity: 1, y: 0, duration: .5 }, .3);
      // 0 rideau
      tl.fromTo(q(0, ".curtain.l"), { x: 0 }, { x: -600, duration: 1.1, ease: "power2.inOut", immediateRender: false }, .15);
      tl.fromTo(q(0, ".curtain.r"), { x: 0 }, { x: 600, duration: 1.1, ease: "power2.inOut", immediateRender: false }, .15); cue(.1, "swoosh.wav", .4);
      stamp(q(0, ".pre"), .7, "bass.wav", .5);
      q(0, ".poster").forEach((p, k) => letters([...p.querySelectorAll(".ch")], 1.0 + k * .45, .025));
      cue(1.0, "accent.wav", .3);
      // 1 marque
      tl.fromTo(q(1, ".rays"), { rotate: 0 }, { rotate: 60, duration: CFG.scenes[1][1], ease: "none", immediateRender: false }, st(1));
      tl.set(q(1, ".disc"), { scale: 0 }, 0); tl.to(q(1, ".disc"), { scale: 1, duration: .6, ease: B }, st(1) + .1); cue(st(1) + .1, "cheer.wav", .35);
      letters(q(1, ".poster .ch"), st(1) + .5, .05);
      tl.set(q(1, ".ribbon"), { scaleX: 0 }, 0); tl.to(q(1, ".ribbon"), { scaleX: 1, duration: .5, ease: B }, st(1) + 1.2); cue(st(1) + 1.2, "bass.wav", .45);
      tl.set(q(1, ".sub"), { opacity: 0 }, 0); tl.to(q(1, ".sub"), { opacity: 1, duration: .4 }, st(1) + 1.7);
      // 2 disciplines
      toss(document.getElementById("q1"), st(2) + .15, [-900, 300, -60]);
      toss(document.getElementById("q2"), st(2) + 1.0, [900, -200, 70]);
      toss(document.getElementById("q3"), st(2) + 1.9, [-900, 500, -50]);
      stamp(q(2, ".chip"), st(2) + 3.0, "accent.wav", .35);
      // 3 culture
      tl.fromTo(q(3, ".wax"), { backgroundPosition: "0px 0px" }, { backgroundPosition: "-400px 0px", duration: CFG.scenes[3][1], ease: "none", immediateRender: false }, st(3));
      toss(document.getElementById("q4"), st(3) + .15, [0, -1400, 25]);
      tl.set(q(3, ".flag"), { scale: 0 }, 0); tl.to(q(3, ".flag"), { scale: 1, rotate: -4, duration: .5, ease: B }, st(3) + 1.0); cue(st(3) + 1.0, "bass.wav", .45);
      tl.set(q(3, ".quote"), { opacity: 0 }, 0); tl.fromTo(q(3, ".quote"), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .6, immediateRender: false }, st(3) + 1.8);
      // 4 participatif
      toss(document.getElementById("q5"), st(4) + .15, [-900, -300, -40]);
      toss(document.getElementById("q6"), st(4) + .8, [900, -300, 40]);
      const o = { v: 0 }, cnt = document.getElementById("cnt");
      tl.fromTo(o, { v: 0 }, { v: 120, duration: 1.6, ease: "power2.out", onUpdate: () => (cnt.textContent = Math.round(o.v)), immediateRender: false }, st(4) + 1.6);
      cue(st(4) + 1.4, "drumroll.wav", .35); cue(st(4) + 3.2, "cheer.wav", .4);
      tl.fromTo("#cnt", { scale: .6 }, { scale: 1, duration: .4, ease: B, immediateRender: false }, st(4) + 3.2);
      tl.set(q(4, ".sub"), { opacity: 0 }, 0); tl.to(q(4, ".sub"), { opacity: 1, duration: .4 }, st(4) + 3.3);
      // 5 billets
      stamp(q(5, ".pre"), st(5) + .1, "bass.wav", .45);
      cue(st(5) + .3, "drumroll.wav", .3);
      ["#t1", "#t2", "#t3", "#t4"].forEach((id, k) => { const t = st(5) + .5 + k * .55; tl.set(id, { opacity: 0 }, 0);
        tl.fromTo(id, { x: k % 2 ? 1100 : -1100, rotate: k % 2 ? 8 : -8, opacity: 1 }, { x: 0, rotate: k % 2 ? 1.5 : -1.5, duration: .5, ease: P, immediateRender: false }, t);
        cue(t + .35, "accent.wav", .3); tl.fromTo(id + " em", { scale: 2 }, { scale: 1, duration: .35, ease: B, immediateRender: false }, t + .35); });
      tl.set(q(5, ".small"), { opacity: 0 }, 0); tl.to(q(5, ".small"), { opacity: 1, duration: .4 }, st(5) + 3.0);
      // 6 fin
      stamp(q(6, ".pre"), st(6) + .1, "bass.wav", .45);
      q(6, ".poster").forEach((p, k) => letters([...p.querySelectorAll(".ch")], st(6) + .4 + k * .4, .04));
      tl.set(q(6, ".tel"), { scale: 0 }, 0); tl.to(q(6, ".tel"), { scale: 1, duration: .55, ease: B }, st(6) + 1.4); cue(st(6) + 1.4, "accent.wav", .4);
      tl.to(q(6, ".tel"), { scale: 1.07, duration: .35, yoyo: true, repeat: 5, ease: "sine.inOut" }, st(6) + 2.0);
      tl.set(q(6, ".sub"), { opacity: 0 }, 0); tl.to(q(6, ".sub"), { opacity: 1, duration: .4 }, st(6) + 1.8);
      tl.set(q(6, ".ribbon"), { scaleX: 0 }, 0); tl.to(q(6, ".ribbon"), { scaleX: 1, duration: .5, ease: B }, st(6) + 2.2);
      cue(st(6) + 2.0, "applause.wav", .45);
      window.__cues = CUES;
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
