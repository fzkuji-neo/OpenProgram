"""Render an Accessibility tree as indexed text, and diff two renderings.

Each element becomes one line: its index, role, label and state. The
model refers back to an element by that index. After an action the tool
returns only the lines that changed since the previous state of the same
window, the way Codex's ``get_app_state`` does, unless the change is so
large that the full tree is shorter to read.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import difflib
import re

# Roles whose unnamed instances only group other elements. They are
# skipped and their children take their place in the tree.
TRANSPARENT_ROLES = frozenset({"AXGroup", "AXUnknown", "AXLayoutArea", "AXSplitGroup", "AXLayoutItem"})

# Actions every element of a role performs by being clicked. They are
# implied by ``click`` and left out of the secondary action list.
PRIMARY_ACTIONS = frozenset({"AXPress", "AXConfirm"})

MAX_TEXT = 160


def role_name(role: str, subrole: str = "") -> str:
    """``AXTextField`` -> ``text field``; a subrole is appended in parentheses."""
    def words(value: str) -> str:
        value = value[2:] if value.startswith("AX") else value
        return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value).lower() or "element"
    name = words(role or "AXUnknown")
    if subrole and subrole not in {"AXUnknown"}:
        sub = words(subrole)
        if sub != name:
            name = f"{name} ({sub})"
    return name


def _clip(value: str, limit: int = MAX_TEXT) -> str:
    value = " ".join(str(value).split())
    return value if len(value) <= limit else value[: limit - 1] + "…"


def _quote(value: str) -> str:
    return '"' + _clip(value).replace('"', '\\"') + '"'


@dataclass
class Node:
    role: str
    depth: int
    subrole: str = ""
    label: str = ""
    value: str = ""
    placeholder: str = ""
    flags: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    index: int = -1

    def body(self) -> str:
        """The line without its index, which is what a diff compares."""
        parts = [role_name(self.role, self.subrole)]
        if self.label:
            parts.append(_quote(self.label))
        if self.value and self.value != self.label:
            parts.append("value=" + _quote(self.value))
        if self.placeholder and not self.value:
            parts.append("placeholder=" + _quote(self.placeholder))
        if self.flags:
            parts.append("[" + ", ".join(self.flags) + "]")
        secondary = [a for a in self.actions if a not in PRIMARY_ACTIONS]
        if secondary:
            parts.append("actions: " + ", ".join(secondary))
        return " ".join(parts)

    def line(self) -> str:
        return "  " * self.depth + f"{self.index} " + self.body()

    def key(self) -> str:
        return "  " * self.depth + self.body()


def render(nodes: list[Node]) -> str:
    return "\n".join(node.line() for node in nodes)


def signature(nodes: list[Node]) -> list[str]:
    """Index-free lines, stored to diff the next state against."""
    return [node.key() for node in nodes]


def diff(previous: list[str] | None, nodes: list[Node]) -> tuple[str, bool]:
    """Return ``(text, is_diff)``.

    ``previous`` is the :func:`signature` of the last state. Lines that are
    new or changed carry a ``+`` and their new index; removed lines carry a
    ``-`` and no index, since they can no longer be addressed.
    """
    if previous is None:
        return render(nodes), False
    current = signature(nodes)
    matcher = difflib.SequenceMatcher(a=previous, b=current, autojunk=False)
    out: list[str] = []
    changed = 0
    for op, a0, a1, b0, b1 in matcher.get_opcodes():
        if op == "equal":
            continue
        for line in previous[a0:a1]:
            out.append("- " + line.strip())
            changed += 1
        for node in nodes[b0:b1]:
            out.append("+ " + node.line().strip())
            changed += 1
    if not out:
        return "(no changes in the Accessibility tree)", True
    if changed >= max(12, len(current) // 2):
        return render(nodes), False
    return "\n".join(out), True
