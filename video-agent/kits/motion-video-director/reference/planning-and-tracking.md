# Contents
- Planning and tracking
- Project structure & tracking (lean — every file has one job, nothing is duplicated)
- Plain naming and clean review folders
- 2. Workflow (gates in **bold** need user approval)
- 2b. Fast preview loop (use after EVERY change)
- 2c. Three production pipelines (choose per video, or mix per scene — write the choice in TASTE.md §1)

> Detailed production guidance: load only for the current task. The SKILL.md entrypoint and current customer/project instructions take precedence. Section numbers below refer to this production manual; use the entrypoint guide table to locate a different topic. Do not assume any installed tool, private library, universal approval or specific narration provider.

# Planning and tracking

## Project structure & tracking (lean — every file has one job, nothing is duplicated)

```
<project>/
  TASTE.md          # THE memory: brief + concept, theme, design system, motion, sound, voice, feedback rules (from <skill>/templates/TASTE.md) — read FIRST in every chat
  PROGRESS.md       # where we are now: phase, approvals, next step, open feedback (short, overwritten)
  LOG.md            # append-only history: what, why, files, result
  manifest.json     # every asset: path, source, licence, author, used_in (credits come from here)
  .env, .gitignore  # API keys (created by create_env.py, never printed) · ignores .env, node_modules/, cache/
  plan/
    design.html     # the VISUAL design file the user opens in the browser (from <skill>/templates/design.html)
    script.md       # approved VO script (AV table + paste-ready ElevenLabs block, §10a)
    storyboard.md   # per shot: time · VO line · visual · motion · transition · SFX · on-screen text
    beats.json      # the ONLY timing source (locked to VO word timestamps) — src reads it directly
    frames/         # code-rendered key frames shown in design.html (created when needed)
  assets/           # inputs only; subfolders created on first use: vo/ sfx/ music/ fonts/<Family>/ images/ footage/ lottie/ refs/ ai/
  src/              # scene code + render.js (CLI contract, §2)
  renders/          # previews/ (named review clips only) · final/ (named approved versions) · logs/ (render output)
  cache/            # regenerable stuff, created by the tools (frames, stems, ref analysis, browser downloads) — safe to delete
```
**Not in the project (shared, saves GBs and setup time):** model weights live once in `~/.cache/motion-video-director/models/` (PANNs, CLAP, Demucs/whisper caches; override with `MVD_MODELS`), the skill's tools stay in `<skill>/scripts/`. Only add `package.json`/`node_modules` when you install render libraries, and a project `scripts/` folder only for project-specific helpers (e.g. a custom fetch script).

**What goes where:**
| File | Job | Write / read |
|---|---|---|
| `TASTE.md` | Brief + concept (§1 of the file), theme & feel, design system, motion language, sound identity, voice, technical setup, do/don't, feedback rules, decision history, new-chat checklist | Fill each part the moment it is approved; read first in every chat (details below) |
| `plan/design.html` | The visual version of TASTE §2–§5: concept & feel, colours, every font written in its own typeface (with what it is used for + a real sample line), live looping text-animation demos, key frames, sound table, do/don't | Created at step 4; the user double-clicks it to review; updated whenever the style changes (same values as TASTE.md) |
| `PROGRESS.md` | Phase, **approvals (date + what)**, next step, open feedback, key file paths (template below) | Overwrite after every step/decision and before long renders |
| `LOG.md` | `YYYY-MM-DD HH:mm · action · why · files · result` | Append after every meaningful step; never rewrite |
| `manifest.json` | `{ "path", "type", "source_url", "author", "license", "license_file", "used_in" }` | The moment a file is downloaded/received |
| `plan/script.md` · `storyboard.md` · `beats.json` | VO script · shot plan · timing | Steps 2, 3, 5; changes → new version + LOG entry |
| `assets/…` | User files + downloads, descriptive names (`keycap_lime_macro_01.jpg`); VO in `assets/vo/` | Whenever an asset is added (+ manifest entry) |
| `renders/` | `previews/` user-facing review clips only · `final/` approved versions · `logs/` render output; sheets and silent intermediates belong in cache | §2b, §2 step 7 |
- **`PROGRESS.md` is mandatory in every project.** Create it during Preflight and update it after every finished step, every user decision, and before any long render. Write it so a fresh session can continue from it alone (chats get long and context is lost). Keep it short and overwrite it, unlike the append-only LOG. Template:
  ```
  # PROGRESS – <project>   (updated YYYY-MM-DD HH:mm)
  Phase: <brief|script|storyboard|style|assets|preview|final|DONE>
  Current version: v3 → renders/final/<name>_v3.mp4
  Done: - …
  In progress: - …
  Next step: <one concrete action>
  Open issues / user feedback not yet fixed: - …
  Approvals: - YYYY-MM-DD script ✓ · design.html ✓ · preview v2 ✓
  (style decisions and taste rules go in TASTE.md, not here)
  Key files: src/…, plan/beats.json, assets/…
  ```
