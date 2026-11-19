#!/bin/bash
# usage: produire.sh <video_id>  → exports/kadio-<video_id>.mp4
set -e
R="$(cd "$(dirname "$0")" && pwd)"; V="$1"; OUT="$R/../../exports"; TMP="$R/.tmp"; mkdir -p "$TMP" "$OUT"
[ "$SKIPVO" = 1 ] || python3 "$R/vo_post.py" "$V"
python3 "$R/build.py" "$V"
cd "$R/$V"
NODE_PATH=$(npm root -g) node "$R/cues.cjs" "$R/$V/index.html" "$R/$V/cues.json"
npx hyperframes render -q delivery -o "$TMP/$V.mp4" 2>&1 | grep -E "rendered in|rror" || true
read MUS START < <(python3 -c "import sys;sys.path.insert(0,'$R');from scenes import MUSIC;m=MUSIC['$V'];print(m[0],m[1])")
python3 -I "$R/mix.py" "$R/$V" "$R/$V/vo" "$R/shared/sfx" "$R/shared/music/$MUS.mp3" "$START" "$TMP/$V.wav"
ffmpeg -v error -y -i "$TMP/$V.mp4" -i "$TMP/$V.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -movflags +faststart -shortest "$OUT/kadio-$V.mp4"
rm -f "$TMP/$V.mp4" "$TMP/$V.wav"
echo "EXPORT $OUT/kadio-$V.mp4"
