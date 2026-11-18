#!/usr/bin/env python3
"""Tag sounds with local models (PANNs = what is it, CLAP = how close to a text description), find onsets,
and pick the nearest sounds from your library to a reference. CPU is fine. Models: scripts/setup_audio_models.py.
  python3 scripts/audio_tag.py a.wav b.mp3 ...            PANNs top-5 AudioSet tags per file
  python3 scripts/audio_tag.py folder/ --clap             + CLAP scores vs the PROMPTS below (or --prompts p.json)
  python3 scripts/audio_tag.py reference-window.wav --onsets  coarse onset candidates on original audio; refine waveform anchors
  python3 scripts/audio_tag.py --match ref_clips/ --library assets/sfx/ [--top 3]
        -> for every reference clip, the most similar library sounds (PANNs embedding cosine similarity)
Writes JSON next to the console output with --json out.json. Short clips are looped to 3 s (PANNs needs context)."""
import os, sys, glob, json, argparse
os.environ["HF_HUB_OFFLINE"]="1"
os.environ["TRANSFORMERS_OFFLINE"]="1"
from mvd_paths import models_dir
from safe_audio import verify_panns, restricted_torch
import numpy as np
a = argparse.ArgumentParser(); a.add_argument('files', nargs='*'); a.add_argument('--models-dir', default=str(models_dir()))
a.add_argument('--panns', action='store_true', help='Optional clip tags (CLAP-only skips PANNs)'); a.add_argument('--clap', action='store_true'); a.add_argument('--prompts'); a.add_argument('--onsets', action='store_true')
a.add_argument('--match'); a.add_argument('--library'); a.add_argument('--top', type=int, default=3); a.add_argument('--json')
o = a.parse_args(); M = os.path.abspath(o.models_dir)
EXT = ('.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aiff')
PROMPTS = {  # edit / extend per project
    'soft_tick': 'a short soft tick, dry, close', 'pop': 'a short pop sound', 'thump': 'a short soft low thump',
    'click': 'a small ui click', 'whoosh': 'a whoosh swoosh', 'riser': 'a rising riser build-up', 'impact': 'a big cinematic impact boom',
    'glitch': 'digital glitch noise', 'typing': 'keyboard typing', 'paper': 'paper rustle', 'cloth': 'cloth rustle',
    'footstep': 'a footstep', 'chirp': 'a small creature chirp', 'swipe': 'a fast swipe', 'ding': 'a bright notification ding'}
def expand(paths):
    out = []
    for p in paths:
        out += sorted(f for f in glob.glob(os.path.join(p, '**', '*'), recursive=True) if f.lower().endswith(EXT)) if os.path.isdir(p) else [p]
    return out
def load(path, sr):
    import librosa
    y, _ = librosa.load(path, sr=sr, mono=True)
    if len(y) == 0: y = np.zeros(sr, 'float32')
    if len(y) < 3 * sr: y = np.tile(y, int(np.ceil(3 * sr / len(y))))[:3 * sr]  # loop short clips to 3 s
    return y.astype('float32')
_panns = None
def panns():
    global _panns
    if _panns is None:
        if not os.path.isfile(os.path.join(os.path.expanduser("~"), "panns_data", "class_labels_indices.csv")):
            raise FileNotFoundError("Local PANNs labels absent; provision from verified local model labels, no auto-download")
        ck = os.path.join(M, 'panns', 'Cnn14_mAP=0.431.pth')
        verify_panns(ck)
        restricted_torch()
        from panns_inference import AudioTagging
        ck = os.path.join(M, 'panns', 'Cnn14_mAP=0.431.pth')
        if not os.path.isfile(ck): raise FileNotFoundError('Local PANNs checkpoint missing; no automatic download: '+ck)
        labels_file = os.path.join(os.path.expanduser('~'), 'panns_data', 'class_labels_indices.csv')
        if not os.path.isfile(labels_file): raise FileNotFoundError('Local PANNs labels required before importing package: '+labels_file)
        _panns = AudioTagging(checkpoint_path=ck, device='cpu')
    return _panns
