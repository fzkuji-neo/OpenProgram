"""Agent registry + on-disk storage.

Each agent is a folder under ``<state>/agents/<id>/``; the agent
configuration itself lives in ``agent.json``. A top-level
``<state>/agents.json`` holds ordering and the default-agent pointer.

Mirrors OpenClaw's ``agents.list`` / ``agents.defaults`` config
shape, simplified — we keep:

  id, name, description, revision, default, model (provider+id), thinking_effort, system_prompt,
  skills {disabled: []}, tools {disabled: []}, identity {name, mention_patterns},
  created_at, updated_at.

Anything else the UI wants to surface can be added to the dataclass
and schema without breaking older configs (missing fields fall back
to defaults).
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import tempfile
import threading
import unicodedata
from contextlib import contextmanager

from openprogram import _compat as fcntl
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional


class AgentNotFound(KeyError):
    """Raised when an agent id isn't in the registry."""


class AgentRevisionConflict(ValueError):
    """A conditional write no longer matches the saved configuration."""

    def __init__(self, current: "AgentSpec") -> None:
        super().__init__("agent configuration changed; reload before saving")
        self.current = current


class AgentPreconditionRequired(ValueError):
    """An HTTP configuration update must identify the version it edits."""


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

DEFAULT_AGENT_ID = "main"
_INDEX_FILE = "agents.json"
_AGENT_FILE = "agent.json"
_VALID_ID = re.compile(r"^[a-z][a-z0-9_-]{0,39}$")


@dataclass
class AgentModelRef:
    """Which LLM backs this agent."""
    provider: str = ""          # "anthropic", "openai-codex", ...
    id: str = ""                # "claude-sonnet-4-6", "gpt-4o", ...


@dataclass
class AgentIdentity:
    """Human-facing identity — name the bot shows to channel users,
    and mention tokens that cause group messages to route to this
    agent (if it's bound to a group peer).
    """
    name: str = ""
    mention_patterns: list[str] = field(default_factory=list)


def validate_memory_config(raw: object, *, partial: bool = False) -> dict[str, Any]:
    """Validate stored memory settings; partial patches are merged before use."""
    if not isinstance(raw, dict):
        raise ValueError("memory must be an object")
    if set(raw) - {"mode", "read_spaces", "write_space", "required"}:
        raise ValueError("memory contains unsupported fields")
    out: dict[str, Any] = {} if partial else {
        "mode": "off", "read_spaces": ["self"],
        "write_space": "self", "required": False,
    }
    if "mode" in raw:
        mode = raw["mode"]
        if not isinstance(mode, str) or mode not in {"off", "read_only", "read_write"}:
            raise ValueError("memory.mode must be off, read_only, or read_write")
        out["mode"] = mode
    if "read_spaces" in raw:
        spaces = raw["read_spaces"]
        if not isinstance(spaces, list) or any(
            not isinstance(space, str) or space not in {"self", "legacy_global"}
            for space in spaces
        ):
            raise ValueError("memory.read_spaces must list self or legacy_global")
        out["read_spaces"] = list(dict.fromkeys(spaces))
    if "write_space" in raw:
        space = raw["write_space"]
        if not isinstance(space, str) or space not in {"self", "legacy_global"}:
            raise ValueError("memory.write_space must be self or legacy_global")
        out["write_space"] = space
    if "required" in raw:
        if not isinstance(raw["required"], bool):
            raise ValueError("memory.required must be a boolean")
        out["required"] = raw["required"]
    if out.get("mode") in {"read_only", "read_write"}:
        reads = out.get("read_spaces")
        if reads is not None and not reads:
            raise ValueError("memory requires at least one readable space")
        if out["mode"] == "read_write" and reads is not None and "write_space" in out:
            if out["write_space"] not in reads:
                raise ValueError("memory.write_space must also be readable")
    return out


