> Detailed production guidance: load only for the current task. The SKILL.md entrypoint and current customer/project instructions take precedence. Section numbers below refer to this production manual; use the entrypoint guide table to locate a different topic. Do not assume any installed tool, private library, universal approval or specific narration provider.

## 13. Reference-video protocol (if the user attaches references, use them)

Always ask: *"Do you have a reference video or look? Attach it — I'll reverse-engineer it."* (How to download one: "How we make top-level videos together", step 2.) Run `python3 <skill>/scripts/analyze_ref.py ref.mp4 [--dur 15] [--frames 3] [--stems]` (Windows `py <skill>\scripts\analyze_ref.py …`) — analyse ≤ 15 s per pass; for longer references run several `--start` windows on the important parts:
1. **Picture:** `info.txt` (size, fps, duration); timestamped contact sheets (4 fps); **every frame of the first 3 s** (`frames/`, `strip_hook.jpg`) — the hook is where top designers hide the most technique, study it frame by frame (how each word enters, smear frames, overshoot, particles, transitions); `cuts.txt` (scene cuts); full-res stills of key frames.
2. **Sound:** original-mix spectrogram/waveform and onset candidates; short visual-event crops; optional available CoNeTTE captions/PANNs clip tags, CLAP candidate ranking (§0f); VO word timing. Demucs only optional diagnostics, never a guaranteed SFX isolation or gain-ratio measurement.
3. **Breakdown:** format & grade · type system (fonts, weights, hex colors, sizes, positions/safe area) · per-shot timeline (t, visual, motion, easing, transition) · recurring devices · SFX map (t → sound type → length → syncs to → level) · cut rhythm (avg shot length, BPM) · which pipeline (A/B/C, §2c) it was made with.
4. Turn it into a recipe (format of §14), confirm with the user, then build. After v1, compare your contact sheets + onset list side by side with the reference's and list the gaps — that drives v2.

## 14. Reverse-engineered reference recipes (build these without seeing the videos)

Four ready recipes built from analysed top-performing videos — A premium talking-head caption reel (9:16), B cinematic storyteller documentary (16:9), C SaaS launch Slack-style, D brand-agency kinetic promo — plus the shared taste behind them. Open `<skill>/reference/recipes.md` when the user's video matches one of them or has no reference, and use its format for your own recipes (§13).

## 15. QA checklist before delivery

- [ ] Plan (design.html) approved, preview approved (logged in PROGRESS.md → Approvals)
- [ ] Hook lands in ≤ 3 s; CTA visible ≥ 2 s
- [ ] VO is the user's final MP3; transcript diff vs the approved script is clean (or differences approved)
- [ ] Captions match VO, no typos, inside safe zones, contrast ≥ 4.5:1
- [ ] SFX synced (±1 frame), short and reference-matched (no stray whooshes/risers), audible under actual VO without masking it (no fixed peak-ratio guarantee), source audio muted when requested, no unwanted tails, VO intelligible over any permitted music, −14 LUFS / −1.5 dBTP
- [ ] Every caption word passes the readability pass (§12) on its real background
- [ ] Every feedback point from this round is fixed and written into `TASTE.md`; TASTE.md is complete enough for a new chat to continue in the same style (§11 checklist filled)
- [ ] No halos on cutouts, no flicker, no dropped frames; `ffprobe` duration/fps/resolution correct
- [ ] H.264 yuv420p, AAC 48 kHz, faststart (`-movflags +faststart`)
- [ ] Contact sheets checked over the full duration (§2b), no framing/overlap issues left
- [ ] manifest.json licenses complete (no `reference-only` asset in the final without user OK); LOG.md updated; final saved as new version
- [ ] Font licences saved next to the fonts in `assets/fonts/` and listed in the credits
- [ ] Final render log saved in `renders/logs/` and linked in LOG.md; TASTE.md, design.html, PROGRESS.md and manifest.json are up to date
- [ ] No API key values in any log, manifest, script or rendered credit
- [ ] Vertical/other aspect versions are native re-layouts (not crop/letterbox) and checked with contact sheets
- [ ] PROGRESS.md marked `Phase: DONE` with final file path, specs and credits
- [ ] Offer cleanup: move `cache/` (previews, logs, intermediates, stems) to the OS trash/Recycle Bin — never permanently delete; keep src, assets, renders

## 16. Visual asset hunting with the Playwright MCP (browse any site, grab assets yourself)

Whenever the plan needs an image, texture, footage, icon, mockup or style reference that the API MCPs don't cover: **find it yourself, don't ask the user to search.** Open `<skill>/reference/asset-hunting.md` for the loop (brief → search visually with the Playwright MCP → open candidates → download full-res → verify → contact sheet for approval → log licence in `manifest.json`) and the licence rules (Pinterest/Behance/Dribbble = `reference-only` unless the source licence allows use).


### Reference-helper output ownership
`analyze_ref.py` refreshes its numbered frame files, numbered sheets, hook strip and extracted audio/spectrogram on each run. Inputs must live outside that analysis directory. Silent references explicitly skip audio/spectrogram/stems. Check `analysis.json` for what this run produced; existing optional stems from older runs are not current results. Actual FFmpeg/probe failures are reported instead of a false Done. Sheets contain at most 30 frames. Pillow gives labels; the FFmpeg fallback explicitly warns that labels are unavailable. ImageMagick is not required by this Python helper.
