# Voix clonée (Chatterbox Multilingual, MIT, local CPU)

- Référence : 25 s de l'enregistrement fourni (`ref25.wav`, non versionné).
- Installation : `uv venv -p python3.11 /opt/voix && VIRTUAL_ENV=/opt/voix uv pip install chatterbox-tts "setuptools<81"`
- Usage : `/opt/voix/bin/python -I clone.py jobs.json` avec `[{"ref": "...wav", "text": "...", "out": "...wav"}]`
- Vitesse : ~1 min de calcul pour 8–10 s de voix.
- Vérif : retranscrire la sortie avec whisper-cli pour contrôler la prononciation (Kadio, Longueuil).

## Réglages validés (voix plus expressive)
- Génération : `exaggeration 0.6–0.68`, `cfg_weight 0.38–0.45`, `temperature 0.8–0.85`, plusieurs seeds (3, 7, 11) puis choisir la meilleure.
- **Orthographe phonétique** : écrire « **Kadyo** Coiffure » (Kadio/Cadio → « Cadieux »/« Cadillot »), « Faso Dé » pour Faso Déh.
- Numéros : séparer les chiffres par des virgules et des pauses « … ».
- Traitement (tonalité) : `highpass 70 Hz, +2 dB @180 Hz (chaleur), +3,5 dB @3,2 kHz (présence), +2 dB @9,5 kHz (air), compresseur 3:1, atempo 1.04, limiteur`.
- Toujours retranscrire chaque phrase avec whisper-cli avant le rendu.