- **`TASTE.md` is mandatory in every project — the style memory for continuity across chats.** Copy `templates/TASTE.md` from the skill in Preflight. It records *what* we are making and *how it must look, move and sound*: concept & story, theme & feel (mood words, references, what it must not feel like), visual design system (palette hex + roles, fonts + sizes, text treatment, layout/safe area, textures, illustration style), motion language (easing, text animation, signature devices, transitions), sound identity (SFX types, levels, banned sounds), voice settings, technical setup (render command, the code modules/assets that define the look), do/don't rules, an append-only feedback-rules log, decision history and a "continue in a new chat" checklist.
  - **When to write it:** concept + theme after the brief (§2 step 1); design system + motion language when `plan/design.html` is approved (step 4); sound identity after the SFX map; technical setup once the render pipeline works; a feedback rule after every review round (the *general rule*, not just the fix); update + note in decision history whenever an approved value changes. Mark the file `approved style (locked)` after the plan approval. TASTE.md (text, for agents) and `plan/design.html` (visual, for the user) always carry the same values — change both together.
  - **Concrete values only** (hex, file paths, px, ms, easing names, dB), so another agent can rebuild the look without seeing the chat.
  - **Every new chat / resume:** read TASTE.md completely before planning or writing code; every new scene must use only its palette, fonts, motion devices and sounds and pass every feedback rule. Anything new: propose it in the same style, then add it once approved.
  - Ask the user once whether to also keep a **global** taste file (e.g. `~/motion-taste/TASTE.md` or a folder they choose) that collects the cross-project rules (§8–§9) and is copied into each new project.
- When a session resumes (or after context compaction), read `TASTE.md`, then `PROGRESS.md`, then the end of `LOG.md` — before doing anything else.
- Append to `LOG.md` after every meaningful step. Record license/attribution for every downloaded asset in `manifest.json`.
- Version outputs (`_v1`, `_v2`); never overwrite an approved render.
- **Render logs:** run every render with its output saved, e.g. `node src/render.js --from 0 --to 56 --fps 30 --scale 1 --out renders/final 2>&1 | tee renders/logs/<name>_v3.log` (PowerShell: `… 2>&1 | Tee-Object renders/logs/<name>_v3.log`). Then add a LOG.md entry with the log path, render time and result. If a render fails, read the end of its log first before changing code.
- Keep timings only in `plan/beats.json` (driven by the transcript); `src` reads it directly, so retiming = edit one file.

---

### Plain naming and clean review folders
- Name user-facing files by **part or scene + purpose + one version**, e.g. `Part 3 - Scene Prototype v1.mp4`, `Part 3 - Preview v4.mp4`, `Part 3 - Final v1.mp4`, `Part 3 - Seated Pose v1.jpg`. Do not put line ranges, hashes, timestamps, codec settings, resolutions, `fixed_final_FINAL` or unexplained technical suffixes in review filenames.
- Keep previews in `renders/previews`, approved deliveries in `renders/final`, logs in `renders/logs`. Keep dense sheets, numbered frames, silent passes, analysis and intermediate mixes in `cache/<scene>/review/vN`. Do not expose a folder full of diagnostic files as the deliverable.
- Name inputs descriptively, e.g. `claude-pet.png`, `studio-wall.jpg`, `button-press-soft-01.wav`. Use `-01`, `-02` only for genuine alternatives; avoid cryptic generated names. Preserve an existing input name unless renaming improves clarity and all references/manifest entries are updated atomically.
- Keep version increments explicit. Never overwrite an approved file. Label prototype versus full-section preview accurately; a successful render is not user approval.
- Offer to move superseded outputs to archive/Recycle Bin after approval; never clean or rename another approved part without permission.

