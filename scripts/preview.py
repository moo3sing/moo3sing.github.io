#!/usr/bin/env python3
import re
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT=Path(__file__).resolve().parents[1]
headers=re.findall(r'add_header ([\w-]+) "([^"]+)" always;', (ROOT/'nginx/security-headers.conf').read_text())


class Preview(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'dist'),**kwargs)
    def translate_path(self,path):
        if path.split('?')[0] in ['/ranking','/ranking/']:path='/ranking.html'
        return super().translate_path(path)
    def end_headers(self):
        for name,value in headers:self.send_header(name,value)
        self.send_header('Cache-Control','no-store')
        super().end_headers()


if __name__=='__main__':
    print('Preview: http://127.0.0.1:4173',flush=True)
    ThreadingHTTPServer(('127.0.0.1',4173),Preview).serve_forever()
