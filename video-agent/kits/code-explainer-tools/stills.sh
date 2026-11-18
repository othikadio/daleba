#!/bin/sh
# Usage: sh tools/stills.sh <v> <out.jpg> <t1> <t2> ...  (renders those seconds, tiles them in one row)
v=$1; out=$2; shift 2; rm -rf cache/st_$v; mkdir -p cache/st_$v; n=0
for t in "$@"; do n=$((n+1)); node src/render.js --v $v --fps 30 --scale .5 --from $t --to $(awk "BEGIN{print $t+0.034}") --out cache/st_$v/$n --jpg >/dev/null; cp cache/st_$v/$n/00000.jpg cache/st_$v/f$(printf %02d $n).jpg; done
ffmpeg -v error -y -i cache/st_$v/f%02d.jpg -vf "tile=${n}x1" $out