---

## 2. Workflow (gates in **bold** need user approval)

0. **References + story (required intake)** – after the kickoff message (§0a), collect: reference videos/links/screenshots, the story/plan (what happens, key message), audience, platform & format, target length, tone, CTA, brand assets, must-haves/must-avoids. If references are given, run §13 (optional separation diagnostics only if useful, §0d) and present the recipe. Don't continue until you have at least the story and length.
1. **Brief** – goal, audience, platform & aspect (9:16 1080×1920 / 16:9 1920×1080 / 1:1), length, brand (logo, palette, fonts), CTA, references, video type → intensity level (§4). Ask only what's missing.
2. **VO script for ElevenLabs** – write it with the §10 guide: AV two-column script (Audio | Visual) for the plan + one **paste-ready ElevenLabs block** with model, voice and settings. Hook in first 3 s. → **Approve script.** → **The user generates the MP3 and sends it back** (`assets/vo/`). Steps 3+ (and any scene code) start only after the MP3 arrives.
3. **Storyboard** (`plan/storyboard.md`) – per shot: time, VO line, visual, motion, transition, SFX, text on screen. Beat sheet with seconds.
4. **Design file** – copy `<skill>/templates/design.html` to `plan/design.html` and fill only its `DESIGN` object: concept + mood, palette (hex + what each colour is for), fonts (research → download first, §12; each font is shown **written in its own typeface** with what it is used for and a real line from the script — `family`, `file`, `weight`, `role`, `use`, `sample`; missing files are flagged), live motion demos + signature effects, 3–4 key frames rendered from code into `plan/frames/`, sound table, do/don't. Keep it visual and short — no technical tables (timings live in `plan/beats.json`, shots in `plan/storyboard.md`). Screenshot it yourself to check (`chromium --headless --screenshot=plan/design.png --window-size=1400,3000 plan/design.html`, or Playwright), then tell the user the full path to open it in their browser. Write the same values into `TASTE.md`. → **Approve plan.**
5. **Assets** – **VO intake:** receive the user's MP3 → `ffprobe` (duration, sample rate) + check clipping/loudness (`ffmpeg -af volumedetect`, `ebur128`) → transcribe with word timestamps (faster-whisper) → diff the transcript against the approved script and report missing/changed words or bad pronunciations (ask for a regenerated line if needed) → lock `beats.json` timings to the real audio. If the user explicitly wants to start early, use a temporary guide track and mark the timeline `TEMP` in PROGRESS.md. Then stock, Lottie, SFX, plus visual hunting on Pinterest/any site with the Playwright MCP (§16) for images, textures, footage and references; transcribe with word timestamps; cutout mattes if needed.
6. **Preview** – contact sheets for every scene via `<skill>/scripts/preview.mjs` (§2b) + a low-res/half-fps preview MP4 with audio. → **Approve preview.**
7. **Final render** – full res, sound mix, loudness, QA checklist (§15). Deliver + update LOG. If a vertical version is wanted, re-lay every scene natively for 9:16 (re-frame, re-place text in safe zones) — never just crop or letterbox the 16:9 render.

Rendering pipeline (default): deterministic `drawFrame(t)` in Canvas/Three.js → headless Chrome via Playwright, step time per frame (no real-time clock) → pipe PNG/JPEG frames into `ffmpeg -f image2pipe -r 30 -i - -c:v libx264 -pix_fmt yuv420p -crf 18` → mux audio. Seeded randomness only.

For a new project without an existing renderer, copy `<skill>/templates/render/` into `<project>/src/` (never overwrite approved scene code). Set `"type":"module"` in the project package.json, then use an existing compatible Playwright installation or request permission to install it and its matching Chromium. The starter itself needs no Three.js/GSAP dependency. Run a short `--jpg` smoke test before building scenes. Example: `node src/render.js --from 0 --to 3 --fps 4 --scale 0.25 --out cache/smoke-v1 --jpg`. Choose a fresh output directory for every run. Render MP4 with `--out renders/previews --name "Smoke v1"`; supply `--audio <mix.wav>` for sound. Both audio and visual range starts use `--from`. Project/toolkit resolution uses `MVD_TOOLKIT` or `.mvd/config.json`; optional `MVD_CHROMIUM` selects an explicitly configured browser. No tool or browser is installed automatically.