@dataclass
class AgentSpec:
    """One agent record. Serialises round-trip to ``agent.json``."""
    id: str
    name: str = ""
    default: bool = False
    model: AgentModelRef = field(default_factory=AgentModelRef)
    thinking_effort: str = "medium"
    system_prompt: str = ""
    # Unified extension gating. Each block has ``disabled`` / ``allowed``
    # name-pattern lists (fnmatch syntax — exact names are the trivial
    # case). Skills carry an extra ``categories`` filter; MCP carries
    # ``required`` (must-have server patterns; agent unavailable if
    # missing).
    skills: dict[str, Any] = field(default_factory=lambda: {
        "disabled": [], "allowed": [], "categories": [],
    })
    tools: dict[str, Any] = field(default_factory=lambda: {
        "mode": "automatic",
    })
    mcp: dict[str, Any] = field(default_factory=lambda: {
        "disabled": [], "allowed": [], "required": [],
    })
    identity: AgentIdentity = field(default_factory=AgentIdentity)
    # Session routing policy (see agents/context_engine.py and
    # channels/_conversation.py). Values mirror OpenClaw's dmScope:
    #   "main"                      — one shared session across all DMs
    #   "per-peer"                  — one session per sender (any channel)
    #   "per-channel-peer"          — one per (channel, sender)
    #   "per-account-channel-peer"  — one per (account, channel, sender)
    session_scope: str = "per-account-channel-peer"
    # Idle reset — start a fresh session after N minutes of silence
    # (0 = never). Default 4320 (3 days) so a long-lost contact like
    # "alice who hasn't written in a month" shows up as a new session
    # thread rather than reviving the old context. Independent of
    # daily reset (below).
    session_idle_minutes: int = 4320
    # Daily reset — if non-empty, hour-of-day in local time at which
    # stale sessions get cut (e.g. "04:00"). Empty = no daily reset.
    session_daily_reset: str = ""
    created_at: float = 0.0
    updated_at: float = 0.0
    description: str = ""
    revision: int = 1
    memory: dict[str, Any] = field(default_factory=lambda: validate_memory_config({}))
    memory_policy_epoch: int = 1

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        return out

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "AgentSpec":
        model = raw.get("model") or {}
        identity = raw.get("identity") or {}
        memory = validate_memory_config(raw["memory"] if "memory" in raw else {
            "mode": "read_write", "read_spaces": ["legacy_global"],
            "write_space": "legacy_global", "required": False,
        })
        memory_epoch = raw.get("memory_policy_epoch", 1)
        if isinstance(memory_epoch, bool) or not isinstance(memory_epoch, int) or memory_epoch < 1:
            raise ValueError("memory_policy_epoch must be a positive integer")
        return cls(
            id=str(raw.get("id") or "").strip(),
            name=str(raw.get("name") or ""),
            description=str(raw.get("description") or ""),
            revision=int(raw.get("revision") or 1),
            memory=memory,
            memory_policy_epoch=memory_epoch,
            default=bool(raw.get("default") or False),
            model=AgentModelRef(
                provider=str(model.get("provider") or ""),
                id=str(model.get("id") or ""),
            ),
            thinking_effort=str(
                raw["thinking_effort"]
                if raw.get("thinking_effort") is not None else "medium"
            ),
            system_prompt=str(raw.get("system_prompt") or ""),
            skills=dict(raw.get("skills") or {
                "disabled": [], "allowed": [], "categories": [],
            }),
            tools=dict(raw.get("tools") or {"mode": "automatic"}),
            mcp=dict(raw.get("mcp") or {"disabled": [], "allowed": [], "required": []}),
            identity=AgentIdentity(
                name=str(identity.get("name") or ""),
                mention_patterns=list(identity.get("mention_patterns") or []),
            ),
            session_scope=str(
                raw.get("session_scope") or "per-account-channel-peer"
            ),
            session_idle_minutes=int(
                raw.get("session_idle_minutes")
                if raw.get("session_idle_minutes") is not None
                else 4320
            ),
            session_daily_reset=str(raw.get("session_daily_reset") or ""),
            created_at=float(raw.get("created_at") or 0.0),
            updated_at=float(raw.get("updated_at") or 0.0),
        )


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def _state_root() -> Path:
    from openprogram.paths import get_state_dir
    root = get_state_dir()
    (root / "agents").mkdir(parents=True, exist_ok=True)
    return root


def agent_dir(agent_id: str) -> Path:
    return _state_root() / "agents" / agent_id


def sessions_dir(agent_id: str) -> Path:
    d = agent_dir(agent_id) / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def workspace_dir(agent_id: str) -> Path:
    d = agent_dir(agent_id) / "workspace"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _agent_file(agent_id: str) -> Path:
    return agent_dir(agent_id) / _AGENT_FILE


