# TASTE – <project name>
<!--
  TASTE MEMORY of this motion-graphics project. Written and kept up to date by the AI agent.
  PURPOSE: a brand-new chat (any agent, any model) must be able to read ONLY this file
  (+ PROGRESS.md) and continue making scenes that look, move and sound exactly like the
  approved ones — same theme, same concept, same design system, same feel.
  RULES FOR THE AI:
   - Fill it as soon as a decision is approved (style board, preview, feedback). Never leave "TBD" for something already decided.
   - Write concrete, buildable values (hex codes, font files, px sizes, ms timings, easing names, dB levels, file paths), not vague words.
   - Overwrite sections 1–8 when a decision changes (note the old value in §10). Section 9 (feedback rules) is append-only.
   - Read this file BEFORE planning, before building any new scene, and first thing in every new chat.
-->
Updated: YYYY-MM-DD HH:mm · by: <agent> · current version: v<N> → renders/final/<name>_v<N>.mp4
Status of this file: draft | approved style (locked) ← only "approved" values may be reused without asking
Visual version for the user: plan/design.html (same values as §2–§5 — always update both together)

## 1. Brief, concept & story (what we are making and why)
- **One-line concept:** <e.g. "A pixel-art founder fights a giant 'busywork' monster; words decode from binary">
- **Video type / platform / format:** <e.g. Instagram Reel, 9:16 1080×1920, 30 fps, 45 s> · series part <1 of 3?>
- **Audience & goal / CTA:** <who, what they should do>
- **Brand inputs:** <logo/colours/fonts given by the user, files in assets/> · **use:** <personal | client/commercial (licences!)> · **deadline:** <…>
- **Story world & characters:** <setting, characters + personality, recurring props, what each character looks like (link model sheet: assets/…)>
- **Narrative structure:** <hook → problem → solution → proof → CTA, with seconds>
- **Pipeline:** <A code-drawn / B mixed AI assets / C footage edit, per scene if mixed (§2c)>

## 2. Theme & feel (the "sense" of the video)
- **Mood words (3–5):** <e.g. playful · techy · retro-arcade · confident>
- **Theme / visual world:** <e.g. dark 8-bit pixel world with teal-binary tech overlays, CRT grain>
- **Intensity level:** <1–5 (§4)> · **pacing:** <cut every X s, hold on hero words Y s>
- **Feels like (references):** <file in assets/refs/ or link — what exactly to copy from it (technique, timing, sound)>
- **Must NOT feel like:** <e.g. corporate stock template, glossy 3D, trailer-style>

## 3. Visual design system
- **Palette (hex + role, 60-30-10):** background <#…> · primary <#…> · accent <#…> (only hero words/CTA) · text <#…> · shadow/outline <#…>
- **Typography:** display <family, weight, file path> · keyword <…> · captions <…> · sizes (px at 1080 w): filler <…>, keyword <…>, hero <…> · tracking/leading <…> · case <…>
- **Text treatment:** <fill, outline px, offset shadow (x,y,color), glow, backing rule for contrast>
- **Layout:** caption zone <y % / px>, safe area <top/bottom/right px>, alignment <…>, max words per group <…>
- **Textures & finish:** <grain %, scanlines, halftone, vignette, grade/LUT file>
- **Illustration / asset style:** <pixel size (e.g. 6 px grid), line weight, shading style, character proportions, AI-image prompt + style-sheet file for pipeline B>
- **Backgrounds & environments:** <…>

## 4. Motion language
- **Easing family:** <entrances easeOutExpo 280 ms, exits easeInCubic 180 ms, overshoot 8 %>
- **Text animation:** <per-word pop / blur-in / binary decode → mosaic resolve / slam 2.45→1, stagger 60 ms>
- **Signature devices (repeat these for consistency):** <e.g. smoke puff + pixel debris on hero words, smear frames 0.15 s, tumble smoke on falls>
- **Transitions:** <hard cut on beat / pixel wipe / zoom-through…>
- **Camera:** <static / slow push 2 %/s / shake on impact (amp px, duration)>
- **Character acting rules:** <idle bob, blink rate, how gestures read, no frozen poses > 1 s>

## 5. Sound identity
- **Text SFX:** <type (soft dry ticks/pops), 40–150 ms, one per word, level vs VO (e.g. −7 dB)>, files: <assets/sfx/…>
- **Hero / impact sounds:** <…> · **decode ticks:** <…> · **transitions:** <…>
- **Foley:** <cloth rustle on arm moves, footsteps, creature chirps…>
- **Music:** <track/file, BPM, licence, level under VO>
- **Mix targets:** SFX <5–10> dB under VO · loudness <−14 / −12.8 LUFS>, TP ≤ −1.5 dBTP
- **Banned sounds:** <e.g. long whooshes, risers, jet/thruster swooshes on text>

## 6. Voice
- **VO:** <ElevenLabs voice name/ID, model, settings (stability, similarity, style, speed)>, tone <…>, files <assets/vo/…>
- **Script style:** <short punchy lines, audio tags used, words to pronounce specially>

## 7. Technical setup (so a new chat can render immediately)
- **Render:** `<command>` (CLI contract §2) · preview: `node scripts/preview.mjs <from> <to>`
- **Key code files:** <src/scenes/…, src/fx/…, timing in plan/beats.json / src/data.js>
- **Reusable modules that define the look:** <e.g. src/fx/fx5.py = hero-word effects; src/pixel_chars.py = character renderer>
- **Assets that must be reused:** <fonts, sprites, LUT, SFX set folder>

## 8. Do / Don't (quick rules)
- DO: <…>
- DON'T: <…>

## 9. Feedback rules log (append-only — the user's taste, learned round by round)
| Date | Version | User said | Rule we keep from now on |
|---|---|---|---|
| YYYY-MM-DD | v1 | "<quote/paraphrase>" | <general rule, e.g. "every caption word ≥ 4.5:1 contrast on its real background"> |

## 10. Decision history (what changed and why)
- YYYY-MM-DD · v2 · <old value> → <new value> · because <reason>

## 11. Continue-in-a-new-chat checklist (for the next AI)
1. Read this file fully, then PROGRESS.md (next step) and the tail of LOG.md.
2. Open plan/design.html (screenshot it) + the latest approved render / contact sheets (renders/previews/) to SEE the style before writing code.
3. Reuse the modules/assets in §7 — don't rebuild the look from scratch, don't change fonts/palette/SFX set.
4. Any new scene must pass: palette only from §3 · fonts only from §3 · motion devices from §4 · sounds from §5 · all §9 rules.
5. If something new is needed that this file doesn't cover, propose it to the user in the same style, then add it here once approved.
