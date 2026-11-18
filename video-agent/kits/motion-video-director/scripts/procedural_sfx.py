#!/usr/bin/env python3
"""Seeded local starting recipes, not realistic-Foley guarantees. Writes 48 kHz PCM16 WAV."""
import argparse,pathlib
p=argparse.ArgumentParser(description=__doc__);p.add_argument('recipe',choices=['tick','pop','swish','drop']);p.add_argument('output');p.add_argument('--duration',type=float,default=.12);p.add_argument('--seed',type=int,default=4);p.add_argument('--peak-db',type=float,default=-12);a=p.parse_args()
if not .02<=a.duration<=2:p.error('duration must be 0.02–2 seconds')
if not -60<=a.peak_db<=-1:p.error('peak-db must be -60 to -1')
path=pathlib.Path(a.output)
if path.exists():p.error('Refusing to overwrite existing output')
import numpy as np
from scipy.signal import butter,sosfilt
from scipy.io.wavfile import write
sr=48000;t=np.arange(round(sr*a.duration))/sr;rng=np.random.default_rng(a.seed);n=rng.standard_normal(len(t))
def noise(lo,hi):return sosfilt(butter(2,[lo,hi],fs=sr,btype='bandpass',output='sos'),n)
fade=np.minimum(t/.002,1)*np.minimum((a.duration-t)/min(.025,a.duration/4),1)
if a.recipe=='tick':y=noise(650,6500)*np.exp(-t/max(.004,a.duration/7))
elif a.recipe=='pop':
 f=140+680*np.exp(-t/.016);phase=2*np.pi*np.cumsum(f)/sr;y=np.sin(phase)*np.exp(-t/max(.012,a.duration/4))+.08*noise(500,4500)*np.exp(-t/.009)
elif a.recipe=='swish':y=noise(250,6500)*np.sin(np.pi*t/a.duration)**2
else:y=.7*np.sin(2*np.pi*145*t)*np.exp(-t/.025)+.24*noise(700,5200)*np.exp(-t/.007)
y*=fade;y*=10**(a.peak_db/20)/max(np.max(np.abs(y)),1e-12);assert np.all(np.isfinite(y)) and np.max(np.abs(y))<1
path.parent.mkdir(parents=True,exist_ok=True);write(path,sr,np.rint(y*32767).astype(np.int16));print(f'Wrote {path}: {len(y)} samples, {sr} Hz PCM16; recipe={a.recipe}; seed={a.seed}; peak={a.peak_db} dBFS. Audition in the actual scene before use.')
