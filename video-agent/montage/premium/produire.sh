#!/bin/bash
# usage: produire.sh maison|signature|bienvenue → exports/kadio-premium-<film>.mp4
set -e
R="$(cd "$(dirname "$0")" && pwd)"; K="$1"; TMP="$R/.tmp"; OUT="$R/../../exports"; mkdir -p "$TMP"
python3 "$R/build.py" "$K"
cd "$R/$K"; echo '{"id":"'$K'","name":"premium-'$K'"}' > meta.json
NODE_PATH=$(npm root -g) node "$R/../serie10/cues.cjs" "$R/$K/index.html" "$R/$K/cues.json"
npx hyperframes render -q delivery -o "$TMP/$K.mp4" 2>&1 | grep -E "rendered in|rror" || true
read MUS START < <(python3 -c "import json;m=json.load(open('music.json'))['music'];print(m[0],m[1])")
python3 -I "$R/../serie10/mix.py" "$R/$K" "$R/$K" "$R/$K/sfx" "$R/music/$MUS.mp3" "$START" "$TMP/$K.wav"
ffmpeg -v error -y -i "$TMP/$K.mp4" -i "$TMP/$K.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 -af "loudnorm=I=-14:TP=-1.5:LRA=11" -movflags +faststart -shortest "$OUT/kadio-premium-$K.mp4"
rm -f "$TMP/$K.mp4" "$TMP/$K.wav"; echo "EXPORT $OUT/kadio-premium-$K.mp4"
