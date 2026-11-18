> Detailed production guidance: load only for the current task. The SKILL.md entrypoint and current customer/project instructions take precedence. Section numbers below refer to this production manual; use the entrypoint guide table to locate a different topic. Do not assume any installed tool, private library, universal approval or specific narration provider.

## 3. Director / producer knowledge

- **Structure:** Hook (0–3 s) → Problem → Solution → Proof → CTA. Features framed as outcomes ("save 5 h/week", not "has automation").
- **Hook devices:** bold claim, pattern interrupt, question, result-first, visual surprise in frame 1. No logo intro.
- **Proof:** real UI, numbers, testimonials, before/after. Simplify UI (zoom, mask, highlight) rather than invent it.
- **One idea per shot**; on-screen text ≤ 6–8 words; leave reading time (≈ 0.3 s/word + 0.5 s).
- **Pacing:** reels cut every 0.5–2 s; explainers 2–5 s per idea; vary rhythm (fast–fast–hold). Cut on beats/consonants.
- **Shot vocabulary:** wide/medium/close/ECU, insert, OTS, POV; moves: push-in (importance), pull-out (reveal), pan/track (follow), parallax, dolly-zoom (tension), whip pan (transition), orbit (hero product).
- **Editing:** cut on action, J/L cuts (audio leads/lags), match cuts (shape/color/motion), jump-cut dead air, B-roll covers cuts.
- **CTA:** one clear action, shown + spoken, on screen ≥ 2 s.

## 4. Video type → editing intensity

| Type | Intensity | Do | Avoid |
|---|---|---|---|
| Editing showcase / reel / hook / personal brand | 🔥 5 – hyper | flashes, 3D text, rings, glitches, whips, punch zooms, SFX on every beat | dead air, static frames >1.5 s |
| Social ads / UGC | 4 – high | kinetic captions, punch zooms, stickers, emoji, fast cuts | slow intros |
| Educational / tutorial | 3 – medium | highlights, arrows, step counters, diagrams, calm music | effects that cover content |
| SaaS / product explainer | 2 – clarity-first | clean UI animation, focus zooms, cursor, smooth easing, subtle SFX; motion **supports the message** | gimmicks, shaky cams, flashes |
| Corporate / B2B / finance / health | 1 – restrained | lower thirds, fades, slow push-ins, generous whitespace | glitch, neon, hard flashes |

Rule: the more trust/clarity the message needs, the less decorative motion. Each effect must serve attention, emphasis, or transition.

---

## 5. Motion graphics catalogue (code-drawn)

- **Type:** kinetic captions (word pop, karaoke highlight), extruded 3D text, text behind subject (needs matte), 3D ring text orbiting subject, vertical neon words, script + bold font pairing, typewriter, mask reveals, split/scramble text.
- **Shapes/UI:** design-tool selection boxes + handles, cursor clicks, toggles, chat bubbles/DM, notification cards, follow button → "Following ✓" burst, progress bars, counters, charts that draw on.
- **Textures/looks:** halftone, B&W + spot color, paper/torn paper, ink/brush (p5.brush), grain, scanlines, film burn, bokeh, light leaks, neon glow, duotone.
- **Objects:** stickers with curl/peel, polaroids, tape, emoji, arrows (hand-drawn/neon), money/confetti rain, particles, Lottie icons.
- **3D (Three.js):** product orbit, floating cards, depth parallax of cutouts, camera fly-through, extruded logos.
- **Characters:** rigged 2D (bones/IK in Canvas), Lottie characters, consistent model sheet.

## 6. Raw-footage editing effects

Punch zoom (105–120 % on emphasis), smooth zoom-in on key line, whip pan / blur transitions, dutch tilts, shake on impact, white/red silhouette flash (matte), subject cutout + background swap, face/photo collage, captions behind subject, letterbox bars for "cinematic" moments, freeze frame + label, speed ramps, B&W punch-in, color pops, split-screen, zoom-through transitions, glitch/RGB split end cards, torn-paper wipes, ink wipes, jump-cuts removing silence.
Matting: RVM for video (fast, CPU-ok at 512 px), rembg/u2netp for stills, SAM2-tiny when a prompt/click is needed. Cache mattes in `cache/`, feather 1–2 px, erode slightly to avoid halos.

## 7. Animation principles (top motion designers)

- Disney's 12 principles: squash & stretch, anticipation, staging, follow-through/overlap, slow in/out, arcs, secondary action, timing, exaggeration, appeal (+ solid drawing, straight-ahead/pose-to-pose).
- **Easing:** never linear for UI; easeOutCubic/Expo for entrances, easeInCubic for exits, back/elastic only for playful brands. Entrances 200–500 ms, exits faster than entrances.
- **Stagger** related items 40–80 ms; overshoot 5–10 %; settle with small follow-through.
- **Hierarchy & eye-trace:** one focal point per moment; keep the next focal point near the previous one; lead with motion, then text.
- **Continuity:** consistent direction (forward = left→right), consistent easing family, consistent motion "language" per project.

## 8. Color & composition

- **60-30-10:** dominant / secondary / accent (accent = CTAs, highlights only).
- **Contrast:** text ≥ 4.5:1 (WCAG AA; ≥ 3:1 for large text); check value contrast in grayscale.
- **Schemes:** complementary for pop (e.g., teal/orange), analogous for calm, monochrome + one accent for premium. Stick to brand palette; derive tints/shades, don't invent hues.
- **Skin tones** must stay natural when grading; grade all clips consistently (one LUT/curve per project).
- **Composition:** rule of thirds, headroom, lead room in look direction, negative space for text, symmetry for hero shots.
- **Safe zones (9:16):** keep text/faces out of top ≈ 220 px and bottom ≈ 420 px, and right ≈ 140 px (platform UI). Captions around 60–70 % height.
- Max 2 typefaces (+1 script accent). Line length short, tracking tighter on big bold type.

