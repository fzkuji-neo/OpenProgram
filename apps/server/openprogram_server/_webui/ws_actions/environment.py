"""Environment WS actions.

list_environments / save_environment / delete_environment /
set_default_environment / test_environment

Environments decide where a conversation's commands and files live
(local / ssh / docker). Every change is broadcast as ``environments`` so
each open composer refreshes its picker.
"""
from __future__ import annotations

import asyncio
import json


def _snapshot() -> dict:
    from openprogram.environments import default_environment_id, list_environments
    from openprogram.setup import _read_config
    cfg = _read_config()
    return {
        "default": default_environment_id(cfg),
        "items": [env.public() for env in list_environments(cfg)],
    }


def _broadcast() -> None:
    from openprogram.webui import server as _s
    _s._broadcast(json.dumps({"type": "environments", "data": _snapshot()}, default=str))


async def _reply(ws, kind: str, data: dict) -> None:
    await ws.send_text(json.dumps({"type": kind, "data": data}, default=str))


async def handle_list_environments(ws, cmd: dict):
    await _reply(ws, "environments", _snapshot())


async def handle_save_environment(ws, cmd: dict):
    from openprogram.environments import EnvironmentError, save_environment
    payload = cmd.get("environment") if isinstance(cmd.get("environment"), dict) else {}
    try:
        env = save_environment(payload)
    except EnvironmentError as exc:
        await _reply(ws, "environment_result", {"ok": False, "error": str(exc),
                                                 "id": payload.get("id")})
        return
    await _reply(ws, "environment_result", {"ok": True, "environment": env.public(),
                                             "id": env.id})
    _broadcast()


async def handle_delete_environment(ws, cmd: dict):
    from openprogram.environments import EnvironmentError, delete_environment
    env_id = (cmd.get("id") or "").strip()
    try:
        delete_environment(env_id)
    except EnvironmentError as exc:
        await _reply(ws, "environment_result", {"ok": False, "error": str(exc), "id": env_id})
        return
    await _reply(ws, "environment_result", {"ok": True, "id": env_id, "deleted": True})
    _broadcast()


async def handle_set_default_environment(ws, cmd: dict):
    from openprogram.environments import EnvironmentError, set_default_environment
    env_id = (cmd.get("id") or "").strip()
    try:
        set_default_environment(env_id)
    except EnvironmentError as exc:
        await _reply(ws, "environment_result", {"ok": False, "error": str(exc), "id": env_id})
        return
    await _reply(ws, "environment_result", {"ok": True, "id": env_id, "default": True})
    _broadcast()


async def handle_test_environment(ws, cmd: dict):
    from openprogram.environments import get_environment
    from openprogram.environments.check import check_environment
    env_id = (cmd.get("id") or "").strip()
    env = get_environment(env_id)
    if env is None:
        await _reply(ws, "environment_test", {"id": env_id, "ok": False,
                                               "detail": "Unknown environment"})
        return
    ok, detail = await asyncio.to_thread(check_environment, env)
    await _reply(ws, "environment_test", {"id": env_id, "ok": ok, "detail": detail})


ACTIONS = {
    "list_environments": handle_list_environments,
    "save_environment": handle_save_environment,
    "delete_environment": handle_delete_environment,
    "set_default_environment": handle_set_default_environment,
    "test_environment": handle_test_environment,
}