**Render CLI contract (required, build it on day one):** `src/render.js` must accept `--from <s> --to <s> --fps <n> --scale <0–1> --out <dir> [--jpg]` and render only that range at that size. Every frame depends only on `t` (no timers, no unseeded random, no state carried between frames), so a preview frame is identical to the final frame, just smaller.

## 2b. Fast preview loop (use after EVERY change)

Never check a change with a full render or a few random stills. Things that happen between stills (cards sliding behind text, cropped elements, bad framing) slip through.
1. After editing a scene, run `node <skill>/scripts/preview.mjs <from> <to> --name "Part 3" --version 1` (defaults: 8 fps, 0.25 scale, 6 columns). It renders only that range, small, and tiles all the frames into one contact sheet at `cache/preview/<name>-v<version>/<from>-<to>/run-<unique>/Contact sheet.jpg`, with a timestamp under every frame.
2. View the sheet (one image = the whole move). Check framing and safe area, overlaps, text legibility, easing gaps, pops/flicker and continuity across the cut.
3. Fix → re-run the same range → repeat until clean. Only then move to the next scene.
4. For timing or sound checks, add `--mp4 --audio <mix.wav>` (review filename uses `--name` and `--version`; sheets stay in cache). `--mp4` alone produces a silent clip; audio is not found automatically.
5. Before the final render, run sheets over the whole video (e.g. in 10 s chunks) and fix everything found. Log each loop in LOG.md and update PROGRESS.md.
Target: one loop in under ~20 s. If it's slower, lower `--fps`/`--scale` or shorten the range. Use React Three Fiber + Drei for new 3D scene components; GSAP timelines with `.seek(t)` for easing; p5.brush for hand-drawn/ink looks; SVG for crisp icons/UI.

## 2c. Three production pipelines (choose per video, or mix per scene — write the choice in TASTE.md §1)

| | **A · Code-drawn** | **B · Mixed (AI assets + code)** | **C · Footage edit** |
|---|---|---|---|
| Best for | kinetic type, explainers, UI/SaaS, logo stings, abstract/pixel/flat character animation | stylised worlds, realistic objects/characters/products you can't draw in code, cinematic B-roll | talking heads, vlogs, podcasts, tutorials, UGC ads, documentaries |
| Sources | everything drawn: Canvas/SVG/p5.brush for 2D, React Three Fiber + Drei for 3D, GSAP, Lottie | ChatGPT / Gemini images, Google Flow (Veo) clips, Pixabay/Unsplash stock + code-drawn type, FX, transitions | the user's footage (+ B-roll, stock, screen recordings) |
| Key steps | §5, §7, §12, deterministic `drawFrame(t)` | write prompts → user generates → cut out (rembg stills / RVM video, §6) → grade to one palette → composite as layers with parallax/3D cards → code-drawn text + FX on top → shared grain/grade so it looks like one piece | sync + transcribe → cut (jump cuts, remove silences/"um"s) → captions → B-roll/inserts → zooms/effects → sound + grade |
| Watch out | keep it rich (textures, grain, secondary motion) so it doesn't look "default" | consistency across generations (same style sheet, seed/reference image, palette), AI artefacts (hands, text), licence/terms of the generator | continuity, audio quality, safe zones over faces |

**Pipeline B prompt template (images):** `<subject>, <style: e.g. flat vector / clay 3D / photoreal>, <palette hexes>, <lighting>, plain <green/white> background, centered, full body, no text, <aspect>` — generate a style sheet first and reuse it as the reference image for every next asset. **Video (Google Flow / Veo):** one shot per prompt: subject + action + camera move + lens + lighting + mood + duration (≈ 8 s), start/end frame from your stills for continuity; ask for no on-screen text (add type in code).
**Pipeline C edit vocabulary:** hard cut, jump cut, J/L cut, match cut, punch-in zoom (105–120 %), smooth push, speed ramp, freeze frame, **picture-in-picture** (rounded card, 25–35 % width, soft shadow, slide/scale in, keep inside safe area, never over the face), **split-screen** (2–3 panels, reaction/comparison), screen-recording inset with cursor highlight, B-roll cover, captions (§12), text behind subject (matte), lower thirds, zoom-through / whip transitions, sound bridges. Effects list: §6.

---
