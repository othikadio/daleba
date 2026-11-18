#!/usr/bin/env python3
"""Offline verification of a portable catalog; no installs, downloads or file restoration."""
import argparse,json,hashlib,pathlib
from mvd_paths import sfx_library
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--library',default=str(sfx_library()));a=p.parse_args();root=pathlib.Path(a.library).expanduser().resolve();catalog=root/'catalog.json'
if not catalog.is_file():
 print(json.dumps({'status':'not_configured','verified_sounds':0,'network_used':False,'note':'No customer catalog present; no sample pack is bundled. Use your own licensed files or procedural recipes.'}));raise SystemExit(0)
rows=json.loads(catalog.read_text(encoding='utf-8-sig'));ids=[]
for r in rows:
 ids.append(r['id']);assert r.get('license') and r.get('source_url'),'Every catalog entry requires licence and source; verifier does not grant rights'
 for key,hkey in [('path','review_sha256'),('original_path','original_sha256')]:
  f=(root/r[key]).resolve();assert f.is_relative_to(root) and f.is_file(),r[key]
  assert hashlib.sha256(f.read_bytes()).hexdigest()==r[hkey],r[key]+' hash mismatch'
assert len(set(ids))==len(ids)
print(json.dumps({'verified_sounds':len(ids),'verified_audio_files':2*len(ids),'network_used':False,'subjective_audition':'not performed by this verifier'}))
