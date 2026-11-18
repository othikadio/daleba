"""Shared helpers for the motion-video-director scripts (Windows, macOS, Linux; Python >= 3.9, stdlib only)."""
import os, shutil, subprocess, sys
from mvd_paths import executable
for _s in (sys.stdout, sys.stderr):  # Windows consoles (cp1252) can't print ✅/❌ -> force UTF-8
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
KEYS = ['PIXABAY_API_KEY', 'FREESOUND_CLIENT_ID', 'FREESOUND_API_KEY', 'UNSPLASH_APPLICATION_ID', 'UNSPLASH_ACCESS_KEY',
        'UNSPLASH_SECRET_KEY', 'FIRECRAWL_API_KEY', 'ELEVENLABS_API_KEY']
def load_env(path='.env'):
    """read NAME=value lines into a dict (values are never printed)"""
    env = {}
    if os.path.exists(path):
        for ln in open(path, encoding='utf-8-sig'):
            ln = ln.strip()
            if ln and not ln.startswith('#') and '=' in ln:
                k, v = ln.split('=', 1); env[k.strip()] = v.strip().strip('"').strip("'")
    return env
def which(*names):
    for n in names:
        p = shutil.which(n)
        if p: return p
    return None
def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)
def ffmpeg(): return executable('ffmpeg') or sys.exit('ffmpeg not found on PATH (install: winget install Gyan.FFmpeg / brew install ffmpeg / sudo apt install ffmpeg)')
def ffprobe(): return executable('ffprobe') or sys.exit('ffprobe not found on PATH (comes with ffmpeg)')