def _index_file() -> Path:
    return _state_root() / _INDEX_FILE


# ---------------------------------------------------------------------------
# Locking — one fcntl lock covers both agents.json and the per-agent files.
# Agent mutations are infrequent; a single big lock is simpler than
# per-agent locks and avoids deadlock windows.
# ---------------------------------------------------------------------------

_lock = threading.RLock()
_writer_state = threading.local()


def _file_lock(path: Path):
    """Yield an fcntl.LOCK_EX'd file handle on ``path``. Caller must
    close it to release the lock. Used for cross-process synchronization
    around the single agents.json and each agent.json."""
    lock_path = path.with_suffix(path.suffix + ".lock")
    fh = open(lock_path, "a+", encoding="utf-8")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
    except BaseException:
        fh.close()
        raise
    return fh


@contextmanager
def configuration_lock():
    """Hold the configuration writer lock, including across processes.

    Nested manager operations in the same thread reuse the file lock.
    This also lets a short policy-checked commit keep its check atomic
    with respect to configuration changes.
    """
    with _lock:
        if getattr(_writer_state, "held", False):
            yield
            return
        with _file_lock(_index_file()):
            _writer_state.held = True
            try:
                yield
            finally:
                _writer_state.held = False


# ---------------------------------------------------------------------------
# Low-level I/O
# ---------------------------------------------------------------------------

