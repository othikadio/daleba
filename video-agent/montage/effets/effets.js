/* Bibliothèque d'effets Kadio (GSAP + HyperFrames). Dépend de : tl, show(sel,t0,t1), fin(sel,t,d,a,b), cue(t,file,vol).
   Chaque effet : FX.nom(t, dur, opts) -> crée ses éléments et les anime de t à t+dur. Catalogue : catalogue.md */
const FX = (function () {
  let n = 0; const root = () => document.getElementById("root");
  function el(cls, html, style) { const d = document.createElement("div"); d.className = cls; d.id = "fx" + (++n); if (html) d.innerHTML = html; if (style) d.setAttribute("style", style); root().appendChild(d); return "#" + d.id; }
  const sfx = (t, f, v) => { if (typeof cue === "function") cue(t, f, v); };
  const CUR = '<svg viewBox="0 0 24 30" width="120" height="150"><path d="M2 1 L2 24 L8 18.5 L12 28 L16 26.3 L12 17 L20 17 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const X = {};
  // 01 Curseur : arrive hors champ, vise (x,y), clique
  X.curseur = function (t, dur, o) { o = o || {}; const x = o.x || 540, y = o.y || 960;
    const c = el("fx fx-cur", CUR, `left:${x}px;top:${y}px`), r = el("fx fx-ripple", "", `left:${x}px;top:${y}px`);
    show(c, t, t + dur); tl.fromTo(c, { x: o.dx || 520, y: o.dy || 700, rotate: 8 }, { x: 0, y: 0, rotate: 0, duration: .7, ease: "power3.out", immediateRender: false }, t);
    const tc = t + (o.click || .8); tl.to(c, { scale: .82, duration: .08, yoyo: true, repeat: 1 }, tc); sfx(tc, "click.wav", .35);
    show(r, tc, tc + .5); fin(r, tc, .45, { scale: .2, opacity: 1 }, { scale: 1.6, opacity: 0, ease: "power2.out" });
    if (o.exit !== false) tl.to(c, { x: -700, y: 600, duration: .5, ease: "power2.in" }, t + dur - .5); return tc; };
  // Carte app « Installing… » + barre + curseur
  X.carte = function (t, dur, o) { o = o || {};
    const s = el("fx fx-card", `<div class="hd"><div class="ic">${o.icone || "▶"}</div><div><div class="t1">${o.titre || "Kadio Coiffure"}</div><div class="t2">${o.sous || "Réservation en ligne"}</div></div></div><div class="bt"><span>${o.bouton || "Réserver"}</span></div><div class="pb"><i></i></div>`);
    show(s, t, t + dur); fin(s, t, .5, { opacity: 0, y: -60, scale: .92 }, { opacity: 1, y: 0, scale: 1, ease: "back.out(1.6)" }); sfx(t, "pop-long.wav", .25);
    const tc = X.curseur(t + .3, dur - .3, { x: 760, y: 700, click: .9 });
    tl.set(s + " .bt span", { textContent: o.bouton || "Réserver" }, 0); tl.set(s + " .bt span", { textContent: o.encours || "Réservation…" }, tc);
    tl.fromTo(s + " .pb i", { scaleX: 0 }, { scaleX: 1, duration: Math.max(.6, dur - 1.6), ease: "power1.inOut", immediateRender: false }, tc + .1); tl.set(s + " .pb i", { scaleX: 0 }, 0);
    if (o.fini) { tl.set(s + " .bt span", { textContent: o.fini }, t + dur - .45); sfx(t + dur - .45, "notif-positive.wav", .3); }
    tl.to(s, { opacity: 0, y: -40, duration: .3 }, t + dur - .3); };
  // Bande de sous-titre deux tons (mot dit = clair, mots à venir = pâles). mots = [[texte, temps], ...]
  X.bande = function (mots, o) { o = o || {}; const per = o.par || 4; const groups = [];
    for (let i = 0; i < mots.length; i += per) groups.push(mots.slice(i, i + per));
    groups.forEach(function (g, k) { const s = el("fx fx-band", '<div class="bx">' + g.map((m, q) => `<span class="w" data-q="${q}">${m[0]}</span>`).join(" ") + "</div>", o.top ? `top:${o.top}px` : "");
      const t0 = g[0][1] - .05, t1 = k + 1 < groups.length ? groups[k + 1][0][1] - .05 : g[g.length - 1][1] + 1.0; show(s, t0, t1);
      g.forEach(function (m, q) { const w = s + ` .w[data-q="${q}"]`; tl.set(w, { color: "rgba(243,239,228,.38)" }, 0); tl.set(w, { color: "#f3efe4" }, m[1]); }); }); };
  // 03 Cadran : roue de libellés qui tourne jusqu'à la cible
  X.cadran = function (t, dur, o) { o = o || {}; const L = o.libelles || ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"], cible = o.cible == null ? 5 : o.cible, st = 360 / L.length, R = 330;
    const s = el("fx fx-dial", '<div class="rg"></div><div class="ptr"></div><div class="wh" style="position:absolute;inset:0">' + L.map((l, i) => `<div class="lb" style="transform:rotate(${i * st}deg) translate(-50%,-${R}px) rotate(0deg)">${l}</div>`).join("") + "</div>");
    show(s, t, t + dur); fin(s, t, .4, { opacity: 0, scale: .85 }, { opacity: 1, scale: 1 });
    tl.fromTo(s + " .wh", { rotate: 180 }, { rotate: -cible * st, duration: dur * .6, ease: "power3.inOut", immediateRender: false }, t + .2); tl.set(s + " .wh", { rotate: 180 }, 0);
    for (let k = 0; k < 6; k++) sfx(t + .3 + k * dur * .08, "fit_tick_domino.wav", .15);
    const on = s + " .lb:nth-child(" + (cible + 1) + ")"; tl.set(on, { color: "rgba(255,255,255,.55)" }, 0); tl.set(on, { color: "#fff", scale: 1.25 }, t + .2 + dur * .6); sfx(t + .2 + dur * .6, "bass.wav", .25); };
  // 04 Touches : un mot tapé touche par touche
  X.touches = function (t, dur, o) { o = o || {}; const W = (o.mot || "KADIO").split("");
    const s = el("fx fx-keys", W.map(c => `<b>${c}</b>`).join("")); show(s, t, t + dur);
    W.forEach(function (c, i) { const q = s + ` b:nth-child(${i + 1})`, tt = t + .15 + i * Math.min(.22, (dur - .6) / W.length);
      fin(q, tt, .18, { opacity: 0, y: -60 }, { opacity: 1, y: 0, ease: "power3.out" }); tl.to(q, { y: 14, boxShadow: "0 2px 0 #9a9a9a, 0 8px 20px rgba(0,0,0,.4)", duration: .06, yoyo: true, repeat: 1 }, tt + .18); sfx(tt + .18, "type-click.wav", .3); }); };
  // 05 Anneau : texte qui tourne en orbite (ellipse) autour d'un point
  X.anneau = function (t, dur, o) { o = o || {}; const txt = (o.texte || "KADIO COIFFURE · LONGUEUIL · ") ;
    const s = el("fx fx-orbit", `<svg viewBox="0 0 900 900" width="900" height="900"><defs><path id="op${n}" d="M450,450 m-400,0 a400,140 0 1,1 800,0 a400,140 0 1,1 -800,0"/></defs><g class="rot"><text><textPath href="#op${n}">${txt.repeat(3)}</textPath></text></g></svg>`, o.top ? `top:${o.top}px` : "");
    show(s, t, t + dur); fin(s, t, .4, { opacity: 0, scale: .7 }, { opacity: 1, scale: 1 });
    tl.fromTo(s + " textPath", { attr: { startOffset: "0%" } }, { attr: { startOffset: "-33%" }, duration: dur, ease: "none", immediateRender: false }, t); sfx(t, "swoosh-wind.wav", .2); };
  // 07 Mur de posts : grille d'images qui se remplit + compteur
  X.mur = function (t, dur, o) { o = o || {}; const imgs = o.images || [], N = o.n || 64, tot = o.total || 1711;
    const s = el("fx fx-wall", Array.from({ length: N }, (_, i) => `<i style="background-image:url(${imgs[i % Math.max(imgs.length, 1)]})"></i>`).join(""));
    const c = el("fx fx-count", "0"); show(s, t, t + dur); show(c, t, t + dur);
    tl.to(s + " i", { opacity: 1, duration: .05, stagger: { each: (dur * .6) / N, from: "random" } }, t);
    const obj = { v: 0 }; tl.fromTo(obj, { v: 0 }, { v: tot, duration: dur * .7, ease: "power2.out", immediateRender: false, onUpdate: function () { const e = document.querySelector(c); if (e) e.textContent = Math.round(obj.v).toLocaleString("fr-CA") + (o.suffixe || ""); } }, t);
    sfx(t, "sweep-small.wav", .3); };
  // Commentaires qui tombent
  X.commentaires = function (t, dur, o) { o = o || {}; const C = o.liste || [["kadiocoiffure", "Réserve en commentant RDV 👇"], ["client", "RDV"]];
    C.forEach(function (c, i) { const s = el("fx fx-com", `<div class="av">${c[0][0].toUpperCase()}</div><div><div class="nm">${c[0]} · maintenant</div><div class="tx">${c[1]}</div></div><div class="ht">♥</div>`, `top:${(o.top || 140) + i * 170}px`);
      const tt = t + i * .55; show(s, tt, t + dur); fin(s, tt, .45, { opacity: 0, y: -120 }, { opacity: 1, y: 0, ease: "back.out(1.8)" }); sfx(tt, "notif-positive.wav", .25); }); };
  // 10 Croquis : mot dessiné au crayon puis rempli
  X.croquis = function (t, dur, o) { o = o || {}; const s = el("fx fx-sketch", `<svg viewBox="0 0 1000 400" width="1000" height="400"><text x="500" y="290" text-anchor="middle">${o.mot || "propre"}</text></svg>`, o.top ? `top:${o.top}px` : "");
    show(s, t, t + dur); tl.fromTo(s + " text", { strokeDasharray: 3000, strokeDashoffset: 3000, fill: "rgba(58,42,32,0)" }, { strokeDashoffset: 0, duration: dur * .6, ease: "power1.inOut", immediateRender: false }, t);
    tl.to(s + " text", { fill: o.couleur || "rgba(58,42,32,1)", duration: .4 }, t + dur * .6); tl.set(s + " text", { strokeDashoffset: 3000, fill: "rgba(58,42,32,0)" }, 0); sfx(t, "sweep-small.wav", .2); };
  // 11 Lame : l'image se découpe en bandes qui glissent, avec étiquettes
  X.lame = function (t, dur, o) { o = o || {}; const src = o.image, B = o.bandes || 3, h = 1920 / B, tags = o.etiquettes || [];
    for (let i = 0; i < B; i++) { const s = el("fx-blade", `<img src="${src}" style="top:${-i * h}px">`, `top:${i * h}px;height:${h}px;z-index:65`); show(s, t, t + dur);
      fin(s, t + .1, .5, { x: 0 }, { x: (i % 2 ? 1 : -1) * 90, ease: "power3.out" }); tl.to(s, { x: 0, duration: .4, ease: "power3.in" }, t + dur - .45);
      if (tags[i]) { const g = el("fx fx-tag", tags[i], `left:${i % 2 ? 640 : 80}px;top:${i * h + h / 2 - 30}px`); show(g, t + .3 + i * .15, t + dur - .4); fin(g, t + .3 + i * .15, .3, { scale: 0 }, { scale: 1, ease: "back.out(2)" }); } }
    sfx(t + .1, "whoosh-fast.wav", .3); sfx(t + dur - .45, "cut_hit_sub.wav", .25); };
  // 13 Mise au point : arrière-plan flou -> net (ou l'inverse)
  X.miseaupoint = function (t, dur, sel, o) { o = o || {}; tl.fromTo(sel, { filter: "blur(" + (o.de || 18) + "px)" }, { filter: "blur(" + (o.a || 0) + "px)", duration: dur, ease: "power2.inOut", immediateRender: false }, t); };
  // 14 Billet : portrait gravé dans un billet de banque
  X.billet = function (t, dur, o) { o = o || {}; const s = el("fx-full fx-note", `<div class="gl"></div><div class="ov"><img src="${o.image}"></div><div class="n" style="left:60px;top:40px">${o.num || "65"}</div><div class="n" style="right:60px;top:40px">${o.num || "65"}</div><div class="n" style="left:60px;bottom:30px">${o.num || "65"}</div><div class="n" style="right:60px;bottom:30px">${o.num || "65"}</div><div class="bt">${o.texte || "CLUB KADIO"}</div>`);
    show(s, t, t + dur); fin(s, t, .5, { opacity: 0, scale: 1.15, rotate: -4 }, { opacity: 1, scale: 1, rotate: 0, ease: "power3.out" }); sfx(t, "shutter-vintage.wav", .3);
    tl.fromTo(s + " .ov img", { scale: 1.15 }, { scale: 1, duration: dur, ease: "none", immediateRender: false }, t); };
  // 15 Note vocale : bulle avec onde qui joue
  X.notevocale = function (t, dur, o) { o = o || {}; const s = el("fx fx-voice", '<div class="pl"></div><div class="wv">' + Array.from({ length: 34 }, () => "<i></i>").join("") + '</div><div class="tm">0:00</div>', o.top ? `top:${o.top}px` : "");
    show(s, t, t + dur); fin(s, t, .4, { opacity: 0, x: -80 }, { opacity: 1, x: 0, ease: "back.out(1.6)" }); sfx(t, "pop-bubble.wav", .3);
    for (let k = 0; k < Math.floor(dur * 6); k++) tl.to(s + " .wv i", { height: () => (15 + Math.random() * 85) + "%", duration: .16, stagger: .004 }, t + .3 + k / 6);
    for (let k = 0; k <= Math.floor(dur); k++) tl.set(s + " .tm", { textContent: "0:0" + k }, t + k); tl.set(s + " .tm", { textContent: "0:00" }, 0); };
  // 16 Image choc : effet BD noir et blanc + lignes de vitesse + mot
  X.impact = function (t, dur, o) { o = o || {}; const s = el("fx-full fx-impact", `<img src="${o.image}"><div class="ln"></div><div class="wd">${o.mot || "IMPACT"}</div>`);
    show(s, t, t + dur); tl.fromTo(s, { scale: 1.25 }, { scale: 1, duration: .25, ease: "power4.out", immediateRender: false }, t); sfx(t, "cut_hit_sub.wav", .45);
    tl.fromTo(s + " .ln", { rotate: 0 }, { rotate: 6, duration: dur, ease: "none", immediateRender: false }, t);
    fin(s + " .wd", t + .15, .25, { scale: 2.2, opacity: 0 }, { scale: 1, opacity: 1, ease: "power4.out" }); };
  // 17 Zoom dolly (approché) : le fond recule pendant que le sujet avance
  X.dolly = function (t, dur, sel) { tl.fromTo(sel, { scale: 1.0 }, { scale: 1.35, duration: dur, ease: "power2.inOut", immediateRender: false }, t);
    tl.fromTo(sel, { filter: "blur(0px)" }, { filter: "blur(3px)", duration: dur / 2, yoyo: true, repeat: 1, immediateRender: false }, t); sfx(t, "swoosh-wind.wav", .25); };
  // 18 Une de journal
  X.journal = function (t, dur, o) { o = o || {}; const lorem = "Chez Kadio Coiffure, chaque coupe est pensée pour toi : consultation, dégradé, contour, barbe. Une équipe passionnée à Longueuil. ".repeat(6);
    const s = el("fx-full fx-press", `<div class="mh">${o.journal || "Le Kadio Quotidien"}</div><div class="dt"><span>LONGUEUIL</span><span>${o.date || "ÉDITION SPÉCIALE"}</span><span>PRIX : 0 $</span></div><div class="hl">${o.titre || "Une coupe nette"}</div><div class="sh">${o.sous || "Le dégradé en 5 étapes"}</div><div class="pp"><img src="${o.image}"></div><div class="cl" style="left:50px">${lorem}</div><div class="cl" style="right:50px">${lorem}</div>`);
    show(s, t, t + dur); fin(s, t, .6, { rotate: 540, scale: .05 }, { rotate: 0, scale: 1, ease: "power3.out" }); sfx(t, "whoosh-cine.wav", .3); sfx(t + .6, "shutter.wav", .3); };
  // 19 Déchirure de papier (transition qui s'ouvre)
  X.dechirure = function (t, dur) { const s = el("fx-full fx-tear", '<div class="pc a"></div><div class="pc b"></div>'); show(s, t, t + dur);
    fin(s + " .pc.a", t + .15, dur - .2, { y: 0, rotate: 0 }, { y: -1150, rotate: -4, ease: "power3.in" }); fin(s + " .pc.b", t + .15, dur - .2, { y: 0, rotate: 0 }, { y: 1150, rotate: 3, ease: "power3.in" }); sfx(t + .1, "swoosh-wind.wav", .4); };
  // 09 Couches qui explosent en 3D
  X.couches = function (t, dur, o) { o = o || {}; const L = o.libelles || ["PHOTO", "COULEUR", "TEXTE", "SON"];
    const s = el("fx-full fx-layers", L.map((l, i) => `<div class="ly" style="background-image:url(${o.image});opacity:${i ? .55 : 1}"><div class="lt">${l}</div></div>`).join("")); show(s, t, t + dur);
    L.forEach(function (l, i) { const q = s + ` .ly:nth-child(${i + 1})`; fin(q, t + .1, .8, { rotateY: 0, z: 0, x: 0 }, { rotateY: -38, z: -i * 260, x: i * 60, ease: "power3.inOut" }); });
    sfx(t + .1, "sweep-small.wav", .3); };
  // 06 Corps en code : image ASCII (générée par ascii.py) révélée ligne par ligne
  X.code = function (t, dur, o) { o = o || {}; const s = el("fx-full fx-code", `<img src="${o.ascii}">`); show(s, t, t + dur);
    fin(s + " img", t, dur * .7, { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", ease: "none" }); sfx(t, "type-click.wav", .25); };
  // 20 Envol : l'image se désagrège en morceaux emportés par le vent
  X.envol = function (t, dur, o) { o = o || {}; const C = o.col || 12, R = o.lig || 20, w = 1080 / C, h = 1920 / R; let html = "";
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) html += `<i style="left:${c * w}px;top:${r * h}px;width:${w + 1}px;height:${h + 1}px;background-image:url(${o.image});background-position:-${c * w}px -${r * h}px" data-c="${c}" data-r="${r}"></i>`;
    const s = el("fx-full fx-blow", html); show(s, t, t + dur);
    tl.to(s + " i", { x: () => 600 + Math.random() * 900, y: () => -300 + Math.random() * 400, rotate: () => Math.random() * 360, opacity: 0, duration: dur * .7, ease: "power2.in", stagger: { each: (dur * .3) / (C * R), from: "start", grid: [R, C], axis: "x" } }, t + .1);
    sfx(t + .1, "swoosh-wind.wav", .45); };
  // 21 Texte derrière la personne (photo + détourage) : le mot passe entre le fond et le sujet
  X.derriere = function (t, dur, o) { o = o || {}; const s = el("fx-full fx-cut", `<img class="bgi" src="${o.image}"><div class="big" style="color:${o.couleur || "#fff"}">${o.mot || "KADIO"}</div><img class="fg" src="${o.detoure}">`);
    show(s, t, t + dur); fin(s + " .big", t + .1, .6, { y: 160, opacity: 0, scale: .9 }, { y: 0, opacity: 1, scale: 1, ease: "power3.out" }); sfx(t + .1, "bass.wav", .3);
    tl.fromTo(s + " .bgi, " + s + " .fg", { scale: 1.08 }, { scale: 1, duration: dur, ease: "none", immediateRender: false }, t); };
  // 22 Rangée de clones : la personne détourée se multiplie côte à côte
  X.clones = function (t, dur, o) { o = o || {}; const N = o.n || 5, sc = o.echelle || .55, w = 1080 * sc;
    let h = `<img class="bgi" src="${o.image}" style="filter:blur(14px) brightness(.55)">`;
    for (let i = 0; i < N; i++) h += `<img class="cl" src="${o.detoure}" style="left:${(i - (N - 1) / 2) * w * .62 + 540 - 540}px;transform:scale(${sc});transform-origin:50% 100%;z-index:${10 - Math.abs(i - (N - 1) / 2)}">`;
    const s = el("fx-full fx-cut", h); show(s, t, t + dur);
    for (let i = 0; i < N; i++) { const q = s + ` .cl:nth-of-type(${i + 2})`, d = Math.abs(i - (N - 1) / 2); fin(q, t + .1 + d * .12, .4, { opacity: 0, y: 200 }, { opacity: 1, y: 0, ease: "back.out(1.5)" }); sfx(t + .1 + d * .12, "pop-hard.wav", .18); } };
  // 23 Pile de têtes : copies du sujet empilées en hauteur, de plus en plus petites
  X.pile = function (t, dur, o) { o = o || {}; const N = o.n || 4;
    let h = `<img class="bgi" src="${o.image}" style="filter:brightness(.6)">`;
    for (let i = N - 1; i >= 0; i--) h += `<img class="cl" src="${o.detoure}" style="left:0;transform:translateY(${-i * 300}px) scale(${1 - i * .14});transform-origin:50% 100%">`;
    const s = el("fx-full fx-cut", h); show(s, t, t + dur);
    for (let i = 0; i < N; i++) { const q = s + ` .cl:nth-of-type(${N - i + 1})`; fin(q, t + .1 + i * .2, .35, { opacity: 0 }, { opacity: 1 }); sfx(t + .1 + i * .2, "click.wav", .2); } };
  // Liste « Dans cette vidéo » qui suit la progression
  X.liste = function (t0, t1, items, temps) { const s = el("fx fx-list", `<div class="hd"><span>DANS CETTE VIDÉO</span><span class="ct">01 / ${String(items.length).padStart(2, "0")}</span></div>` + items.map((x, i) => `<div class="it"><small>${String(i + 1).padStart(2, "0")}</small>${x}</div>`).join(""));
    show(s, t0, t1); fin(s, t0, .4, { opacity: 0, x: 60 }, { opacity: 1, x: 0 });
    temps.forEach(function (tt, i) { const q = s + ` .it:nth-child(${i + 2})`; tl.set(q, { backgroundColor: "rgba(0,0,0,0)", color: "#fff" }, 0); tl.set(q, { backgroundColor: "#fff", color: "#10392c" }, tt); if (i + 1 < temps.length) tl.set(q, { backgroundColor: "rgba(0,0,0,0)", color: "#fff" }, temps[i + 1]);
      tl.set(s + " .ct", { textContent: String(i + 1).padStart(2, "0") + " / " + String(items.length).padStart(2, "0") }, tt); }); };
  return X;
})();
