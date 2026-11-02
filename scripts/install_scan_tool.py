#!/usr/bin/env python3
"""Install one checksum-pinned official scanner into an ignored local directory."""
from pathlib import Path
import hashlib, io, os, tarfile, urllib.request
VERSION='8.30.1'
SHA256='551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
root=Path(__file__).resolve().parents[1]
target=root/'.tools/gitleaks'
if not target.exists():
    url=f'https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/gitleaks_{VERSION}_linux_x64.tar.gz'
    with urllib.request.urlopen(url,timeout=60) as response:data=response.read()
    if hashlib.sha256(data).hexdigest()!=SHA256:raise ValueError('Official scanner checksum mismatch')
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        member=archive.extractfile('gitleaks')
        if member is None:raise ValueError('Scanner binary missing')
        target.parent.mkdir(exist_ok=True);target.write_bytes(member.read());os.chmod(target,0o755)
print('Checksum-pinned gitleaks ready')
