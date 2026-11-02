#!/usr/bin/env python3
"""Build a public-only Pages artifact without changing any calculation module."""
import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLOCKED = {'.py', '.pyc', '.env', '.log', '.key', '.pem', '.db', '.bak', '.lock', '.tmp'}


def build(output=ROOT/'_site'):
    output = Path(output).resolve()
    if output == ROOT or not output.is_relative_to(ROOT):
        raise ValueError('Pages output must be a separate directory inside the repository')
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for name in ['index.html', 'ranking.html', 'privacy.html', 'robots.txt']:
        shutil.copy2(ROOT/name, output/name)
    for route in ['ranking', 'privacy']:
        (output/route).mkdir()
        shutil.copy2(ROOT/(route+'.html'), output/route/'index.html')
    (output/'admin').mkdir()
    shutil.copy2(ROOT/'admin/index.html', output/'admin/index.html')
    for source in (ROOT/'assets').rglob('*'):
        if source.is_symlink():
            raise ValueError('Symlinks are not allowed in the Pages artifact')
        if not source.is_file():
            continue
        if source.suffix in BLOCKED or any(part.startswith('.') for part in source.relative_to(ROOT).parts):
            continue
        target = output/source.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    (output/'.nojekyll').touch()
    return output


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'_site')
    print(build(parser.parse_args().output))
