"""Launch one prepared 612 tool on macOS or Windows; never installs dependencies."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ('hub','play','pull','clip','edit','harvest','mix','voice')

def spec(name):
    if name not in TOOLS:
        raise ValueError('Unknown 612 tool')
    folder = ROOT / 'tools' / ('612-' + name)
    package = json.loads((folder / 'package.json').read_text())
    python = folder / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    return folder, package, python

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tool',choices=TOOLS)
    parser.add_argument('--check',action='store_true',help='Check paths/dependencies without starting anything')
    args=parser.parse_args()
    folder, package, python=spec(args.tool)
    env = os.environ.copy()
    if os.name == 'nt':
        # A Windows checkout can carry its own supported Node.js and npm.
        runtime = ROOT / '.runtime'
        if (runtime/'node.exe').is_file() and (runtime/'npm.cmd').is_file():
            path = env.get('PATH')
            env['PATH'] = os.pathsep.join((str(runtime), path)) if path else str(runtime)
    node = shutil.which('node', path=env.get('PATH'))
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm', path=env.get('PATH'))
    missing=[]
    if not node or not npm:missing.append('Node.js/npm')
    if not (folder/'node_modules').is_dir():missing.append('npm dependencies (run npm ci inside this tool)')
    if 'server' in package['scripts'] and not python.is_file():missing.append('local Python environment (see WINDOWS.md or README.md)')
    if missing:
        print('Missing: '+', '.join(missing),file=sys.stderr)
        return 1
    if args.check:
        print(f'612 {args.tool}: launch paths ready')
        return 0
    # Fixed command; no untrusted arguments are interpolated into a shell.
    if os.name=='nt':
        command=[os.environ.get('COMSPEC','cmd.exe'),'/d','/c','npm.cmd','run','dev']
    else:
        command=[npm,'run','dev']
    return subprocess.call(command,cwd=folder,env=env)

if __name__=='__main__':sys.exit(main())
