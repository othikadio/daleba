#!/usr/bin/env python3
"""Read-only portable inventory: no installs, downloads, secret values or browser launch."""
import sys, json, platform, importlib.util, shutil, subprocess, os
from pathlib import Path
from mvd_paths import config, models_dir, sfx_library, resolve, executable
try: config()
except (ValueError, OSError) as e: raise SystemExit('Invalid local configuration: '+str(e))
def probe(path, args):
    if not path: return {'available': False, 'reason': 'not found'}
    try:
        p=subprocess.run([path]+args, capture_output=True, text=True, timeout=15)
        text=(p.stdout or p.stderr).strip()
        return {'available': p.returncode==0 and bool(text), 'exit_code':p.returncode, 'version':text.splitlines()[0] if text else ''}
    except (OSError, subprocess.TimeoutExpired) as e: return {'available':False, 'reason':type(e).__name__}
binaries={n:executable(n) if n in ['ffmpeg','ffprobe'] else shutil.which(n) for n in ['ffmpeg','ffprobe','node','npm','git']}
checks={n:probe(p, ['-version'] if n in ['ffmpeg','ffprobe'] else ['--version']) for n,p in binaries.items()}
checks['python']={'available':True,'version':sys.version.split()[0],'supported':sys.version_info>=(3,10),'minimum':'3.10'}
node=checks['node']; node['minimum']='18'
try: node['supported']=node['available'] and int(node['version'].lstrip('v').split('.')[0])>=18
except (ValueError,KeyError): node['supported']=False
im=shutil.which('magick') or shutil.which('montage')
checks['imagemagick']=dict(probe(im,['-version']),optional=True,path=im)
toolkit=resolve('toolkit_dir','MVD_TOOLKIT')
# Resolve Playwright from the selected project/toolkit, never via npx/network.
js="""const {createRequire}=require('node:module'),fs=require('node:fs'),path=require('node:path');
try {const req=createRequire(path.join(process.argv[1],'package.json'));const pw=req('playwright');
const browser=process.env.MVD_CHROMIUM || pw.chromium.executablePath();
console.log(JSON.stringify({package_available:true,browser_path:browser,browser_file_exists:fs.existsSync(browser),launch_tested:false}));}
catch(e){console.log(JSON.stringify({package_available:false,browser_file_exists:false,launch_tested:false,reason:e.code||e.name}));}"""
browser={'package_available':False,'browser_file_exists':False,'launch_tested':False,'reason':'Node unavailable or unsupported'}
if node['supported']:
    try:
        p=subprocess.run([binaries['node'],'-e',js,str(toolkit or Path.cwd())],capture_output=True,text=True,timeout=15)
        browser=json.loads(p.stdout) if p.returncode==0 else dict(browser,reason='Node probe failed')
    except (OSError,ValueError,subprocess.TimeoutExpired): browser['reason']='Browser probe failed'
r={'platform':platform.system(),'python':sys.version.split()[0],'current_python':sys.executable,'models_dir':str(models_dir()),'sfx_library':str(sfx_library()),'sfx_catalog_exists':(sfx_library()/'catalog.json').is_file(),'configured_audio_python':str(resolve('audio_python','MVD_AUDIO_PYTHON') or ''),'configured_toolkit':str(toolkit or ''),'binaries':binaries,'checks':checks,'playwright_chromium':browser,'packages_in_current_python':{}}
for n in ['numpy','scipy','librosa','soundfile','torch','transformers','panns_inference','conette','PIL']:
    try:r['packages_in_current_python'][n]=importlib.util.find_spec(n) is not None
    except (ImportError,ValueError):r['packages_in_current_python'][n]=False
r.update(network_used=False,installed_anything=False,note='Inventory only, not an all-ready gate. Browser file presence does not prove launch/GPU readiness; run the starter smoke test. ImageMagick is optional (Pillow/FFmpeg alternatives). Model files are optional; no inference readiness is implied. Keep this machine report local.')
print(json.dumps(r,indent=2))
