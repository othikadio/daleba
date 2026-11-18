#!/usr/bin/env python3
"""Official-source PANNs acquisition + integrity verification only. No model loading or package installation.
No arguments prints an offline plan. Other optional models require documented manual setup.
"""
import argparse,hashlib,json,pathlib,os,urllib.request
from mvd_paths import models_dir
URL='https://zenodo.org/records/3987831/files/Cnn14_mAP%3D0.431.pth?download=1'
SIZE=327428481
MD5='541141fa2ee191a88f24a3219fff024e'
SHA256='0dc499e40e9761ef5ea061ffc77697697f277f6a960894903df3ada000e34b31'
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--models-dir',default=str(models_dir()));p.add_argument('--download',choices=['panns']);p.add_argument('--allow-downloads',action='store_true');p.add_argument('--accept-legacy-pth',action='store_true');p.add_argument('--verify',type=pathlib.Path);a=p.parse_args()
def verify(f):
 if f.stat().st_size!=SIZE:raise ValueError('Checkpoint byte length mismatch')
 sha=hashlib.sha256();md5=hashlib.md5()
 with f.open('rb') as h:
  for b in iter(lambda:h.read(1024*1024),b''):sha.update(b);md5.update(b)
 if sha.hexdigest()!=SHA256 or md5.hexdigest()!=MD5:raise ValueError('Checkpoint integrity mismatch; do not load')
 return {'bytes':SIZE,'sha256':sha.hexdigest(),'md5':md5.hexdigest(),'source':URL,'model_loaded':False}
if a.verify:
 try:print(json.dumps(verify(a.verify),indent=2))
 except (OSError,ValueError) as e:raise SystemExit(str(e))
elif a.download:
 if not (a.allow_downloads and a.accept_legacy_pth):p.error('Explicit --allow-downloads and --accept-legacy-pth required after reviewing the plan/security notes')
 root=pathlib.Path(a.models_dir).expanduser().resolve()/'panns';root.mkdir(parents=True,exist_ok=True);dst=root/'Cnn14_mAP=0.431.pth'
 if dst.exists():print(json.dumps(verify(dst),indent=2))
 else:
  tmp=dst.with_suffix('.download-part')
  try:
   req=urllib.request.Request(URL,headers={'User-Agent':'MotionVideoDirector/3.4.0'})
   with urllib.request.urlopen(req,timeout=120) as r,tmp.open('xb') as f:
    if not r.geturl().startswith('https://zenodo.org/'):raise ValueError('Unexpected download host; refusing mirror')
    total=0
    while True:
     b=r.read(1024*1024)
     if not b:break
     total+=len(b)
     if total>SIZE:raise ValueError('Download exceeds expected size')
     f.write(b)
   evidence=verify(tmp);os.replace(tmp,dst);(root/'provenance.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8');print(json.dumps(evidence,indent=2))
  except Exception:
   if tmp.exists():tmp.unlink()
   raise
else:print(json.dumps({'action':'plan only; no network or writes','model':'PANNs Cnn14 (optional)','source':URL,'bytes':SIZE,'md5_published_by_zenodo':MD5,'sha256_pinned':SHA256,'licence':'CC-BY-4.0; credit Kong et al., DOI 10.5281/zenodo.3987831','warning':'Legacy pickle checkpoint: integrity is not a safety guarantee. Never load arbitrary .pth files. Use current supported PyTorch >=2.6 with restricted weights_only loading; never unsafe fallback.','download_flags':'--download panns --allow-downloads --accept-legacy-pth','clap':'optional manual setup from publisher laion/clap-htsat-unfused at a reviewed immutable revision; no automatic mirror fallback','conette':'experimental manual setup; no tested inference adapter, not needed for baseline workflow'},indent=2))