def _read_index() -> dict[str, Any]:
    path = _index_file()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"v": 1, "default_id": "", "order": []}
    data.setdefault("v", 1)
    data.setdefault("default_id", "")
    data.setdefault("order", [])
    return data


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as stream:
            tmp = Path(stream.name)
            json.dump(data, stream, indent=2, sort_keys=True)
        os.replace(tmp, path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def _write_index(data: dict[str, Any]) -> None:
    _write_json(_index_file(), data)


def _read_agent(agent_id: str) -> Optional[AgentSpec]:
    path = _agent_file(agent_id)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    spec = AgentSpec.from_dict(raw)
    spec.id = agent_id  # directory name wins if they drift
    return spec


def _write_agent(spec: AgentSpec) -> None:
    path = _agent_file(spec.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = _read_agent(spec.id)
    spec.revision = previous.revision + 1 if previous is not None else 1
    now = time.time()
    spec.updated_at = max(now, math.nextafter(previous.updated_at, math.inf)) if previous else now
    if not spec.created_at:
        spec.created_at = spec.updated_at
    _write_json(path, spec.to_dict())


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_all() -> list[AgentSpec]:
    """Every agent, ordered by the registry's ``order`` list.

    Falls back to disk scan if the index is missing entries (defensive
    — e.g. if a user copies an agent folder in by hand).
    """
    with _lock:
        idx = _read_index()
        known = list(idx.get("order") or [])
        agents: list[AgentSpec] = []
        for aid in known:
            spec = _read_agent(aid)
            if spec is not None:
                agents.append(spec)
        # Disk scan for stragglers
        agents_root = _state_root() / "agents"
        for entry in agents_root.iterdir() if agents_root.is_dir() else []:
            if not entry.is_dir():
                continue
            if entry.name in known:
                continue
            spec = _read_agent(entry.name)
            if spec is not None:
                agents.append(spec)
        return agents


def get(agent_id: str) -> Optional[AgentSpec]:
    with _lock:
        return _read_agent(agent_id)


def get_default() -> Optional[AgentSpec]:
    """The agent marked as default. Returns ``None`` iff no agents
    exist yet (fresh install); callers should either run setup or
    return an error to the user.
    """
    with _lock:
        idx = _read_index()
        default_id = idx.get("default_id") or ""
        if default_id:
            spec = _read_agent(default_id)
            if spec is not None:
                return spec
        # Try DEFAULT_AGENT_ID, then first known agent.
        spec = _read_agent(DEFAULT_AGENT_ID)
        if spec is not None:
            return spec
        any_list = list_all()
        return any_list[0] if any_list else None


def create(
    agent_id: str,
    *,
    name: str = "",
    provider: str = "",
    model_id: str = "",
    thinking_effort: str | None = None,
    system_prompt: str = "",
    identity_name: str = "",
    mention_patterns: Optional[list[str]] = None,
    make_default: bool = False,
) -> AgentSpec:
    """Create a new agent. ``agent_id`` must match
    ``^[a-z][a-z0-9_-]{0,39}$``. Raises ``ValueError`` on bad id or
    if one already exists with that id.
    """
    if not _VALID_ID.match(agent_id):
        raise ValueError(
            f"Invalid agent id {agent_id!r} — must start with a letter "
            f"and contain only [a-z0-9_-], ≤40 chars."
        )
    with configuration_lock():
        if _read_agent(agent_id) is not None:
            raise ValueError(f"Agent {agent_id!r} already exists.")
        idx = _read_index()
        now = time.time()
        spec = AgentSpec(
            id=agent_id,
            name=name or agent_id.replace("_", " ").replace("-", " ").title(),
            default=make_default or not idx.get("default_id"),
            model=AgentModelRef(provider=provider, id=model_id),
            thinking_effort=thinking_effort if thinking_effort is not None else "medium",
            system_prompt=system_prompt,
            skills={"disabled": []},
            tools={"mode": "automatic"},
            identity=AgentIdentity(
                name=identity_name or name or agent_id,
                mention_patterns=list(mention_patterns or []),
            ),
            created_at=now,
            updated_at=now,
        )
        agent_dir(agent_id).mkdir(parents=True, exist_ok=True)
        sessions_dir(agent_id)
        workspace_dir(agent_id)
        # Seed AGENTS.md / SOUL.md / USER.md placeholders so the
        # persona pipeline has something to load on the first turn.
        _write_agent(spec)
        try:
            from openprogram.agent.management.workspace import bootstrap as _ws_bootstrap
            _ws_bootstrap(agent_id)
        except Exception:
            pass

        order = list(idx.get("order") or [])
        if agent_id not in order:
            order.append(agent_id)
        idx["order"] = order
        if make_default or not idx.get("default_id"):
            idx["default_id"] = agent_id
            # Ensure only this agent has default=True
            for other_id in order:
                if other_id == agent_id:
                    continue
                other = _read_agent(other_id)
                if other and other.default:
                    other.default = False
                    _write_agent(other)
        _write_index(idx)
        return spec


def create_from_name(name: str, *, provider: str = "",
                     model_id: str = "", thinking_effort: str | None = None) -> AgentSpec:
    """Create an agent whose internal id is derived from its display name."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    if not base or not base[0].isalpha():
        base = f"agent-{base}".rstrip("-")
    base = base[:40].rstrip("-") or "agent"
    agent_id = base
    suffix = 2
    while True:
        try:
            return create(agent_id, name=name,
                          provider=provider, model_id=model_id,
                          thinking_effort=thinking_effort)
        except ValueError:
            if _read_agent(agent_id) is None:
                raise
            tail = f"-{suffix}"
            agent_id = f"{base[:40 - len(tail)].rstrip('-')}{tail}"
            suffix += 1


def duplicate(agent_id: str, *, target_id: str = "", name: str = "") -> AgentSpec:
    """Copy one Agent's configuration without copying sessions."""
    if target_id and not _VALID_ID.match(target_id):
        raise ValueError(
            f"Invalid agent id {target_id!r} — must start with a letter "
            f"and contain only [a-z0-9_-], ≤40 chars."
        )
    with configuration_lock():
        source = _read_agent(agent_id)
        if source is None:
            raise AgentNotFound(agent_id)
        if target_id:
            candidate = target_id
            if _read_agent(candidate) is not None or agent_dir(candidate).exists():
                raise ValueError(f"Agent {candidate!r} already exists.")
        else:
            ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
            base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
            if not base or not base[0].isalpha():
                base = f"agent-{base}".rstrip("-")
            base = base[:40].rstrip("-") or "agent"
            candidate = base
            suffix = 2
            while _read_agent(candidate) is not None or agent_dir(candidate).exists():
                tail = f"-{suffix}"
                candidate = f"{base[:40 - len(tail)].rstrip('-')}{tail}"
                suffix += 1

        now = time.time()
        raw = source.to_dict()
        raw.update({
            "id": candidate,
            "name": name or candidate.replace("_", " ").replace("-", " ").title(),
            "default": False,
            "created_at": now,
            "updated_at": now,
            "memory_policy_epoch": 1,
        })
        spec = AgentSpec.from_dict(raw)
        folder = agent_dir(candidate)
        folder_created = False
        try:
            folder.mkdir(parents=True, exist_ok=False)
            folder_created = True
            sessions_dir(candidate)
            workspace_dir(candidate)
            _write_agent(spec)
            try:
                from openprogram.agent.management.workspace import bootstrap as _ws_bootstrap
                _ws_bootstrap(candidate)
            except Exception:
                pass
            idx = _read_index()
            order = list(idx.get("order") or [])
            order.append(candidate)
            idx["order"] = order
            _write_index(idx)
        except Exception:
            if folder_created:
                shutil.rmtree(folder, ignore_errors=True)
            raise
        return spec


def update(
    agent_id: str,
    patch: dict[str, Any],
    *,
    expected_revision: int | None = None,
    expected_updated_at: float | None = None,
    require_precondition: bool = False,
    replace_tool_policy: bool = False,
) -> AgentSpec:
    """Merge ``patch`` into an existing agent's spec and save.

    The patch uses the same shape as ``AgentSpec.to_dict()``. Fields
    not mentioned are preserved; nested dicts (model / identity / etc.)
    are merged recursively, not replaced. HTTP callers replace a complete
    tool policy and require a revision (or legacy timestamp). Comparison
    and the complete write share the cross-process registry writer lock.
    """
    if "memory_policy_epoch" in patch:
        raise ValueError("memory_policy_epoch is managed by configuration updates")
    with configuration_lock():
        spec = _read_agent(agent_id)
        if spec is None:
            raise AgentNotFound(agent_id)
        if require_precondition and expected_revision is None and expected_updated_at is None:
            raise AgentPreconditionRequired("expected_revision or updated_at is required")
        if (
            expected_revision is not None and expected_revision != spec.revision
            or expected_updated_at is not None and expected_updated_at != spec.updated_at
        ):
            raise AgentRevisionConflict(spec)
        if not patch:
            return spec
        raw = spec.to_dict()
        _deep_merge(raw, patch)
        if replace_tool_policy and "tools" in patch:
            raw["tools"] = dict(patch["tools"])
        raw["id"] = agent_id  # can't rename via update
        new_spec = AgentSpec.from_dict(raw)
        new_spec.memory_policy_epoch = spec.memory_policy_epoch + (new_spec.memory != spec.memory)
        _write_agent(new_spec)
        return new_spec


def replace_tools(agent_id: str, tools: dict[str, Any]) -> AgentSpec:
    """Replace one Agent's complete tool-access policy atomically."""
    return update(agent_id, {"tools": tools}, replace_tool_policy=True)


def delete(agent_id: str) -> None:
    """Remove an agent and everything under its folder (including
    sessions + workspace). Updates the default pointer if necessary.
    """
    with configuration_lock():
        spec = _read_agent(agent_id)
        if spec is None:
            return
        folder = agent_dir(agent_id)
        if folder.exists():
            shutil.rmtree(folder, ignore_errors=True)
        idx = _read_index()
        order = [a for a in (idx.get("order") or []) if a != agent_id]
        idx["order"] = order
        if idx.get("default_id") == agent_id:
            idx["default_id"] = order[0] if order else ""
            if order:
                next_spec = _read_agent(order[0])
                if next_spec is not None:
                    next_spec.default = True
                    _write_agent(next_spec)
        _write_index(idx)


def set_default(agent_id: str) -> AgentSpec:
    """Mark ``agent_id`` as the default agent; clear ``default=True``
    on all others. Raises ``AgentNotFound`` if the id isn't known.
    """
    with configuration_lock():
        spec = _read_agent(agent_id)
        if spec is None:
            raise AgentNotFound(agent_id)
        idx = _read_index()
        idx["default_id"] = agent_id
        _write_index(idx)
        for other in list_all():
            want_default = (other.id == agent_id)
            if other.default != want_default:
                other.default = want_default
                _write_agent(other)
        return get(agent_id) or spec


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> None:
    """Mutate ``base`` in place: dicts merge, everything else replaces."""
    for k, v in patch.items():
        if (isinstance(v, dict) and isinstance(base.get(k), dict)):
            _deep_merge(base[k], v)
        else:
            base[k] = v
