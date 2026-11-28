#!/bin/bash
# usage: finaliser.sh <film> <couverture.jpg> -> exports/kadio-<film>-publication.mp4 (couverture 0,4 s en ouverture, compressé)
set -e; R="$(cd "$(dirname "$0")" && pwd)"; E="$R/../../exports"; K="$1"; C="$2"
ffmpeg -v error -y -loop 1 -t 0.4 -i "$C" -f lavfi -t 0.4 -i anullsrc=r=48000:cl=stereo -i "$E/kadio-premium-$K.mp4" -filter_complex "[0:v]scale=1080:1920,fps=30,format=yuv420p,setsar=1[c];[2:v]fps=30,format=yuv420p,setsar=1[v];[1:a]aformat=sample_rates=48000:channel_layouts=stereo[sa];[2:a]aformat=sample_rates=48000:channel_layouts=stereo[a];[c][sa][v][a]concat=n=2:v=1:a=1[ov][oa]" -map "[ov]" -map "[oa]" -c:v libx264 -crf 21 -preset medium -c:a aac -b:a 192k -movflags +faststart "$E/kadio-$K-publication.mp4"
rm -f "$E/kadio-premium-$K.mp4"; echo "PUB $E/kadio-$K-publication.mp4"
