"""Montage « mise en valeur du travail » pour Jolina Coiffure — ffmpeg pur.

usage: python3 -I montage.py <clips_dir> <music.mp3> <music_start_s> <bpm> <sfx_dir> <fonts_dir> <work_dir> <out.mp4>
clips_dir contient j1.mp4 (raie en vague), j2.mp4 (nattes dos), j3.mp4 (nattes face) — vidéos d'origine.
"""
import os, subprocess, sys, json

CL, MUSIC, MSTART, BPM, SFX, FONTS, WORK, OUT = sys.argv[1:9]
MSTART, BPM = float(MSTART), float(BPM)
BEAT = 60 / BPM
os.makedirs(WORK, exist_ok=True)
run = lambda a: subprocess.run(a, check=True, capture_output=True)

# Looks de couleur (un différent par plan)
G = {
    "or": "colorbalance=rs=.10:gs=.03:bs=-.10:rm=.07:bm=-.07:rh=.05:bh=-.04,eq=contrast=1.08:saturation=1.18:gamma=1.02",
    "cinema": "colorbalance=rs=-.12:bs=.14:rh=.14:gh=.03:bh=-.12,eq=contrast=1.14:saturation=1.22",
    "nb_rose": "hue=s=0,colorbalance=rm=.10:bm=.05:rh=.08:bh=.03,eq=contrast=1.25:brightness=.02",
    "vif": "eq=saturation=1.55:contrast=1.12:gamma=.98,colorbalance=rm=.05:bm=.04",
    "pastel": "eq=saturation=.82:brightness=.05:contrast=.94,colorbalance=rh=.07:gh=.02:bh=.07:rs=.04:bs=.06",
    "nb": "hue=s=0,eq=contrast=1.35:brightness=.01",
    "froid": "colorbalance=bs=.12:gs=.03:bm=.08:rh=-.03,eq=contrast=1.12:saturation=1.08",
    "vintage": "curves=preset=vintage,eq=saturation=1.1:contrast=1.06",
    "magenta": "colorbalance=rs=.10:bs=.12:gs=-.06:rm=.06:bm=.08:gm=-.05,eq=saturation=1.3:contrast=1.1",
}

# Plans : (clip, début source, beats, vitesse, look, zoom début, zoom fin, centre x, centre y, type)
SHOTS = [
    ("j3", 0.20, 4, 1.00, "or", 1.55, 1.25, .50, .38, "clip"),
    ("j3", 1.40, 4, 0.55, "cinema", 1.00, 1.12, .50, .45, "clip"),
    ("j3", 3.10, 2, 1.00, "nb_rose", 1.10, 1.18, .50, .42, "gel"),
    ("j2", 0.00, 4, 1.00, "vif", 1.05, 1.18, .50, .45, "clip"),
    ("j2", 1.90, 4, 0.55, "pastel", 1.45, 1.70, .50, .40, "clip"),
    ("j2", 3.30, 2, 1.00, "nb", 1.15, 1.22, .50, .42, "gel"),
    ("j1", 0.00, 4, 1.00, "vintage", 1.05, 1.20, .50, .35, "clip"),
    ("j1", 2.00, 4, 0.70, "froid", 1.60, 1.30, .55, .28, "clip"),
    ("j3", 2.20, 1, 1.00, "magenta", 1.30, 1.40, .50, .40, "clip"),
    ("j2", 1.00, 1, 1.00, "or", 1.30, 1.40, .50, .40, "clip"),
    ("j1", 1.20, 1, 1.00, "vif", 1.40, 1.50, .50, .32, "clip"),
    ("j3", 3.40, 1, 1.00, "cinema", 1.30, 1.40, .50, .40, "clip"),
    ("j3", 2.60, 8, 0.45, "or", 1.00, 1.15, .50, .42, "fin"),
]
SRC = {k: os.path.join(CL, f"{k}.mp4") for k in ("j1", "j2", "j3")}


def shot(i, s):
    clip, t0, beats, speed, look, z0, z1, cx, cy, kind = s
    D = beats * BEAT
    out = os.path.join(WORK, f"s{i:02d}.mp4")
    zoom = (f"scale=w='trunc(iw*({z0}+({z1}-{z0})*t/{D:.3f})/2)*2':h='trunc(ih*({z0}+({z1}-{z0})*t/{D:.3f})/2)*2':eval=frame:flags=bicubic,"
            f"crop=464:832:'(iw-464)*{cx}':'(ih-832)*{cy}'")
    post = f"scale=1080:1920:flags=lanczos,unsharp=5:5:0.7,{G[look]},fps=30,format=yuv420p"
    if kind == "gel":
        png = os.path.join(WORK, f"g{i:02d}.png")
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t0}", "-i", SRC[clip], "-frames:v", "1", "-vf", "scale=464:832", png])
        vf = f"{zoom},{post},fade=in:st=0:d=0.18:color=white"
        run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", f"{D:.3f}", "-i", png, "-vf", vf, "-an", "-c:v", "libx264", "-crf", "15", "-preset", "fast", out])
    else:
        src_len = D * speed
        pre = "scale=464:832,"
        if speed < 0.99:
            pre += f"minterpolate=fps={round(30 / speed)}:mi_mode=mci:mc_mode=aobmc:vsbmc=1,setpts=PTS/{speed},"  # ralenti fluide
        vf = f"{pre}fps=30,{zoom},{post}"
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t0}", "-t", f"{src_len + .1:.3f}", "-i", SRC[clip], "-vf", vf, "-t", f"{D:.3f}", "-an", "-c:v", "libx264", "-crf", "15", "-preset", "fast", out])
    return out, D, kind


