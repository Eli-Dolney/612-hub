// Invoked from a tool's npm script. Uses that tool's own virtual environment.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const ports = { hub:8793, pull:8788, mix:8789, voice:8790, harvest:8791, clip:8792 };
const tool = process.argv[2];
if (!Object.hasOwn(ports, tool)) throw new Error('Unknown API tool');
const python = resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) throw new Error('Create this tool’s .venv and install server/requirements.txt first. See WINDOWS.md.');
// Uvicorn's Windows reloader sends Ctrl+C to the shared npm console.
const reload = process.platform === 'win32' ? [] : ['--reload', '--reload-dir', 'server'];
const child = spawn(python, ['-m','uvicorn','server.app:app','--host','127.0.0.1','--port',String(ports[tool]),...reload,'--timeout-graceful-shutdown','1'],{stdio:'inherit'});
child.on('error',error=>{ console.error(error.message); process.exitCode=1; });
child.on('exit',code=>{process.exitCode=code ?? 1;});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
