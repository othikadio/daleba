#!/usr/bin/env python3
"""Normalize dotenv key names as data; preserve existing nonempty values by default."""
import argparse, os, pathlib, re, tempfile
MAP = [
 (r'pixabay', 'PIXABAY_API_KEY'),
 (r'freesound.*(client.?id|\bid\b)', 'FREESOUND_CLIENT_ID'),
 (r'freesound', 'FREESOUND_API_KEY'),
 (r'unsplash.*(app|application).*id', 'UNSPLASH_APPLICATION_ID'),
 (r'unsplash.*secret', 'UNSPLASH_SECRET_KEY'),
 (r'unsplash', 'UNSPLASH_ACCESS_KEY'),
 (r'firecrawl', 'FIRECRAWL_API_KEY'),
 (r'eleven\W*labs|^xi.?api', 'ELEVENLABS_API_KEY'),
]
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('source',type=pathlib.Path); p.add_argument('dest',nargs='?',default='.env',type=pathlib.Path)
 p.add_argument('--replace-existing',action='store_true',help='Only use after explicit permission to replace existing credentials')
 a=p.parse_args(); src,dst=a.source,a.dest
 if not src.is_file(): p.error('Source file not found')
 lines=dst.read_text(encoding='utf-8-sig').splitlines() if dst.exists() else []
 indices={}
 for i,line in enumerate(lines):
  m=re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$',line)
  if m: indices[m[1]]=(i,m[2])
 changed=kept=0
 for line in src.read_text(encoding='utf-8-sig').splitlines():
  if not line.strip() or line.lstrip().startswith('#'): continue
  m=re.match(r'\s*([^=:]+?)\s*[=:]\s*(.+)$',line)
  if not m: continue
  name=re.sub(r'^export\s+','',m[1],flags=re.I)
  key=next((s for rx,s in MAP if re.search(rx,name.lower())),re.sub(r'\W+','_',name).strip('_').upper())
  if not re.fullmatch(r'[A-Z_][A-Z0-9_]*',key): continue
  value=m[2].strip()
  if key in indices:
   i,old=indices[key]
   if old.strip().strip("\"'") and not a.replace_existing: kept+=1; continue
   lines[i]=f'{key}={value}'
  else:
   i=len(lines); lines.append(f'{key}={value}')
  indices[key]=(i,value); changed+=1
 dst.parent.mkdir(parents=True,exist_ok=True)
 gi=dst.parent/'.gitignore'
 ignores=gi.read_text(encoding='utf-8-sig').splitlines() if gi.exists() else []
 for pattern in ('.env','*.env','/'+dst.name):
  if pattern not in ignores: ignores.append(pattern)
 gi.write_text('\n'.join(ignores)+'\n',encoding='utf-8')
 fd,tmp=tempfile.mkstemp(prefix='.mvd-secret-',dir=dst.parent)
 try:
  with os.fdopen(fd,'w',encoding='utf-8',newline='\n') as f: f.write('\n'.join(lines)+'\n')
  if os.name!='nt': os.chmod(tmp,0o600)
  os.replace(tmp,dst)
 finally:
  if os.path.exists(tmp): os.unlink(tmp)
 print(f'Updated {changed} entries; preserved {kept} existing entries. Values not displayed.')
if __name__=='__main__':
 try: main()
 except (OSError,UnicodeError): raise SystemExit('Unable to read or write dotenv files; values not displayed.')
