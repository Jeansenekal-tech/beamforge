#!/usr/bin/env python3
"""Build a BeamForge update: updates/BeamForge-<ver>.bfupdate + updates/latest.json
(commit and push the updates folder — installed copies pick it up automatically from GitHub)

Usage: make-update.py "What changed in this version"
The version comes from app/package.json — bump it before building.
"""
import base64, hashlib, json, os, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.environ.get('BF_APP') or os.path.join(ROOT, 'app')
OUT = os.environ.get('BF_OUT') or os.path.join(ROOT, 'updates')
SKIP_FILES = {'main.js', 'icon.icns', '.DS_Store'}   # main.js is the fixed launcher inside the app bundle
MIN_ELECTRON = 33

notes = sys.argv[1] if len(sys.argv) > 1 else ''
version = json.load(open(os.path.join(APP, 'package.json')))['version']
files = {}
for dp, dn, fn in os.walk(APP):
    dn[:] = [d for d in dn if not d.startswith('.') and d != 'node_modules']
    for f in fn:
        if f in SKIP_FILES: continue
        full = os.path.join(dp, f); rel = os.path.relpath(full, APP).replace(os.sep, '/')
        files[rel] = base64.b64encode(open(full, 'rb').read()).decode()
for need in ['core.js', 'updater.js', 'preload.js', 'index.html', 'package.json']:
    assert need in files, 'missing ' + need
pkg = {'app': 'BeamForge', 'version': version, 'notes': notes, 'minElectron': MIN_ELECTRON,
       'built': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'files': files}
data = json.dumps(pkg, separators=(',', ':')).encode()
os.makedirs(OUT, exist_ok=True)
name = f'BeamForge-{version}.bfupdate'
open(os.path.join(OUT, name), 'wb').write(data)
manifest = {'version': version, 'notes': notes, 'package': name, 'sha256': hashlib.sha256(data).hexdigest(),
            'size': len(data), 'minElectron': MIN_ELECTRON, 'released': pkg['built']}
for old in os.listdir(OUT):  # only the newest package is needed
    if old.endswith('.bfupdate') and old != name: os.remove(os.path.join(OUT, old))
json.dump(manifest, open(os.path.join(OUT, 'latest.json'), 'w'), indent=1)
print(f'{name}  {len(data)//1024} KB  ({len(files)} files)')
