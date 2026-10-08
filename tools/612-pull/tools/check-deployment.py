#!/usr/bin/env python3
"""Offline regression checks for the shared deployment; no real media requests."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

class Helper(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == '/ping' else 404)
        self.end_headers()
    def log_message(self, *_):
        pass

class DeploymentChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helper = ThreadingHTTPServer(('127.0.0.1', 0), Helper)
        threading.Thread(target=cls.helper.serve_forever, daemon=True).start()
        cls.pot_url = f'http://127.0.0.1:{cls.helper.server_port}'
        cls.tmp = tempfile.TemporaryDirectory()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.env = {**os.environ, 'GROKPULL_GUEST_ONLY': '1',
                   'GROKPULL_PASSWORD': 'test-household-pin',
                   'GROKPULL_CONFIG_DIR': cls.tmp.name, 'GROKPULL_CORS': 'https://example.test',
                   'YTDLP_POT_BASE_URL': cls.pot_url + '/'}
        cls.proc = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'server.app:app',
                                     '--host', '127.0.0.1', '--port', str(cls.port)],
                                    cwd=ROOT, env=cls.env, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                cls.request('/api/guest/status')
                break
            except OSError:
                if cls.proc.poll() is not None:
                    raise RuntimeError('Test server failed to start')
                time.sleep(.1)
        else:
            cls.proc.terminate()
            raise RuntimeError('Test server did not become ready')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.helper.shutdown()
        cls.helper.server_close()
        cls.tmp.cleanup()

    @classmethod
    def request(cls, path, body=None, headers=None, method=None):
        req = Request(f'http://127.0.0.1:{cls.port}{path}',
                      data=json.dumps(body).encode() if body is not None else None,
                      headers={'Content-Type': 'application/json', **(headers or {})}, method=method)
        try:
            res = urlopen(req, timeout=10)
        except HTTPError as exc:
            res = exc
        raw = res.read()
        return res.status, dict(res.headers), json.loads(raw) if raw else None

    def test_custom_helper_and_config_location(self):
        result = subprocess.check_output([sys.executable, '-c',
            'from server import engine,app; import json; '
            'print(json.dumps([engine.pot_ready(), engine.base_opts({})["extractor_args"]["youtubepot-bgutilhttp"], str(app.CONFIG_PATH)]))'],
            cwd=ROOT, env=self.env, text=True)
        ready, args, config = json.loads(result)
        self.assertTrue(ready)
        self.assertEqual(args['base_url'], [self.pot_url])
        self.assertEqual(Path(config).parent, Path(self.tmp.name))

    def test_configured_youtube_clients_keep_helper(self):
        code = ('from server import engine; '
                'o=engine.base_opts({}); engine.apply_youtube_clients(o, music=True); '
                'assert o["extractor_args"]["youtube"]["player_client"] == ["mweb"]; '
                'engine.apply_youtube_clients(o, fallback=True); '
                'assert o["extractor_args"]["youtube"]["player_client"] == ["web_safari"]; '
                'assert o["extractor_args"]["youtubepot-bgutilhttp"]["base_url"]')
        subprocess.check_call([sys.executable, '-c', code], cwd=ROOT, env=self.env)

    def test_status(self):
        status, _, data = self.request('/api/guest/status')
        self.assertEqual(status, 200)
        self.assertTrue(data['ok'])
        self.assertTrue(data['pot'])
        self.assertIn('youtube', data)

    def test_password_and_protected_routes(self):
        self.assertEqual(self.request('/api/guest/login', {'password': 'incorrect'})[0], 403)
        status, _, data = self.request('/api/guest/login', {'password': 'test-household-pin'})
        self.assertEqual(status, 200)
        self.assertTrue(data['token'])
        for path in ['/api/guest/pull', '/api/guest/job/unknown', '/api/guest/file/unknown']:
            self.assertEqual(self.request(path, {} if path.endswith('/pull') else None)[0], 401)
        status, _, _ = self.request('/api/guest/pull', {'url': 'https://www.netflix.com/title/123'},
                                   {'Authorization': 'Bearer ' + data['token']})
        self.assertEqual(status, 400)

    def test_studio_not_exposed(self):
        for path in ['/api/settings', '/api/health', '/api/media/raw?path=/etc/passwd', '/docs', '/openapi.json', '/']:
            self.assertEqual(self.request(path)[0], 404, path)
        self.assertEqual(self.request('/api/settings', {}, method='PUT')[0], 404)

    def test_website_cors(self):
        for origin in ['https://example.test']:
            status, headers, _ = self.request('/api/guest/status', headers={'Origin': origin})
            self.assertEqual(status, 200)
            self.assertEqual(headers.get('access-control-allow-origin'), origin)
            req = Request(f'http://127.0.0.1:{self.port}/api/guest/login', method='OPTIONS',
                          headers={'Origin': origin, 'Access-Control-Request-Method': 'POST',
                                   'Access-Control-Request-Headers': 'content-type'})
            self.assertEqual(urlopen(req, timeout=10).status, 200)
        _, headers, _ = self.request('/api/guest/status', headers={'Origin': 'https://unrelated.example'})
        self.assertNotIn('access-control-allow-origin', headers)

if __name__ == '__main__':
    unittest.main(verbosity=2)
