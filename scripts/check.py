#!/usr/bin/env python3
"""Dependency-free static checks for the existing HTML/Python project."""
import ast
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Document(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=set(); self.assets=[]

    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, 'Duplicate ID: ' + attrs['id']
            self.ids.add(attrs['id'])
        for key in ['src','href']:
            value=attrs.get(key,'')
            if value.startswith('/assets/'):
                self.assets.append(value.split('?')[0])


def check():
    for html,js in [('index.html','simulation-ui.js'),('ranking.html','ranking-ui.js')]:
        parser=Document(); parser.feed((ROOT/html).read_text())
        for asset in parser.assets:
            assert (ROOT/asset.lstrip('/')).is_file(), 'Missing asset: '+asset
        script=(ROOT/'assets'/js).read_text()
        for element in re.findall(r"el\('([^']+)'\)",script):
            assert element in parser.ids, 'Missing UI element: '+element
    for folder in ['services','scripts','tests']:
        for path in (ROOT/folder).glob('*.py'): ast.parse(path.read_text(), filename=str(path))
    exclusions=json.loads((ROOT/'data/excluded-streamers.json').read_text())
    assert len({e['soopId'].casefold() for e in exclusions}) == len(exclusions)
    assert all(e['reason'] in ['official','foreign','non-personal'] and e['evidence'] for e in exclusions)
    snapshot=json.loads((ROOT/'assets/data/ranking.json').read_text())
    assert snapshot['status'] in ['ok','stale','unavailable']
    assert snapshot['status']!='ok' or len(snapshot['streamers'])==100
    print('HTML references, unique IDs, Python syntax, exclusion config, snapshot: PASS')


if __name__=='__main__': check()
