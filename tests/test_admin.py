import shutil
import concurrent.futures
import fcntl
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

from admin.server import AdminApp, Server, totp, read_secret, SESSION_SECONDS

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'tests/fixtures/legacy-ranking.json'


class AdminSecretTests(unittest.TestCase):
    def test_standard_totp_vector_and_secret_file_permissions(self):
        secret = b'12345678901234567890'
        self.assertEqual(totp(secret, 1), '287082')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'admin.env'
            path.write_text('TOTP_SECRET=' + base64.b32encode(secret).decode() + '\n')
            path.chmod(0o600)
            self.assertEqual(read_secret(path), secret)
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                read_secret(path)


class AdminTests(unittest.TestCase):
    def setUp(self):
        node = shutil.which('node') or '/opt/soop-ranking/runtime/node'
        if Path(node).exists():
            node_patch = patch.dict(os.environ, {'NODE_BINARY': node})
            node_patch.start()
            self.addCleanup(node_patch.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.output = self.folder / 'ranking.json'
        self.output.write_bytes(DATA.read_bytes())
        self.old = json.loads(DATA.read_text())
        self.target = next(r for r in self.old['streamers'] if r['soopId'] == 'singgyul')
        self.secret = b'01234567890123456789'
        self.now = [time.time()]
        self.app = AdminApp(self.secret, self.output, self.folder / 'history',
                            self.folder / 'backups', self.folder / 'admin-actions.log',
                            ROOT, clock=lambda: self.now[0])
        self.server = Server(('127.0.0.1', 0), self.app)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, path, body=None, cookie=None, csrf=None, origin='https://taehyeon-masu.xyz'):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=60)
        headers = {'Host': 'taehyeon-masu.xyz', 'X-Forwarded-Proto': 'https',
                   'X-Real-IP': '192.0.2.1'}
        if body is not None:
            headers.update({'Origin': origin, 'Content-Type': 'application/json'})
        if cookie:
            headers['Cookie'] = cookie
        if csrf:
            headers['X-CSRF-Token'] = csrf
        conn.request('GET' if body is None else 'POST', path,
                     None if body is None else json.dumps(body), headers)
        response = conn.getresponse()
        data = json.loads(response.read())
        result = (response.status, data, response.getheader('Set-Cookie'))
        conn.close()
        return result

    def login(self):
        code = totp(self.secret, int(self.now[0] // 30))
        status, _, cookie = self.request('/admin/api/login', {'code': code})
        self.assertEqual(status, 200)
        self.assertIn('Secure; HttpOnly; SameSite=Strict', cookie)
        token = cookie.split(';')[0]
        status, state, _ = self.request('/admin/api/state', cookie=token)
        self.assertEqual(status, 200)
        return token, state['csrfToken']

    def values(self, decrease=False):
        kst = datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d %H:%M')
        return {'viewer': str(self.target['cumulativeUsers'] + (-1 if decrease else 100)),
                'donor': str(self.target['donorCount'] + 1),
                'balloon': str(self.target['balloonCount'] + 100), 'observedAt': kst}

    def test_A_invalid_totp_and_rate_limit(self):
        for i in range(5):
            status, _, _ = self.request('/admin/api/login', {'code': '000000'})
            self.assertEqual(status, 429 if i == 4 else 401)
        status, _, _ = self.request('/admin/api/login', {'code': totp(self.secret, int(self.now[0] // 30))})
        self.assertEqual(status, 429)

    def test_B_C_D_session_auth_and_expiry(self):
        self.assertEqual(self.request('/admin/api/state')[0], 401)
        self.assertEqual(self.request('/admin/api/preview', self.values())[0], 401)
        cookie, csrf = self.login()
        self.assertTrue(csrf)
        self.assertEqual(self.request('/admin/api/preview', self.values(), cookie=cookie)[0], 403)
        self.assertEqual(self.request('/admin/api/preview', self.values(), cookie=cookie, csrf=csrf, origin='https://evil.example')[0], 403)
        self.now[0] += SESSION_SECONDS + 1
        self.assertEqual(self.request('/admin/api/state', cookie=cookie)[0], 401)

    def test_invalid_metric_is_client_error(self):
        cookie, csrf = self.login()
        self.assertEqual(self.request('/admin/api/preview', {**self.values(), 'viewer': 'NaN'}, cookie, csrf)[0], 400)

    def test_E_F_H_J_K_preview_apply_and_lock(self):
        cookie, csrf = self.login()
        before = self.output.read_bytes()
        with patch('services.trackify.Trackify', side_effect=AssertionError('Trackify request forbidden')):
            status, preview, _ = self.request('/admin/api/preview', self.values(), cookie, csrf)
            self.assertEqual(status, 200)
            self.assertEqual(self.output.read_bytes(), before)
            self.assertFalse((self.folder / 'history').exists())
            lock = self.output.with_suffix('.lock')
            with lock.open('a') as handle:
                fcntl.flock(handle, fcntl.LOCK_EX)
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    pending = pool.submit(self.request, '/admin/api/apply',
                                          {'previewId': preview['previewId'], 'confirmCorrection': False}, cookie, csrf)
                    time.sleep(.15)
                    self.assertFalse(pending.done())
                    fcntl.flock(handle, fcntl.LOCK_UN)
                    status, applied, _ = pending.result(timeout=60)
        self.assertEqual(status, 200)
        self.assertTrue(applied['published'])
        self.assertEqual(len(list((self.folder / 'backups').glob('manual-*'))), 1)
        self.assertEqual(self.output.with_suffix('.tmp').exists(), False)
        published = json.loads(self.output.read_text())
        self.assertEqual(published['simulationBaseline'], self.old['simulationBaseline'])
        self.assertEqual(published['supportBaseline'], self.old['supportBaseline'])
        self.assertEqual(len(published['targetResults']['dynamic']['projectedRows']), 98)
        audit = [json.loads(line) for line in (self.folder / 'admin-actions.log').read_text().splitlines()]
        self.assertEqual([entry['result'] for entry in audit], ['attempted', 'success'])
        self.assertNotIn('code', str(audit))

    def test_G_decrease_requires_second_confirmation(self):
        cookie, csrf = self.login()
        status, preview, _ = self.request('/admin/api/preview', self.values(decrease=True), cookie, csrf)
        self.assertEqual(status, 200)
        self.assertTrue(preview['requiresCorrection'])
        self.assertEqual(self.request('/admin/api/apply', {'previewId': preview['previewId'], 'confirmCorrection': False}, cookie, csrf)[0], 409)
        self.assertEqual(self.output.read_bytes(), DATA.read_bytes())
        status, applied, _ = self.request('/admin/api/apply', {'previewId': preview['previewId'], 'confirmCorrection': True}, cookie, csrf)
        self.assertEqual(status, 200)
        self.assertEqual(applied['corrections'][0]['reason'], 'manual_correction')
        self.assertEqual(len(list((self.folder / 'history/manual-corrections').glob('*.json'))), 1)

    def test_preview_stale_snapshot_blocks_apply(self):
        cookie, csrf = self.login()
        status, preview, _ = self.request('/admin/api/preview', self.values(), cookie, csrf)
        self.assertEqual(status, 200)
        self.output.write_bytes(self.output.read_bytes() + b' ')
        status, _, _ = self.request('/admin/api/apply', {'previewId': preview['previewId'], 'confirmCorrection': False}, cookie, csrf)
        self.assertEqual(status, 409)
        self.assertFalse((self.folder / 'backups').exists())

    def test_I_localhost_only(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        with self.assertRaises(ValueError):
            Server(('0.0.0.0', 0), self.app)

    def test_admin_head_returns_page_headers(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        conn.request('HEAD', '/admin/', headers={'Host': 'taehyeon-masu.xyz', 'X-Forwarded-Proto': 'https'})
        response = conn.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader('X-Robots-Tag'), 'noindex, nofollow')
        self.assertEqual(response.read(), b'')
        conn.close()


if __name__ == '__main__':
    unittest.main()
import base64
