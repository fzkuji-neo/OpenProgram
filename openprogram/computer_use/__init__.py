"""Computer use: read and operate application windows for the main Agent.

The tool itself is the ``app`` target of ``openprogram.programs.tools.system.computer_use_agent``;
this package holds the platform backends and the pure helpers (key chord
parsing, Accessibility tree rendering, numbering and diffing) they share.
"""
from .keys import Chord, KeyNameError, modifier_flags, parse_chord
from .tree import Node, Snapshot, diff, number, render, signature, snapshot

__all__ = ["Chord", "KeyNameError", "Node", "Snapshot", "diff", "modifier_flags", "number", "parse_chord",
           "render", "signature", "snapshot"]
