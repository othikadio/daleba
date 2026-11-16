#!/bin/bash
# Produit les vidéos menu : durées des voix -> compositions -> rendu -> sons -> mix -> export.
# usage: produire.sh <dossier_voix> <dossier_sfx> <dossier_tmp> [videos...]
set -e
M="$(cd "$(dirname "$0")" && pwd)"; VO="$1"; SFX="$2"; TMP="$3"; shift 3
OUT="$M/../../exports"; mkdir -p "$TMP" "$OUT"
python3 - "$VO" "$TMP/durees.json" <<'EOF'
import sys, glob, os, soundfile as sf, json
d = {os.path.basename(f)[:-4]: round(sf.info(f).duration, 2) for f in glob.glob(sys.argv[1] + "/*.wav")}
json.dump(d, open(sys.argv[2], "w")); print(len(d), "voix")
EOF
python3 "$M/build.py" "$TMP/durees.json" "$@"
VIDS="$@"; [ -z "$VIDS" ] && VIDS=$(python3 -c "import json;print(' '.join(json.load(open('$M/videos.json'))))")
for v in $VIDS; do
  cd "$M/$v"
  NODE_PATH=$(npm root -g) node "$M/cues.cjs" "$M/$v/index.html" "$M/$v/cues.json"
  for id in $(python3 -c "import json;print(' '.join(sorted({c['id'] for c in json.load(open('cues.json'))})))"); do
    f="$SFX/$(echo $id | tr / _).wav"; [ -f "$f" ] || earshot sfx render "$id" -o "$f" --sr 48000 >/dev/null 2>&1
  done
  npx hyperframes render -q delivery -o "$TMP/$v.mp4" 2>&1 | grep -E "rendered in|rror" || true
  python3 -I "$M/mix.py" "$M/$v" "$VO" "$SFX" "$TMP/$v.wav"
  ffmpeg -v error -y -i "$TMP/$v.mp4" -i "$TMP/$v.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k \
    -af "loudnorm=I=-14:TP=-1:LRA=11" -shortest "$OUT/kadio-menu-$v.mp4"
  echo "EXPORT $OUT/kadio-menu-$v.mp4"
done
