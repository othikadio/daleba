#!/usr/bin/env python3
"""Read-only optional audio inventory; never downloads or tests inference."""
import argparse,importlib.util,importlib.metadata,json,sys
from mvd_paths import models_dir,sfx_library,executable
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--models-dir',default=str(models_dir()));a=p.parse_args()
from pathlib import Path
r=Path(a.models_dir).expanduser();out={'python':sys.executable,'models_dir':str(r),'bundled_or_custom_sfx':str(sfx_library()),'packages':{},'weights':{},'ffmpeg':executable('ffmpeg'),'network_used':False,'inference_tested':False}
for module,dist in [('numpy','numpy'),('scipy','scipy'),('librosa','librosa'),('soundfile','soundfile'),('torch','torch'),('transformers','transformers'),('panns_inference','panns-inference'),('conette','conette')]:
 try:found=importlib.util.find_spec(module) is not None
 except (ImportError,ValueError):found=False
 try:version=importlib.metadata.version(dist)
 except importlib.metadata.PackageNotFoundError:version=None
 out['packages'][module]={'import_spec_found':found,'version':version}
for name,rel in [('panns','panns/Cnn14_mAP=0.431.pth'),('clap','clap/pytorch_model.bin'),('clap_safetensors','clap/model.safetensors'),('conette','conette/pytorch_model.bin')]:
 q=r/rel;out['weights'][name]={'exists':q.is_file(),'bytes':q.stat().st_size if q.is_file() else None}
print(json.dumps(out,indent=2))
