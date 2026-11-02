#!/usr/bin/env python3
"""Authenticated localhost API; all calculations run through manual_update_singgyul."""
import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import stat
import sys
import threading
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.manual_update_singgyul import BACKUPS, HISTORY, PRODUCTION, KEYS, metric, run

ORIGIN = 'https://taehyeon-masu.xyz'
SESSION_SECONDS = 30 * 60
PREVIEW_SECONDS = 5 * 60
COOLDOWN_SECONDS = 15 * 60
AUDIT = Path('/var/log/soop-ranking/admin-actions.log')
SECRET_FILE = Path('/etc/soop-ranking/admin.env')


def read_secret(path=SECRET_FILE):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError('admin secret must be a regular 0600 file')
    values = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        key, sep, value = line.partition('=')
        if not sep or key in values:
            raise ValueError('invalid admin secret file')
        values[key] = value.strip()
    raw = base64.b32decode(values['TOTP_SECRET'].upper(), casefold=True)
    if len(raw) < 20:
        raise ValueError('TOTP secret is too short')
    return raw


def totp(secret, step):
    digest = hmac.new(secret, step.to_bytes(8, 'big'), hashlib.sha1).digest()
    offset = digest[-1] & 15
    number = int.from_bytes(digest[offset:offset + 4], 'big') & 0x7fffffff
    return f'{number % 1_000_000:06d}'


