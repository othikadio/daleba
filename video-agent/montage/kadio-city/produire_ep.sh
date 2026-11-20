#!/bin/bash
set -e
R="$(cd "$(dirname "$0")" && pwd)"; K="$1"; S=/tmp/claude-0/-home-user-daleba/5cb6c19f-73be-5ced-b2f4-13ab7e9423d2/scratchpad/kc
python3 "$R/episodes.py" "$K"; cd "$R/ep/$K"; echo '{"id":"'$K'","name":"'$K'"}' > meta.json
NODE_PATH=$(npm root -g) node "$R/../serie10/cues.cjs" "$R/ep/$K/index.html" "$R/ep/$K/cues.json"
npx hyperframes render -q delivery -o "$S/$K.mp4" 2>&1 | grep -E "rendered in" || true
read MUS START < <(python3 -c "import json;m=json.load(open('music.json'))['music'];print(m[0],m[1])")
python3 -I "$R/../serie10/mix.py" "$R/ep/$K" "$R/ep/$K" "$R/sfx" "$R/music/$MUS.mp3" "$START" "$S/$K.wav"
ffmpeg -v error -y -i "$S/$K.mp4" -i "$S/$K.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 -af "loudnorm=I=-14:TP=-1.5:LRA=11" -movflags +faststart -shortest "$R/../../exports/kadio-city-$K.mp4"
rm -f "$S/$K.mp4" "$S/$K.wav"; echo "EXPORT kadio-city-$K.mp4"
