# 612 Hub

Local dashboard for the seven sibling tools: Pull, Harvest, Voice, Mix, Clip, Edit and Play.
Launch prepared tools, inspect live job queues and open generated media.

Follow the repository [setup](../../README.md) or [Windows guide](../../WINDOWS.md),
then run `python3 scripts/run.py hub` from the repository root (`py -3.12` on Windows).
Open http://127.0.0.1:5181; the local API uses port 8793.

Tool discovery is relative to this checkout, so it works outside the Desktop.
Dependencies must already be prepared; launch does not install anything.
Logs and local preferences live in the ignored `logs/` folder.

Mac CPU/RAM reporting and load guards remain supported. Windows reports live status
through HTTP but has no CPU/RAM telemetry. Windows launch/open/stop adapters have
unit coverage only; they have not been run on Windows.
