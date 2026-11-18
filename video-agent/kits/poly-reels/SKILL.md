---
name: poly-animated-reels
description: Make 9:16 low-poly 3D talking-character reels drawn in code with Gemini voices, from just a topic or script. Includes three ready brands - warm-explainer (a how-to with a hooded human and an orange orb bot), dark-sitcom (a kid and a block creature with gags on a giant screen) and night-talk (a quiet deadpan two-hander at night). Characters, voices, 15+ locations, lighting, UI panels, captions and sound are ready. Use when someone asks for a poly-animated reel, a low-poly character short, an AI skit, or any of those brand names.
---

# Poly-Animated Reels

Pick a brand, write the script, and the rest is automatic. Beginners should open `guide/poly-animated-reels-guide.html` first.

## Choose a brand
| Brand | Best for | Folder |
|---|---|---|
| warm-explainer | Teaching one real method, saved and shared | `brands/warm-explainer/` |
| dark-sitcom | Pure comedy and loops, one request escalates | `brands/dark-sitcom/` |
| night-talk | Quiet, emotional, relatable two-handers | `brands/night-talk/` |

If the user does not say, ask which goal they want: teach, make people laugh, or make people feel seen.

## First-time setup (once)
1. Install Node 18+, Python 3.10+ and ffmpeg.
2. `pip install faster-whisper google-genai numpy`
3. Get a free API key at aistudio.google.com and set `GEMINI_API_KEY`. Never paste it into a file or chat.
4. In the brand folder: `npm i`, then `npx playwright install chromium`.
5. Put the bot's name in `brand/voice.json` under `bot.scriptName`.

## Make a video: run the whole flow yourself
The user gives any one input below. You do every step, and stop only at the two approvals.

**1. Understand the input**
- **A topic:** write an original script.
- **A finished script:** keep their words and add emotion tags, panels and poses.
- **A reference video, audio file or pasted transcript:** run `python reference.py <file> <video folder>/reference`, then read `transcript.txt` and view `sheet.jpg`. If they gave a transcript, use it directly. If they gave only a link, ask them to download the file or paste the transcript.
- **An explainer topic ("how does X work"):** use warm-explainer unless they choose another brand.

**2. Choose the brand** from the table, based on the goal or the reference's structure.

**3. Write the script**
Read the brand's `BRAND.md` and `SCRIPT-FORMULA.md` first.
- **From a reference:** map its beats: hook, turn, escalation, payoff, ending, line count, pace and panel moments. Then write a new script on the user's topic with the same structure. Never copy its jokes, wording, examples or numbers. Use a different premise unless the user owns the original.
- **For explainers:** research the topic if you can and verify facts. Turn each key fact into a question, objection or joke between the two characters, with one panel per fact. Open on a surprising claim. Never present a guess or invented statistic as fact.
- Every line gets a `<tag>`. Show the script and proposed panels. **Approval 1: wait for the user.**

**4. Build it** from the brand folder. If `node_modules` is missing, run `npm i` and `npx playwright install chromium`.
1. Create `videos/<slug>/episode.json`.
2. `python tools/look.py videos/<slug>`, unless the user chose a set.
3. `python tools/tts.py videos/<slug>`
4. `python tools/align.py videos/<slug>`. Fix any warning.
5. `node tools/render.mjs --ep videos/<slug> --stills auto --scale .35`, then view `preview/sheet.jpg` yourself and fix faces covered by captions, cut-off panels or bad framing.
6. Tell the user the voice is ready and show the preview. **Approval 2: wait for the user.**
7. `node tools/mix.mjs videos/<slug>`
8. `node tools/render.mjs --ep videos/<slug> --audio videos/<slug>/mix_en.wav --name "<Title> v1"`
9. Check that the video has audio, runs the full length and ends cleanly. Report its path, then give a caption and hashtags for posting.

If the user says "don't stop" or "do everything", skip both approvals. For a Hindi version, follow the Hindi step in `BRAND.md`.

## Rights
Use original character names. Do not name, copy or imply endorsement by a real company or person unless you have the right to. Reference videos are for study only.
