
# Brand 1: warm cinematic how-to

Everything is finished and reusable. **Each new video only needs a script.** Do not redesign the characters, voices, camera, captions or UI. Vary only the background (automatic), emotions, poses and panel content. Never show a channel name or handle.

Folder: `brands/warm-explainer/`. Videos go in `brands/warm-explainer/videos/<slug>/`.
Script writing: read `SCRIPT-FORMULA.md` before writing a single line.

## The look
Warm, cosy, cinematic. Soft lamp light, film grain, faceted low-poly. Gold captions for the bot, white for the human (Lora serif).
- **Cast:** `human` (teal hoodie, pompadour, beard) and `bot` (orange faceted orb, black visor, equaliser mouth, orbit ring, antenna).
- **Sets (all seated):** `cafe` (window bar on stools, brick, hanging bulbs), `train` (night seats, city lights passing), `office` (late desk, monitor glow), `library` (dome, arched window, reading desk), `apartment` (couch, rainy window), `diner` (booth, checkerboard, pendant lamp, neon). Panels turn dark in the diner and office.
- **Lights:** `evening`, `golden`, `bluehour`, `lamplit`.
- **Panels:** float over the top of the frame and shrink to their content, with the wide shot below. Use `"step": [2, 5], "heading": "Find"` to add the step progress bar.
- **Poses for `human`:** type (default here), sit, sitpoint, sitshrug, sitpalm.

## Make a video
1. **Script.** If the user gave a topic, write it with `SCRIPT-FORMULA.md`. If they gave a script, keep their words. Show the script for approval before voice work.
2. **Ask for assets.** Ask whether they have logos or screenshots. Anything missing is drawn in a panel.
3. **Create the folder** with `episode.json` (format below). Run commands from `skill/`, and run `npm i` first if `node_modules` is missing.
4. **Pick a new background and voice it:**
   - `python tools/look.py ../videos/<slug>` chooses a set and lighting this brand has not used and writes them into the episode. Every set runs before any repeats. Use the user's choice instead if they name one.
   - `python tools/tts.py ../videos/<slug>` voices the whole script as one conversation with `gemini-3.8-flash-lite-tts`, using the locked voices in `brand/voice.json`. **Never change those voices:** the audience should recognise them. Use the voices exactly as set in that file. It reads `GEMINI_API_KEY` from the environment.
   - If the user supplies their own voice, save it as `voice_en.wav` and skip tts.py.
5. **Match voice to script:** `python tools/align.py ../videos/<slug>` writes `timing_en.json`. Fix the script or voice if it warns that under half matched. Captions always use the script's spelling.
6. **Preview:** `node tools/render.mjs --ep ../videos/<slug> --stills auto --scale .35`, then open `preview/sheet.jpg`. Check that captions do not cover faces, panels read clearly, nothing is cut off and the last frames look right.
7. **Mix:** `node tools/mix.mjs ../videos/<slug>` makes `mix_en.wav` at -14 LUFS with quiet ambience and sparse SFX.
8. **Render:** `node tools/render.mjs --ep ../videos/<slug> --audio ../videos/<slug>/mix_en.wav --name "<Title> en v1"`. Output goes to `renders/`. Never overwrite a version; use v2.
9. **Hindi:** add a Hinglish `hi` field with the same tags to every line, then repeat tts, align, mix and render with `--lang hi`. The voices stay the same.
10. **Listen check:** before calling it done, confirm align printed no "tags spoken aloud" warning. If a line sounds flat or wrong, change its tags and run tts.py again.

## episode.json
```json
{
  "title": "Internal name",
  "set": "chosen by look.py",
  "light": "chosen by look.py",
  "cast": ["human", "bot"],
  "lines": [
    { "who": "human", "text": "<angry> Spoken words exactly.", "hi": "<angry> Hinglish line", "pose": "sitshrug" },
    { "who": "bot", "text": "<deadpan> Short reply.", "shot": "two",
      "ui": { "type": "browser", "url": "site.com", "title": "Title", "items": [{ "text": "Row", "sub": "Detail", "tag": "Label" }], "keep": 1 } }
  ],
  "end": { "title": "A question?", "keyword": "WORD", "after": "and I'll send it", "dur": 3 }
}
```
- **who** is `human` or `bot`.
- **text** holds the spoken words plus `<emotion>` tags (see `SCRIPT-FORMULA.md`). The first feeling tag also sets the face. Add `mood` (neutral, happy, smug, angry, sad, shock, tired) only to override it.
- **shot** is optional. The auto-director opens wide, cuts to each speaker, goes wide every fourth beat, and cuts to the listener halfway through long lines. Override only for a specific joke.
- **ui** opens a panel on that line. `keep: n` holds it for n more lines. A later `ui`, or `"ui": false`, closes it.
- **Panel types:** `browser`, `chat` (msgs from `me` or `ai`, optional `alert`), `code` (badge, files), `calendar` (rows, cols, fill), `notify` (from, sub, body, rows, total, foot), `big` (kicker, title, sub), `form` (title, sub, fields, button), `error` (time, title, lines), `checklist` (items), `grid` (word, step, cells with `c`, `label`, `on`). Items reveal over the panel's time on screen.
- **end** is optional. Change it for every video so the card fits the topic.
- See `examples/demo/episode.json` for a working episode.

## Rules that always apply
- The bot keeps one fixed name in every script: the name in `brand/voice.json` under `bot.scriptName`.
- The signature light is built into the engine for every set: hard warm side light, bright face fill, glow on edges, string lights and rising dots. Tune it with `hero` in `brand/brand.js`, and never remove it.
- Nothing is ever fully still: the camera, characters and set are always drifting. Do not add freeze frames.
- Sound only real visual events. Never put sounds on caption words, and never run trains of pops, ticks or typing. `tools/mix.mjs` keeps small hits 1.5 s apart.
- No channel name or handle in any video, in any language. Hindi versions use Hinglish captions.
- Same two voices in every video of this brand, and a new background every video.
- Loudness is -14 LUFS.
- Never put a real company's logo, real person or real private data in a panel unless the user supplies and approves it. Use invented names by default.
- Reference videos are for study only. Do not reuse their audio, lines or footage.

## Files
- `brand/brand.js`: this brand's cast, sets, cameras, captions, panel theme. Change it only when the user asks for a new look or set.
- `brand/audio.json`: ambience. `brand/voice.json`: the locked male and female voices. `brand/looks.json`: the sets and lights the picker rotates through.
- `engine/`: renderer, `director.js` (shots, captions, cues), `rig.js` (all characters), `ui.js` (all panels), `lowpoly.js`.
- `tools/`: `look.py`, `tts.py`, `align.py`, `render.mjs`, `mix.mjs`, `placeholder_voice.ps1` (scratch voice for timing tests only).
- **Needs:** Node, ffmpeg, Python with faster-whisper and google-genai, a `GEMINI_API_KEY`, Playwright's Chromium, and a GPU for speed.
