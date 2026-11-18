# Kit « Poly-Animated Reels » (reçu par lots)

Reels de 45-80 s : deux personnages 3D low-poly qui discutent (un humain et un bot), voix Gemini TTS, sous-titres, panneaux.
Guide complet : `poly-animated-reels-guide.html`.

| Marque | Dossier | Format |
|---|---|---|
| Warm Explainer | `brands/warm-explainer/` | tutoriel chaleureux, 60-70 s |
| Dark Sitcom | `brands/dark-sitcom/` | une petite demande qui dégénère, 45-60 s |
| Night Talk | `brands/night-talk/` | confession calme de nuit, 45-55 s |

État : lot 1 reçu (règles, formules de script, outils look/align/tts). En attente : `engine/` (main.js, director.js, rig.js, ui.js, lowpoly.js), `brand/` (brand.js, voice.json, audio.json, looks.json), `tools/render.mjs`, `tools/mix.mjs`, `package.json`, exemples.
Besoins : Node, ffmpeg, Python (faster-whisper, google-genai), clé `GEMINI_API_KEY`, Chromium.


## Lot 2 (reçu)
- `SKILL.md` : la marche à suivre complète du kit.
- `brands/dark-sitcom/skill/tools/tts.py` : voix Gemini en flux (variante « generate_content_stream »).
- `extras/index-canvas-minimal.html` : page de rendu minimale (charge `main.js`).

## Toujours manquant pour faire tourner le kit
Le moteur 3D (`engine/main.js`, `director.js`, `rig.js`, `ui.js`, `lowpoly.js`), les réglages `brand/` (`brand.js`, `voice.json`, `audio.json`, `looks.json`), `tools/render.mjs`, `tools/mix.mjs`, `package.json`. Sans eux, les personnages ne peuvent pas être dessinés.