class AdminApp:
    def __init__(self, secret, output=PRODUCTION, history=HISTORY, backups=BACKUPS,
                 audit=AUDIT, root=ROOT, clock=time.time):
        self.secret = secret
        self.output = Path(output)
        self.history = Path(history)
        self.backups = Path(backups)
        self.audit = Path(audit)
        self.root = Path(root)
        self.clock = clock
        self.sessions = {}
        self.failures = {}
        self.used_steps = set()
        self.mutex = threading.RLock()

    def login(self, ip, code):
        with self.mutex:
            now = self.clock()
            count, until = self.failures.get(ip, (0, 0))
            if until > now:
                return None, 429
            if not isinstance(code, str) or len(code) != 6 or not code.isascii() or not code.isdigit():
                matched = None
            else:
                matched = next((step for step in (int(now // 30) - 1, int(now // 30), int(now // 30) + 1)
                                if step not in self.used_steps and hmac.compare_digest(totp(self.secret, step), code)), None)
            if matched is None:
                count += 1
                self.failures[ip] = (count, now + COOLDOWN_SECONDS if count >= 5 else 0)
                return None, 429 if count >= 5 else 401
            self.used_steps.add(matched)
            self.used_steps = {step for step in self.used_steps if step >= int(now // 30) - 1}
            self.failures.pop(ip, None)
            token = secrets.token_urlsafe(32)
            session = {'expires': now + SESSION_SECONDS, 'csrf': secrets.token_urlsafe(32), 'preview': None}
            self.sessions[token] = session
            return token, 200

    def session(self, token):
        with self.mutex:
            session = self.sessions.get(token)
            if session and session['expires'] > self.clock():
                return session
            self.sessions.pop(token, None)
            return None

    def current(self):
        snapshot = json.loads(self.output.read_text())
        row = next(r for r in snapshot['streamers'] if r['soopId'] == 'singgyul')
        dynamic = snapshot['targetResults']['dynamic']
        return {'viewer': row['cumulativeUsers'], 'donor': row['donorCount'], 'balloon': row['balloonCount'],
                'observedAt': snapshot.get('manualOverride', {}).get('observedAt') or snapshot.get('actualObservedAt') or snapshot['updatedAt'],
                'competitorDataAsOf': snapshot.get('competitorDataAsOf') or snapshot.get('actualObservedAt') or snapshot['updatedAt'],
                'projectedRank': dynamic['predictedRank'], 'safeTarget': dynamic['safe'],
                'collectionMode': snapshot.get('collectionMode', 'automatic')}

    @staticmethod
    def payload(data):
        if not isinstance(data, dict) or set(data) != {'viewer', 'donor', 'balloon', 'observedAt'}:
            raise ValueError('viewer, donor, balloon, observedAt만 입력하세요')
        values = {}
        for label in KEYS:
            value = data[label]
            if isinstance(value, bool):
                raise ValueError(label + ' 값은 양의 정수여야 합니다')
            try:
                values[label] = metric(str(value))
            except (ValueError, argparse.ArgumentTypeError) as exc:
                raise ValueError(label + ' 값은 양의 정수여야 합니다') from exc
        observed = data['observedAt']
        if not isinstance(observed, str) or len(observed) != 16:
            raise ValueError('observedAt은 YYYY-MM-DD HH:MM 형식이어야 합니다')
        return values, observed

    def preview(self, session, data):
        values, observed = self.payload(data)
        result = run(values, observed_at=observed, allow_correction=True, dry_run=True,
                     output=self.output, history=self.history, backups=self.backups, root=self.root)
        preview_id = secrets.token_urlsafe(24)
        with self.mutex:
            session['preview'] = {'id': preview_id, 'values': values, 'observedAt': observed,
                                  'snapshotHash': result['snapshotHash'], 'expires': self.clock() + PREVIEW_SECONDS,
                                  'requiresCorrection': bool(result['corrections'])}
        return {**result, 'previewId': preview_id, 'requiresCorrection': bool(result['corrections'])}

    def apply(self, session, data):
        if not isinstance(data, dict) or set(data) != {'previewId', 'confirmCorrection'}:
            raise ValueError('미리보기 결과를 다시 확인하세요')
        with self.mutex:
            preview = session['preview']
            if not preview or preview['id'] != data['previewId'] or preview['expires'] <= self.clock():
                raise ValueError('미리보기가 없거나 만료되었습니다. 다시 미리보기를 실행하세요')
            if preview['requiresCorrection'] and data['confirmCorrection'] is not True:
                raise ValueError('감소값을 정정값으로 적용하려면 추가 확인이 필요합니다')
            session['preview'] = None
        audit_fields = {'action': 'apply', 'previous': self.current(), 'new': preview['values'],
                        'observedAt': preview['observedAt']}
        self.audit_event({**audit_fields, 'result': 'attempted'})
        try:
            result = run(preview['values'], observed_at=preview['observedAt'],
                         allow_correction=preview['requiresCorrection'], dry_run=False,
                         output=self.output, history=self.history, backups=self.backups, root=self.root,
                         expected_snapshot_hash=preview['snapshotHash'])
        except Exception as exc:
            self.audit_event({**audit_fields, 'result': 'failed', 'errorType': type(exc).__name__})
            raise
        self.audit_event({**audit_fields, 'result': 'success'})
        return result

    def audit_event(self, entry):
        self.audit.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps({'timestamp': datetime.now(timezone.utc).isoformat(), **entry}, ensure_ascii=False) + '\n'
        fd = os.open(self.audit, os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError('admin audit path is not a regular file')
            os.fchmod(fd, 0o600)
            os.write(fd, line.encode())
            os.fsync(fd)
        finally:
            os.close(fd)


class Handler(BaseHTTPRequestHandler):
    server_version = 'SoopAdmin/1'

    @property
    def app(self):
        return self.server.app

    def log_message(self, format, *args):
        # No request body, authentication code, or cookie in access logs.
        pass

    def send(self, status, body, content_type='application/json; charset=utf-8', headers=None, head_only=False):
        payload = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Robots-Tag', 'noindex, nofollow')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if not head_only:
            self.wfile.write(payload)

    def authenticated(self):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get('Cookie', ''))
        except Exception:
            return None
        token = cookies.get('soop_admin_session')
        return self.app.session(token.value) if token else None

    def check_proxy(self):
        return (self.headers.get('Host') == 'taehyeon-masu.xyz' and
                self.headers.get('X-Forwarded-Proto') == 'https')

    def check_origin(self):
        return self.headers.get('Origin') == ORIGIN and self.headers.get('Content-Type', '').split(';')[0].strip() == 'application/json'

    def do_GET(self):
        if not self.check_proxy():
            return self.send(403, {'error': 'HTTPS proxy required'})
        path = self.path.split('?', 1)[0]
        static = {'/admin': ('index.html', 'text/html; charset=utf-8'),
                  '/admin/': ('index.html', 'text/html; charset=utf-8'),
                  '/admin/admin.js': ('admin.js', 'text/javascript; charset=utf-8'),
                  '/admin/admin.css': ('admin.css', 'text/css; charset=utf-8')}
        if path in static:
            name, content_type = static[path]
            return self.send(200, (ROOT / 'admin' / name).read_bytes(), content_type)
        if path != '/admin/api/state':
            return self.send(404, {'error': 'Not found'})
        session = self.authenticated()
        if not session:
            return self.send(401, {'error': 'Login required'})
        try:
            return self.send(200, {'csrfToken': session['csrf'], 'current': self.app.current()})
        except Exception:
            return self.send(500, {'error': '현재 snapshot을 읽을 수 없습니다'})

    def do_HEAD(self):
        if not self.check_proxy():
            return self.send(403, {'error': 'HTTPS proxy required'}, head_only=True)
        static = {'/admin': ('index.html', 'text/html; charset=utf-8'),
                  '/admin/': ('index.html', 'text/html; charset=utf-8'),
                  '/admin/admin.js': ('admin.js', 'text/javascript; charset=utf-8'),
                  '/admin/admin.css': ('admin.css', 'text/css; charset=utf-8')}
        item = static.get(self.path.split('?', 1)[0])
        if not item:
            return self.send(405, {'error': 'Method not allowed'}, head_only=True)
        name, content_type = item
        return self.send(200, (ROOT / 'admin' / name).read_bytes(), content_type, head_only=True)

    def do_POST(self):
        if not self.check_proxy() or not self.check_origin():
            return self.send(403, {'error': 'Same-origin HTTPS JSON request required'})
        path = self.path.split('?', 1)[0]
        if path not in ('/admin/api/login', '/admin/api/preview', '/admin/api/apply', '/admin/api/logout'):
            return self.send(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '-1'))
            if not 0 <= size <= 2048:
                raise ValueError('Request too large')
            data = json.loads(self.rfile.read(size))
        except (ValueError, json.JSONDecodeError):
            return self.send(400, {'error': 'Invalid JSON request'})
        if path == '/admin/api/login':
            if not isinstance(data, dict) or set(data) != {'code'}:
                return self.send(400, {'error': 'Six-digit code required'})
            token, status = self.app.login(self.headers.get('X-Real-IP', 'local'), data['code'])
            if not token:
                return self.send(status, {'error': 'Invalid code or temporarily locked'})
            return self.send(200, {'authenticated': True}, headers={'Set-Cookie':
                f'soop_admin_session={token}; Path=/admin; Max-Age={SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict'})
        session = self.authenticated()
        if not session:
            return self.send(401, {'error': 'Login required'})
        if not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), session['csrf']):
            return self.send(403, {'error': 'CSRF token required'})
        if path == '/admin/api/logout':
            with self.app.mutex:
                for key, value in list(self.app.sessions.items()):
                    if value is session:
                        self.app.sessions.pop(key, None)
            return self.send(200, {'authenticated': False}, headers={'Set-Cookie':
                'soop_admin_session=; Path=/admin; Max-Age=0; Secure; HttpOnly; SameSite=Strict'})
        try:
            result = self.app.preview(session, data) if path.endswith('/preview') else self.app.apply(session, data)
            return self.send(200, result)
        except (ValueError, OSError) as exc:
            return self.send(409 if path.endswith('/apply') else 400, {'error': str(exc)})
        except Exception:
            return self.send(500, {'error': '작업에 실패했습니다. 서버 로그를 확인하세요'})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, app):
        if address[0] != '127.0.0.1':
            raise ValueError('admin backend must bind to 127.0.0.1')
        super().__init__(address, Handler)
        self.app = app


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--secret-file', type=Path, default=SECRET_FILE)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    app = AdminApp(read_secret(args.secret_file))
    with Server(('127.0.0.1', args.port), app) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()