parts, t, marks = [], 0.0, []
for i, s in enumerate(SHOTS):
    p, d, kind = shot(i, s)
    parts.append(p); marks.append((round(t, 3), kind, s[3])); t += d
TOTAL = t
lst = os.path.join(WORK, "list.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
raw = os.path.join(WORK, "raw.mp4")
run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", raw])

# Signature + fin (texte discret, police serif)
serif = os.path.join(FONTS, "Caladea-Bold.ttf"); sans = os.path.join(FONTS, "InterDisplay-Bold.otf")
fin = marks[-1][0]
a_in = lambda st, d=.6: f"if(lt(t,{st}),0,min(1,(t-{st})/{d}))"
dt = lambda txt, font, size, x, y, alpha, color="white", extra="": (
    f"drawtext=fontfile='{font}':text='{txt}':fontsize={size}:fontcolor={color}:x={x}:y={y}:alpha='{alpha}'{extra}")
sig_a = f"if(lt(t,0.6),t/0.6,if(gt(t,{fin - .3:.2f}),max(0,1-(t-{fin - .3:.2f})/0.3),0.9))"
vf = ",".join([
    # signature permanente en bas à gauche
    dt("Jolina", serif, 64, "70", "1620", sig_a, extra=":shadowcolor=black@0.5:shadowx=2:shadowy=3"),
    dt("C O I F F U R E", sans, 22, "74", "1700", sig_a, "0xFFC76B"),
    f"drawbox=x=70:y=1600:w=120:h=3:color=0xFFC76B@0.9:t=fill:enable='lt(t,{fin - .3:.2f})'",
    # fin
    f"drawbox=x=0:y=0:w=iw:h=ih:color=0x1a0612@0.35:t=fill:enable='gte(t,{fin + .8:.2f})'",
    dt("Jolina", serif, 190, "(w-text_w)/2", "640", a_in(fin + 1.0, .7), extra=":shadowcolor=black@0.6:shadowx=3:shadowy=5"),
    dt("C O I F F U R E", sans, 44, "(w-text_w)/2", "860", a_in(fin + 1.4), "0xFFC76B"),
    f"drawbox=x=440:y=950:w=200:h=4:color=0xFFC76B:t=fill:enable='gte(t,{fin + 1.5:.2f})'",
    dt("Tresses · Nattes · Coiffure", sans, 46, "(w-text_w)/2", "1010", a_in(fin + 1.8)),
    dt("Avenue Papineau · Montréal", sans, 40, "(w-text_w)/2", "1090", a_in(fin + 2.1)),
    dt("263 550-1630", sans, 70, "(w-text_w)/2", "1200", a_in(fin + 2.4), "0xFFC76B", ":box=1:boxcolor=0x1a0612@0.55:boxborderw=26"),
])
vid = os.path.join(WORK, "video.mp4")
run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-vf", vf, "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", vid])

# Son : musique calée + vrais bruitages (déclencheur photo sur les gels, souffle sur les ralentis)
sfx = []
for i, (tm, kind, speed) in enumerate(marks):
    if kind == "gel": sfx.append((tm - .02, "shutter.wav", 0.9))
    elif kind == "fin": sfx.append((tm - .25, "swoosh-wind.wav", 0.5)); sfx.append((tm + 1.0 * BEAT * 2 + .45, "shutter-vintage.wav", 0.55))
    elif speed < 0.99: sfx.append((tm - .18, "whoosh-fast.wav", 0.45))
    elif i == 8: sfx.append((tm - .1, "sweep-small.wav", 0.5))
inputs = ["-ss", f"{MSTART}", "-t", f"{TOTAL + .2:.3f}", "-i", MUSIC]
filt = [f"[0:a]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=0.04,afade=t=out:st={TOTAL - 1.6:.2f}:d=1.6,volume=0.9[m]"]
mixes = ["[m]"]
for k, (tm, f, vol) in enumerate(sfx):
    inputs += ["-i", os.path.join(SFX, f)]
    filt.append(f"[{k + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={vol},adelay={int(max(0, tm) * 1000)}|{int(max(0, tm) * 1000)}[s{k}]")
    mixes.append(f"[s{k}]")
filt.append(f"{''.join(mixes)}amix=inputs={len(mixes)}:normalize=0,loudnorm=I=-14:TP=-1:LRA=11[a]")
aud = os.path.join(WORK, "audio.wav")
run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[a]", "-ar", "48000", aud])
run(["ffmpeg", "-v", "error", "-y", "-i", vid, "-i", aud, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", OUT])
print(json.dumps({"duree": round(TOTAL, 2), "plans": len(SHOTS), "sfx": len(sfx), "sortie": OUT}))
