# Outils « code-explainer » (reçus avec le kit)

Petits outils de production, réutilisables dans tous nos montages :
- `transcribe.py` : mots horodatés avec faster-whisper (ici on utilise surtout whisper.cpp, déjà installé).
- `build_timing.py` : JSON de mots → blocs de sous-titres + durée.
- `align_script.py` : pose un texte propre sur les temps de Whisper.
- `cut_spans.py` : coupe des passages d'un WAV avec fondus de 20 ms.
- `mix.py` : mixe voix + bruitages, aligne le pic de chaque son sur son repère, normalise à −14 LUFS (adapter `LIB`/`MAP` à notre banque de sons).
- `stills.sh`, `crop_assets.py`, `hinglish.py`, `save_to_skill.py` : outils propres au projet d'origine (chemins Windows / src/render.js absents), gardés en référence.
