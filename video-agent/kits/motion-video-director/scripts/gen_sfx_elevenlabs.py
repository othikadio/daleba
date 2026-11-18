#!/usr/bin/env python3
"""ElevenLabs SFX: offline plan by default; one paid request only after approval.
API key is read only from ELEVENLABS_API_KEY. No SDK/model download required.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
from datetime import datetime, timezone
import urllib.request
import urllib.error
ENDPOINT='https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128'
MODEL='eleven_text_to_sound_v2'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def run(a):
    if not math.isfinite(a.duration) or not 0.5 <= a.duration <= 30:
        raise ValueError('Duration must be 0.5–30 seconds. Generate then trim shorter UI contacts locally.')
    if not math.isfinite(a.prompt_influence) or not 0 <= a.prompt_influence <= 1:
        raise ValueError('Prompt influence must be between 0 and 1.')
    plan={'provider':'ElevenLabs','model_id':MODEL,'duration_seconds':a.duration,
          'output_format':'mp3_44100_128','request_count':1,'paid_request_sent':False,
          'mode':'offline plan','key_configured':bool(os.environ.get('ELEVENLABS_API_KEY')),
          'notice':'Paid/credit-consuming generation needs approval. Only the approved text prompt is sent; no reference audio is uploaded.'}
    if not a.generate: return plan
    if not a.allow_paid_request:
        raise ValueError('Generation refused: obtain user approval for the prompt, duration, one request and credit use, then pass --allow-paid-request.')
    if not a.prompt or not a.prompt.strip() or not a.output:
        raise ValueError('--generate requires --prompt and --output.')
    key=os.environ.get('ELEVENLABS_API_KEY')
    if not key: raise ValueError('ELEVENLABS_API_KEY is not configured. Enter it through a secure local mechanism; never put it in chat or CLI arguments.')
    out=a.output.expanduser().resolve();sidecar=out.with_suffix(out.suffix+'.json')
    if out.suffix.lower()!='.mp3': raise ValueError('This helper returns MP3; use an .mp3 output path.')
    if out.exists() or sidecar.exists(): raise ValueError('Refusing to overwrite an existing output or provenance file.')
    # Reserve output destinations before a chargeable request; fail early on write errors.
    out.parent.mkdir(parents=True,exist_ok=True)
    audio_owned=False;meta_owned=False
    try:
        with out.open('xb'): pass
        audio_owned=True
        with sidecar.open('x',encoding='utf-8'): pass
        meta_owned=True
        payload={'text':a.prompt.strip(),'duration_seconds':a.duration,'prompt_influence':a.prompt_influence,'model_id':MODEL,'loop':False}
        req=urllib.request.Request(ENDPOINT,data=json.dumps(payload).encode(),headers={'xi-api-key':key,'Content-Type':'application/json','Accept':'audio/mpeg'},method='POST')
        opener=urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(req,timeout=180) as response:
                body=response.read(25*1024*1024+1)
                request_id=response.headers.get('request-id')
                billed=response.headers.get('character-cost')
        except urllib.error.HTTPError as e:
            raise ValueError('ElevenLabs returned HTTP '+str(e.code)+'. Check access/credits/request settings. No automatic retry; a failed response may still need billing review.') from None
        except (urllib.error.URLError,TimeoutError,OSError):
            raise ValueError('Network request failed or timed out. Billing state may be unknown; inspect the account before retrying. No automatic retry.') from None
        valid=body.startswith(b'ID3') or (len(body)>1 and body[0]==255 and body[1]&224==224)
        if not valid or len(body)>25*1024*1024:
            raise ValueError('Response was empty, oversized or not recognizable MP3. No automatic retry; inspect account billing.')
        out.write_bytes(body)
        provenance={'provider':'ElevenLabs','model_id':MODEL,'prompt':a.prompt.strip(),
                    'requested_duration_seconds':a.duration,'prompt_influence':a.prompt_influence,
                    'output_format':'mp3_44100_128','source_quality':'lossy MP3; WAV conversion does not restore missing detail',
                    'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body),
                    'request_id':request_id,'reported_character_cost':billed,
                    'created_utc':datetime.now(timezone.utc).isoformat(),
                    'review_status':'unreviewed candidate; trim, fade, audition and mix locally',
                    'rights':'Check current ElevenLabs account/plan terms; plugin licence does not grant provider rights.'}
        sidecar.write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf-8')
    except Exception:
        # Remove only files reserved by this invocation, never another user's files.
        # If valid audio was received, retain it even if sidecar writing failed: don't pay twice.
        if audio_owned and out.exists() and out.stat().st_size==0: out.unlink()
        if meta_owned and sidecar.exists() and sidecar.stat().st_size==0: sidecar.unlink()
        raise
    plan.update(mode='candidate generated; audition required',paid_request_sent=True,bytes=len(body),sha256=provenance['sha256'])
    return plan

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--generate',action='store_true');p.add_argument('--allow-paid-request',action='store_true')
    p.add_argument('--prompt');p.add_argument('--duration',type=float,default=1.0)
    p.add_argument('--prompt-influence',type=float,default=0.3);p.add_argument('--output',type=Path)
    a=p.parse_args();print(json.dumps(run(a),indent=2))
if __name__=='__main__':
    try: main()
    except ValueError as e: print('ERROR: '+str(e),file=sys.stderr);sys.exit(1)
    except Exception as e: print('ERROR: '+type(e).__name__+'; inspect local file access without exposing secrets. No automatic retry.',file=sys.stderr);sys.exit(1)
