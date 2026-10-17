"""Computer use: read and operate application windows for the main Agent.

The tool itself lives in ``openprogram.programs.tools.system.computer_use``;
this package holds the platform backends and the pure helpers (key chord
parsing, Accessibility tree rendering and diffing) they share.
"""
from .keys import Chord, KeyNameError, modifier_flags, parse_chord
from .tree import Node, diff, render, signature

__all__ = ["Chord", "KeyNameError", "Node", "diff", "modifier_flags", "parse_chord", "render", "signature"]
