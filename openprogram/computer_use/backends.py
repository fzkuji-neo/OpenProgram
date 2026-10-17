"""The computer_use backend of this host: macOS, or Linux on X11."""
from __future__ import annotations

import platform
from typing import Any


def support() -> dict[str, Any]:
    """Whether this host can run computer_use, and why not."""
    system = platform.system()
    if system == "Darwin":
        from . import macos
        return macos.support()
    if system == "Linux":
        from . import linux
        return linux.support()
    return {"available": False, "reason": "computer_use supports macOS and Linux (X11)"}


def backend():
    """The process-wide backend for this host."""
    if platform.system() == "Linux":
        from . import linux
        state = linux.support()
        if not state["available"]:
            from .base import ComputerUseError
            raise ComputerUseError(state["reason"])
        return linux.backend()
    from . import macos
    return macos.backend()
