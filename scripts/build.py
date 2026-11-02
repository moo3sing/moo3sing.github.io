#!/usr/bin/env python3
"""Build a static publish directory; no framework/server runtime migration."""
import shutil
from pathlib import Path
from check import check

ROOT=Path(__file__).resolve().parents[1]
check()
target=ROOT/'dist'
target.mkdir(exist_ok=True)
for name in ['index.html','ranking.html','privacy.html','robots.txt']:
    shutil.copy2(ROOT/name,target/name)
shutil.copytree(ROOT/'assets',target/'assets',dirs_exist_ok=True,ignore=shutil.ignore_patterns('*.lock','*.tmp'))
print('Production static build: '+str(target))
