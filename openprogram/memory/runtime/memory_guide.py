"""``MEMORY.md``: the map of a memory workspace.

``core.md`` says what every session must know. ``MEMORY.md`` says where
everything else is: what each part of the workspace holds, which subjects
``topics/`` covers, and what has been active lately, so an agent knows when
a search is worth making and where to look.

The Runtime writes a first version when a workspace has none, generated from
the tree as it stands. After that the file belongs to the memory agents: the
writer and the organizer keep it current, in whatever shape serves best. It
is plain Markdown at the workspace root and carries no block IDs or evidence
footnotes. Every session sees it ahead of ``core.md``, cut to
``GUIDE_MAX_BYTES``.
"""
from __future__ import annotations

import re
from pathlib import Path

GUIDE_FILE = "MEMORY.md"
#: What reaches the prompt; the file itself may be longer.
GUIDE_MAX_BYTES = 6_000
#: Directory depth the generated map lists below ``topics/``.
_MAP_DEPTH = 3
_RECENT = 6

_LAYOUT = """\
## Layout

- `core.md` — what every session needs, always shown after this map. Rendered from `topics/core.md`.
- `topics/` — the organised memory: one file per person, project or recurring theme. A subject with parts of its own is a directory with `overview.md` and one file per part. Paragraphs end in a `^block-id` and cite footnotes that point at the conversation they came from.
- `sources/` — the conversations themselves, archived verbatim and never edited. Follow a footnote here to check what was actually said.
- `timeline/` — the same facts by date: a file per year, with month and day files below it, for "what happened when".
- `relations.json`, `recent_events.jsonl` — links between paragraphs and the latest changes.

Search with `memory_search` first; read the Topic file a hit points to for the surrounding facts."""


def _summary(path: Path) -> str:
    """The first sentence of a Topic file's first paragraph, without markup."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "[^", ">", "|", "-", "*")):
            continue
        line = re.sub(r"\[\^[^\]]+\]", "", line)
        line = re.sub(r"\s\^[A-Za-z0-9-]+\s*$", "", line)
        line = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", line)
        line = re.split(r"(?<=[。！？；])|(?<=[.!?;])(?=\s)", line, maxsplit=1)[0].strip()
        return line if len(line) <= 60 else line[:59] + "…"
    return ""


def _map_lines(directory: Path, root: Path, depth: int) -> list[str]:
    lines: list[str] = []
    indent = "  " * depth
    entries = sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name))
    for entry in entries:
        relative = entry.relative_to(root).as_posix()
        if entry.is_dir():
            overview = entry / "overview.md"
            note = _summary(overview) if overview.is_file() else ""
            lines.append(f"{indent}- `{relative}/`" + (f" — {note}" if note else ""))
            if depth + 1 < _MAP_DEPTH:
                lines.extend(_map_lines(entry, root, depth + 1))
        elif (entry.suffix == ".md" and entry.name != "overview.md"
              and entry != root / "topics" / "core.md"):
            note = _summary(entry)
            lines.append(f"{indent}- `{relative}`" + (f" — {note}" if note else ""))
    return lines


def _recent_lines(memory_dir: Path) -> list[str]:
    import json

    from ..markdown import parse_topic_tree

    events = memory_dir / "recent_events.jsonl"
    if not events.is_file():
        return []
    try:
        paths = {u.memory_id: u.topic_path for u in parse_topic_tree(memory_dir / "topics")}
    except Exception:
        return []
    seen: list[str] = []
    for raw in reversed(events.read_text(encoding="utf-8").splitlines()):
        try:
            event = json.loads(raw)
        except ValueError:
            continue
        topic = paths.get(event.get("memory_id", ""))
        if topic and topic != "core.md" and topic not in seen:
            seen.append(topic)
        if len(seen) >= _RECENT:
            break
    return [f"- `topics/{path}`" for path in seen]


def generate(memory_dir: Path) -> str:
    """A first ``MEMORY.md`` for the workspace as it stands."""
    memory_dir = Path(memory_dir)
    topics = memory_dir / "topics"
    parts = [
        "# Memory map",
        "What this memory holds and where to find it. Memory agents keep this "
        "file current; rewrite it whenever the structure or the current focus changes.",
        _LAYOUT,
    ]
    if topics.is_dir():
        subjects = _map_lines(topics, memory_dir, 0)
        if subjects:
            parts.append("## Subjects\n\n" + "\n".join(subjects))
    recent = _recent_lines(memory_dir)
    if recent:
        parts.append("## Recently active\n\n" + "\n".join(recent))
    return "\n\n".join(parts) + "\n"


def ensure(memory_dir: Path) -> bool:
    """Write the generated map when the workspace has none. True if written."""
    path = Path(memory_dir) / GUIDE_FILE
    if path.exists():
        return False
    path.write_text(generate(memory_dir), encoding="utf-8")
    return True


def prompt_text(memory_dir: Path) -> str:
    """The map as the prompt shows it, cut to ``GUIDE_MAX_BYTES``."""
    try:
        data = (Path(memory_dir) / GUIDE_FILE).read_bytes()
    except OSError:
        return ""
    text = data[:GUIDE_MAX_BYTES].decode("utf-8", errors="ignore").strip()
    if len(data) > GUIDE_MAX_BYTES:
        text += "\n… (MEMORY.md continues; read it for the rest)"
    return text
