#!/usr/bin/env python3
"""Analyze a reference locally. Owned outputs are refreshed on each run; no downloads.
Usage: python analyze_ref.py ref.mp4 --dur 15 --start 0 --fps 4 --frames 3 --out cache/ref_name
Pillow gives timestamp labels; without it FFmpeg makes an explicitly unlabelled sheet.
"""
import sys, json, argparse, subprocess, re
from pathlib import Path
from fractions import Fraction
from _common import ffmpeg, ffprobe
p=argparse.ArgumentParser();p.add_argument('ref');p.add_argument('--dur',type=float,default=15);p.add_argument('--start',type=float,default=0);p.add_argument('--fps',type=float,default=4);p.add_argument('--frames',type=float,default=3);p.add_argument('--stems',action='store_true');p.add_argument('--out');o=p.parse_args()
import math
if not all(math.isfinite(x) for x in [o.dur,o.start,o.fps,o.frames]) or o.dur<=0 or o.fps<=0 or o.start<0 or o.frames<0:p.error('Use positive duration/fps and non-negative start/hook duration')
ref=Path(o.ref).resolve()
if not ref.is_file():p.error('Reference file not found')
name=''.join(c if c.isalnum() else '_' for c in ref.stem)[:40]
out=Path(o.out or 'cache/ref_'+name).resolve()
if ref.is_relative_to(out):p.error('Reference input must be outside the analysis output directory')
FF,FP=ffmpeg(),ffprobe()
def run(args):
    r=subprocess.run(args,capture_output=True,text=True,encoding='utf8',errors='replace')
    if r.returncode:raise RuntimeError('Command failed ('+str(r.returncode)+'): '+r.stderr[-1800:])
    return r
info=json.loads(run([FP,'-v','error','-show_streams','-show_format','-of','json',str(ref)]).stdout)
v=next((s for s in info['streams'] if s.get('codec_type')=='video'),None)
if v is None:p.error('Reference has no video stream')
has_audio=any(s.get('codec_type')=='audio' for s in info['streams'])
# Only generated files with known names are removed, not arbitrary output-directory contents.
for d in [out,out/'f',out/'frames']:
    if d.is_symlink():p.error('Analysis output cannot be a symlink')
    d.mkdir(parents=True,exist_ok=True)
for d in [out/'f',out/'frames']:
    for f in d.glob('*.jpg'):
        if f.stem.isdigit():f.unlink()
for f in out.glob('sheet_*.jpg'):
    if re.fullmatch(r'sheet_\d+\.jpg',f.name):f.unlink()
for name in ['strip_hook.jpg','spectrogram.png','audio.wav','audio44.wav']:
    (out/name).unlink(missing_ok=True)
(out/'info.txt').write_text(json.dumps(info,indent=2),encoding='utf8')
ss=['-ss',str(o.start)] if o.start else []
base=[FF,'-v','error','-y']+ss
run(base+['-t',str(o.dur),'-i',str(ref),'-map','0:v:0','-an','-vf',f'fps={o.fps},scale=320:-2',str(out/'f/%04d.jpg')])
if o.frames:run(base+['-t',str(min(o.frames,o.dur)),'-i',str(ref),'-map','0:v:0','-an','-vf','scale=480:-2',str(out/'frames/%04d.jpg')])
def sheet(files,path,labels,cols=6):
    if not files:return
    rows=(len(files)+cols-1)//cols
    try:
        from PIL import Image,ImageDraw
    except ImportError:
        print('NOTE: Pillow unavailable; contact sheet has no timestamp labels.')
        # Input files are consecutively numbered; use their actual starting index.
        run([FF,'-v','error','-y','-start_number',str(int(files[0].stem)),'-i',str(files[0].parent/'%04d.jpg'),'-vf',f'tile={cols}x{rows}:nb_frames={len(files)}:padding=4:color=0x202020','-frames:v','1',str(path)])
        return
    with Image.open(files[0]) as im:w,h=im.size
    canvas=Image.new('RGB',(cols*(w+4)+4,rows*(h+22)+4),(32,32,32));draw=ImageDraw.Draw(canvas)
    for i,(f,label) in enumerate(zip(files,labels)):
        x,y=4+(i%cols)*(w+4),4+(i//cols)*(h+22)
        with Image.open(f) as im:canvas.paste(im.convert('RGB'),(x,y))
        draw.text((x+3,y+h+2),label,fill='white')
    canvas.save(path,quality=88)
fs=sorted((out/'f').glob('*.jpg'))
for i in range(0,len(fs),30):sheet(fs[i:i+30],out/f'sheet_{i//30:02d}.jpg',[f'{o.start+j/o.fps:.3f}s' for j in range(i,min(i+30,len(fs)))])
fr=sorted((out/'frames').glob('*.jpg'))
try:fps_src=float(Fraction(v.get('r_frame_rate','30/1')))
except (ValueError,ZeroDivisionError):fps_src=30.0
if fps_src<=0:fps_src=30.0
# Hook frames remain consecutive, so the FFmpeg fallback and labelled path agree.
if fr:sheet(fr,out/'strip_hook.jpg',[f'{o.start+j/fps_src:.3f}s' for j in range(len(fr))])
r=run([FF,'-hide_banner']+ss+['-t',str(o.dur),'-i',str(ref),'-an','-vf',"select='gt(scene,0.3)',showinfo",'-f','null','-'])
cuts=[o.start+float(x) for x in re.findall(r'pts_time:([0-9.eE+-]+)',r.stderr)]
(out/'cuts.txt').write_text(''.join(f'{x:.6f}\n' for x in cuts),encoding='utf8')
if has_audio:
    run(base+['-t',str(o.dur),'-i',str(ref),'-lavfi','showspectrumpic=s=1500x400:legend=1:scale=log:fscale=log','-frames:v','1',str(out/'spectrogram.png')])
    for name,channels,rate in [('audio.wav',1,16000),('audio44.wav',2,44100)]:run(base+['-t',str(o.dur),'-i',str(ref),'-map','0:a:0','-vn','-ac',str(channels),'-ar',str(rate),str(out/name)])
    if o.stems:run([sys.executable,'-m','demucs','-n','htdemucs','-o',str(out/'stems'),str(out/'audio44.wav')])
else:print('No audio stream: spectrogram, audio extraction and requested stems skipped. Existing stems, if any, are not part of this run.')
(out/'analysis.json').write_text(json.dumps({'source':ref.name,'start':o.start,'duration_requested':o.dur,'sample_fps':o.fps,'frames':len(fs),'sheets':(len(fs)+29)//30,'has_audio':has_audio,'stems_generated_this_run':bool(has_audio and o.stems)},indent=2),encoding='utf8')
print(f'Done -> {out} | {(len(fs)+29)//30} sheet(s), {len(fr)} hook frames, {len(cuts)} cuts')
