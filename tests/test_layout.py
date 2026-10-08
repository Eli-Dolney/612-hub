import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import run
sys.path.insert(0,str(ROOT/'tools/612-hub'))
from server import catalog,engine

class LayoutTests(unittest.TestCase):
    def test_all_eight_source_tools(self):
        self.assertEqual(len(run.TOOLS),8)
        for name in run.TOOLS:
            folder,package,python=run.spec(name)
            self.assertEqual(package['name'],'612-'+name)
            self.assertTrue((folder/'src').is_dir())
            self.assertTrue((folder/'package-lock.json').is_file())
            if 'server' in package['scripts']:
                self.assertEqual(package['scripts']['server'],'node ../../scripts/api.mjs '+name)

    def test_hub_launch_targets_siblings(self):
        for app in catalog.APPS:
            self.assertEqual(app.path,ROOT/'tools'/app.folder)
            command=engine._cmd(app)
            self.assertEqual(Path(command[1]),ROOT/'scripts/run.py')
            self.assertEqual(command[2],app.id)
            self.assertTrue(Path(command[1]).is_file())

    def test_clip_discovers_pull_relative_to_checkout(self):
        source=ROOT/'tools/612-clip/server/config.py'
        spec=importlib.util.spec_from_file_location('clip_config',source)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.assertEqual(module.GROKPULL_DOWNLOADS,ROOT/'tools/612-pull/downloads')

    def test_windows_port_parse_no_real_process_actions(self):
        output='  TCP    127.0.0.1:5176    0.0.0.0:0    LISTENING    42\n  TCP    127.0.0.1:51760    0.0.0.0:0    LISTENING    43\n'
        with patch.object(engine.os,'name','nt'),patch.object(engine.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout=output)):
            self.assertEqual(engine.pids_on_port(5176),[42])
            self.assertEqual(engine._ps_table(),[])

    def test_windows_stop_command_is_mocked(self):
        with patch.object(engine.os,'name','nt'),patch.object(engine.subprocess,'run') as call:
            engine._kill_tree(42)
            self.assertEqual(call.call_args.args[0],['taskkill','/PID','42','/T','/F'])

if __name__=='__main__':unittest.main()
