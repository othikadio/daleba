"""Integrity and restricted-loading guards; never deserialize a model here."""
import hashlib,pathlib,os,re
PANN_BYTES=327428481
PANN_SHA256='0dc499e40e9761ef5ea061ffc77697697f277f6a960894903df3ada000e34b31'
def verify_panns(path):
 p=pathlib.Path(path)
 if not p.is_file() or p.stat().st_size!=PANN_BYTES:raise RuntimeError('Expected official local PANNs checkpoint missing or wrong byte length; no automatic download')
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 if h.hexdigest()!=PANN_SHA256:raise RuntimeError('PANNs SHA256 mismatch; refusing to load')
def restricted_torch():
 os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD']='1'
 os.environ.pop('TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD',None)
 import torch
 v=re.match(r'^(\d+)\.(\d+)',torch.__version__)
 if not v or tuple(map(int,v.groups()))<(2,6):raise RuntimeError('Current supported PyTorch >=2.6 required for restricted loading. No unsafe fallback.')
 return torch
