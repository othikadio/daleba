#!/usr/bin/env python3
"""Create/update <project>/.env with empty key slots for the user to fill in. Never overwrites existing values,
never prints values.  Works on Windows, macOS and Linux.
Usage:  python3 scripts/create_env.py [project_dir]      (Windows: py scripts\\create_env.py [project_dir])"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import KEYS, load_env
proj = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.'); os.makedirs(proj, exist_ok=True)
envp = os.path.join(proj, '.env'); cur = open(envp, encoding='utf-8-sig').read() if os.path.exists(envp) else ''
head = ('# API keys for motion-video-director. Paste each key right after "=" (no spaces, no quotes), then SAVE.\n'
        '# Leave a line empty if you do not use that platform. Never share this file.\n')
lines = cur.splitlines()
if 'motion-video-director' not in cur: lines = head.rstrip('\n').split('\n') + lines
have = {l.split('=', 1)[0].strip() for l in lines if '=' in l and not l.lstrip().startswith('#')}
lines += ['%s=' % k for k in KEYS if k not in have]
open(envp, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines).rstrip('\n') + '\n')
gi = os.path.join(proj, '.gitignore'); g = open(gi, encoding='utf-8').read().splitlines() if os.path.exists(gi) else []
for p in ('.env', '*.env', 'node_modules/', 'cache/', 'models/'):
    if p not in g: g.append(p)
open(gi, 'w', encoding='utf-8', newline='\n').write('\n'.join(g) + '\n')
print('Created/updated:', envp)
env = load_env(envp)
for k in env: print(('✅ %s filled' if env[k] else '⬜ %s empty') % k)
