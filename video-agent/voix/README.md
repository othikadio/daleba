# Voix clonée (Chatterbox Multilingual, MIT, local CPU)

- Référence : 25 s de l'enregistrement fourni (`ref25.wav`, non versionné).
- Installation : `uv venv -p python3.11 /opt/voix && VIRTUAL_ENV=/opt/voix uv pip install chatterbox-tts "setuptools<81"`
- Usage : `/opt/voix/bin/python -I clone.py jobs.json` avec `[{"ref": "...wav", "text": "...", "out": "...wav"}]`
- Vitesse : ~1 min de calcul pour 8–10 s de voix.
- Vérif : retranscrire la sortie avec whisper-cli pour contrôler la prononciation (Kadio, Longueuil).