## 11. 3D motion design — "go 3D when it matters"

Use **React Three Fiber + Drei** for new code-driven 3D scenes; keep the existing approved native Three.js renderer when it already works. Do not install competing frameworks or migrate an approved project without a concrete need. For a cinematic scene, load `cinematic-toolkit.md`; respect explicit 2D/3D character and world-style choices. Start with a short seated-pose/button/camera prototype. Never fake sitting by placing a standing sprite against a chair. For 2D characters, author articulated sprite pieces or a new seated pose in the approved pixel style, then validate seat, feet, hand/cup and paw/button contact across the allowed camera angles.

Default to crisp 2D; **switch to 3D for hero moments** (reveal, product, stat, logo, transition) — max 1 big 3D beat per 5–10 s at intensity ≤3.
- **2D→3D pop:** a flat layer (card, screenshot, text, photo) tilts in perspective (`rotateX 10–25°`, `rotateY 15–35°`), gains thickness (extrude 8–30 px, darker side faces), shadow + rim light, camera dolly/orbit; then flattens back to 2D on the next beat. In Canvas fake it with 2.5D (perspective/homography + stacked offset copies for depth); in Three.js use planes textured from Canvas (`CanvasTexture`) so 2D art and 3D share one pipeline.
- **3D→2D collapse:** shaded 3D object (monitor/phone) morphs into flat line-art outline (black 6–10 px stroke, white fill) → camera pushes *through* the screen into the next scene (recipe C).
- **Toolkit:** Three.js (`ExtrudeGeometry`/`TextGeometry` for type, `MeshPhysicalMaterial` + `RoomEnvironment` for chrome/glass, `EffectComposer` bloom/DOF/grain), card stacks & orbits, depth parallax of cutouts (subject z=0, text behind at z=−1, particles z=+1), cylindrical ring text, hyperspace streak tunnels, extruded logos, 3D picture frames, floating UI windows in perspective.
- **3D camera language:** slow push (0.5–2 %/s) on holds; fast dolly + motion blur for transitions; orbit 20–40° for products; rack focus (DOF) to switch attention; FOV 30–45° = premium, 60–75° = energy.
- **Render:** same deterministic `drawFrame(t)` → headless Chrome WebGL (`--use-angle=swiftshader` if no GPU) → ffmpeg. Fake motion blur by averaging 4–8 sub-frames. Do not add another rendering framework by default. Escalate genuinely unsupported requirements separately, with user approval.

## 12. Typography & kinetic type

- **Pairing systems that work:** (a) ultra-thin grotesk filler words + heavy/black keyword (recipe A); (b) chunky black grotesk + handwritten marker + script accent (B); (c) one geometric display sans, contrast by scale only (C, D); (d) serif headline + small sans UI labels for premium SaaS cards.
- **Hierarchy by scale, weight, color — not by number of fonts.** Keyword = 2–4× filler size; ≤1 keyword per caption group; keyword gets the accent color/gradient/glow.
- **Kinetic vocabulary:** per-word blur-in (blur 12→0 px, opacity 0→1, y +20→0, 180–250 ms, easeOutCubic); per-letter stagger 20–40 ms; tracking collapse (0.6 em → 0, logo lockups); word swap in the same slot ("Zero Alignment → Zero Momentum"); scramble/decode (random glyphs → final, mono); counter roll (38→48→50, ease-out, tick SFX); text behind subject (matte); text on 3D path/arc; directional echo trail (3–6 offset copies in accent color, falling opacity = colored motion blur, D); letter-by-letter dissolve-out; type morph into a circle badge (B); variable-font weight/width animation.
- **Placement:** captions orbit the subject (near face/hands), never cover eyes/mouth; change position per group to drive eye-trace; stay inside safe zones.
- **Readability pass (every caption, every frame):** measure the contrast of each word against what is *actually* behind it at that moment (busy footage, bright AI images, other layers). If < 4.5:1 → add a soft dark/light backing (blurred shadow 20–40 px, 40–60 %), outline 2–4 px, or move the word. Check with the contact sheets (§2b), not in your head.
- **Hook-word techniques that work (from reference analysis):** layered hero word (main fill + offset shadow copy + accent outline), binary/0-1 decode resolving into the word, mosaic/pixel resolve, smoke/dust puff on landing, pixel debris flying off, smear frames (≈ 0.15 s) on fast moves, slam-in with overshoot (scale 2.4 → 1 with squash). Put the strongest one in the first 3 s.
- **Finish:** 2-stop vertical gradient fills, subtle bevel/drop shadow (0 4 12 rgba(0,0,0,.35)), glow = blurred copy behind (8–24 px, accent, 60–80 %), 3–6 % grain over type for film looks.

### Font research & sourcing (before the design file — step 4)

Never pick fonts from memory or default to Inter/Poppins. Before the design file (§2 step 4) open `<skill>/reference/fonts.md`: define type roles → search the listed free font sites (Fontshare, Open Foundry, Free Design Resources, Typedump, Font Playground, Dirtyline, Google Fonts fallback) → 2–3 candidates per role shown side by side in `plan/design.html` → download from the official page into `assets/fonts/<Family>/` with the licence → `await document.fonts.ready` before frame 0. Personal-use-only fonts are not allowed in client/commercial work.