def tag(path):
    if not os.path.isfile(os.path.join(os.path.expanduser("~"), "panns_data", "class_labels_indices.csv")):
        raise FileNotFoundError("Local PANNs labels absent; no auto-download")
    verify_panns(os.path.join(M, 'panns', 'Cnn14_mAP=0.431.pth'))
    restricted_torch()
    from panns_inference import labels
    clip, emb = panns().inference(load(path, 32000)[None, :])
    idx = np.argsort(clip[0])[::-1][:5]
    return [(labels[i], round(float(clip[0][i]), 3)) for i in idx], emb[0]
def clap_scores(paths, prompts):
    from transformers import ClapModel, ClapProcessor
    torch = restricted_torch()
    src = os.path.join(M, 'clap')
    if not os.path.isfile(os.path.join(src, 'config.json')): raise FileNotFoundError('Local CLAP config missing; no automatic download: '+src)
    model, proc = ClapModel.from_pretrained(src, local_files_only=True, trust_remote_code=False).eval(), ClapProcessor.from_pretrained(src, local_files_only=True, trust_remote_code=False)
    names, texts = list(prompts), list(prompts.values()); res = {}
    with torch.no_grad():
        te = model.get_text_features(**proc(text=texts, return_tensors='pt', padding=True)); te = te / te.norm(dim=-1, keepdim=True)
        for p in paths:
            ae = model.get_audio_features(**proc(audios=[load(p, 48000)], sampling_rate=48000, return_tensors='pt'))
            ae = ae / ae.norm(dim=-1, keepdim=True); s = (ae @ te.T)[0].numpy()
            res[p] = sorted(zip(names, [round(float(x), 3) for x in s]), key=lambda t: -t[1])[:5]
    return res
def onsets(path):
    import librosa
    y, sr = librosa.load(path, sr=22050, mono=True)
    on = librosa.onset.onset_detect(y=y, sr=sr, units='time', backtrack=True)
    rms = librosa.feature.rms(y=y)[0]; t = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
    return [(round(float(x), 3), round(float(20 * np.log10(rms[min(np.searchsorted(t, x) + 2, len(rms) - 1)] + 1e-9)), 1)) for x in on]
result = {}
if o.match and not o.library: a.error('--match requires an explicit approved --library path')
if o.match:
    refs, lib = expand([o.match]), expand([o.library or 'assets/sfx'])
    E = {p: tag(p)[1] for p in lib}; L = list(E); LM = np.stack([E[p] / (np.linalg.norm(E[p]) + 1e-9) for p in L])
    for r in refs:
        t, e = tag(r); s = LM @ (e / (np.linalg.norm(e) + 1e-9)); best = np.argsort(s)[::-1][:o.top]
        result[r] = {'tags': t, 'nearest': [(L[i], round(float(s[i]), 3)) for i in best]}
        print('\n' + os.path.basename(r), '|', ', '.join('%s %.2f' % x for x in t[:3]))
        for i in best: print('   %.3f  %s' % (s[i], L[i]))
else:
    files = expand(o.files) or sys.exit(__doc__)
    for f in files:
        r = result.setdefault(f, {})
        if o.onsets:
            r['onsets'] = onsets(f); print('\n%s  %d onsets' % (os.path.basename(f), len(r['onsets'])))
            print('  ' + '  '.join('%.2fs(%.0fdB)' % x for x in r['onsets'][:80]))
        if o.panns or not (o.onsets or o.clap):
            r['tags'] = tag(f)[0]; print('%-40s %s' % (os.path.basename(f)[:40], ' | '.join('%s %.2f' % x for x in r['tags'])))
    if o.clap:
        pr = json.load(open(o.prompts, encoding='utf-8')) if o.prompts else PROMPTS
        for f, s in clap_scores(files, pr).items():
            result[f]['clap'] = s; print('%-40s CLAP: %s' % (os.path.basename(f)[:40], ', '.join('%s %.2f' % x for x in s)))
if o.json: json.dump(result, open(o.json, 'w', encoding='utf-8'), indent=1, default=str); print('->', o.json)
