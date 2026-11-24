"""Offline regression checks for YouTube runtime and client selection."""

import subprocess
import unittest
from unittest.mock import patch

from . import engine


class DownloadSetupTests(unittest.TestCase):
    def setUp(self):
        engine._supported_node.cache_clear()
        self.addCleanup(engine._supported_node.cache_clear)

    def test_node_20_is_rejected_and_node_24_is_supported(self):
        for version, expected in (("v20.18.0", False), ("v24.19.0", True)):
            with self.subTest(version=version):
                engine._supported_node.cache_clear()
                with patch.object(engine.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=version)):
                    self.assertEqual(engine._supported_node("node"), expected)

    def test_local_runtime_wins_over_old_system_node(self):
        with patch.dict(engine.os.environ, {}, clear=True), \
             patch.object(engine.os.path, "isfile", return_value=True), \
             patch.object(engine.shutil, "which", return_value="system-node"), \
             patch.object(engine, "_supported_node", side_effect=lambda path: path != "system-node"):
            runtime = engine.js_runtimes()
        self.assertIn(".runtime", runtime["node"]["path"])

    def test_deno_is_used_when_node_is_too_old(self):
        with patch.dict(engine.os.environ, {}, clear=True), \
             patch.object(engine.os.path, "isfile", return_value=True), \
             patch.object(engine, "_supported_node", return_value=False), \
             patch.object(engine.shutil, "which", side_effect=lambda name: {"node": "old-node", "deno": "deno"}.get(name)):
            self.assertEqual(engine.js_runtimes(), {"deno": {"path": "deno"}})

    def test_audio_uses_current_default_clients(self):
        opts = {"extractor_args": {"youtube": {"player_client": ["tv"]}}}
        with patch.dict(engine.os.environ, {}, clear=True):
            engine.apply_youtube_clients(opts, music=True)
        self.assertNotIn("player_client", opts["extractor_args"]["youtube"])

    def test_explicit_helper_configuration_is_preserved(self):
        opts = {}
        with patch.dict(engine.os.environ, {"YTDLP_POT_BASE_URL": "http://127.0.0.1:4416"}):
            engine.apply_youtube_clients(opts, music=True)
        self.assertEqual(opts["extractor_args"]["youtube"]["player_client"], ["mweb"])

    def test_320kbps_produces_mp3(self):
        opts = {}
        engine.configure_audio(opts, "320kbps", "youtube.com", False)
        self.assertEqual(opts["postprocessors"][0]["preferredcodec"], "mp3")
        self.assertEqual(opts["postprocessors"][0]["preferredquality"], "320")


if __name__ == "__main__":
    unittest.main()
