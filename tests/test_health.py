"""Regression checks for local apps whose health checks take over 0.8 seconds."""

from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "612-hub"))
from server import catalog, engine


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/health":
            time.sleep(1.1)
            body = b'{"ok": true}'
            self.send_response(200)
        elif self.path == "/api/queue":
            body = b'{"jobs": []}'
            self.send_response(200)
        else:
            body = b'{}'
            self.send_response(503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def log_message(self, *args):
        pass


class HealthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), HealthHandler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.spec = replace(catalog.get_app("pull"), ui_port=cls.http.server_port,
                           api_port=cls.http.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()

    def test_slow_healthy_app_is_live(self):
        self.assertTrue(engine.live(self.spec))

    def test_status_keeps_slow_health_details(self):
        with patch.object(engine, "installed", return_value=True), \
             patch.object(engine, "configured", return_value=True), \
             patch.object(engine, "spec_pids", return_value=[]), \
             patch.object(engine, "recent_work", return_value=[]), \
             patch.object(engine, "_idle_s", return_value=None):
            status = engine.app_status(self.spec, [])
        self.assertTrue(status["running"])
        self.assertEqual(status["health"], {"ok": True})

    def test_http_error_is_not_live(self):
        self.assertFalse(engine.live(replace(self.spec, health_path="/unavailable")))


if __name__ == "__main__":
    unittest.main()
