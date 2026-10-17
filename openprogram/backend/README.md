# `openprogram/backend/`

> Pluggable execution backend for shell-style tools.

## Overview

The ``bash`` tool (and any future sibling that wants to) routes
command execution through ``get_active_backend().run(...)`` instead
of calling ``subprocess`` directly. That keeps the tool code
backend-agnostic.

Three backends ship out of the box:
    local    — subprocess.run on the host (default, unchanged behavior)
    docker   — a long-lived container per session (``docker exec``)
    ssh      — ``ssh <target> "..."`` per call, one shared connection

Which one runs is decided by the session's environment
(``openprogram.environments``): every conversation picks one when it
is created, and the backend follows it.

## Files in this directory

- **`_gui_child.py`** — Copied into the isolated scratch directory; never imported by the host
- **`base.py`** — Backend ABC + shared RunResult type
- **`docker.py`** — Docker backend
- **`gui.py`** — Mandatory local isolation for the persistent GUI interpreter
- **`gui_broker.py`** — Host-owned GUI primitive admission and durable receipts
- **`gui_runner.py`** — Persistent isolated Python transport, without host or GUI capabilities
- **`local.py`** — Local backend
- **`process.py`** — Collect a local command with execution cancellation and child cleanup
- **`ssh.py`** — SSH backend

_Auto-generated from `__init__.py` docstring — keep that as the source of truth; re-run `python scripts/gen_dir_readmes.py` from the repo root to refresh._
