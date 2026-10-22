"""Load built-in workflows, user workflows and owner-authorized harnesses.

Workflows are plain Python packages: only their ``PROGRAM_ENTRIES`` register
as tools, and plain functions are not recorded. Installed catalogue packages
and owner-recorded harnesses capture only their selected source roots;
Python dependencies and adjacent packages retain normal import behavior.
"""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import logging
import os
import re
import sys
from typing import Iterator, Optional


logger = logging.getLogger(__name__)


PROGRAM_MODULES: list[str] = [
    # Library: ask the human during an execution. Exposes no tools.
    "ask_user",
    "document",
    "text",
    "browser",
    "docs_question",
    "security_review",
    "goal",
]


# Names that should never be treated as external harnesses even if their
# directory looks like one (e.g. internal package private dirs).
_NOT_A_HARNESS = {
    "__pycache__", "pdf_layout", "document", "text", "workflow",
}


def load_program_modules(
    programs_dir: str,
    applications_dir: str | None = None,
) -> None:
    """Import the built-in workflows, the user workflows, then installed and
    owner-recorded external harnesses.

    Built-in and user workflows are plain Python packages; their
    ``PROGRAM_ENTRIES`` register as tools. Failures are swallowed per entry
    so one broken package doesn't kill the whole import. Set
    ``OPENPROGRAM_DEBUG_REGISTRY=1`` to surface swallowed errors.
    """
    from openprogram.programs._workflow_packages import register_workflow_entries

    # 1. Built-in workflows.
    for mod_name in PROGRAM_MODULES:
        try:
            module = importlib.import_module(f"openprogram.programs.workflow.{mod_name}")
            if hasattr(module, "PROGRAM_ENTRIES"):
                register_workflow_entries(module, owner=f"builtin:{mod_name}")
        except Exception as e:
            _debug_registry_error(mod_name, e)
            continue

    # 2. User workflow packages in ~/.openprogram/workflows/.
    try:
        from openprogram.programs._workflow_packages import load_user_workflows
        load_user_workflows()
    except Exception as e:
        _debug_registry_error("workflows", e)

    # 3. First-party *programs* — the agentic harnesses shipped as
    #    separate pip-installable packages (gui_harness / research_harness).
    #    Importing an installed package fires its
    #    explicit exports register the entry point.
    #    Absent packages are skipped silently — this is the supported way
    #    to ship research_agent, replacing the
    #    old per-machine symlinks under agentics/. See functions/_programs.py.
    try:
        from openprogram.programs._programs import import_installed_programs
        import_installed_programs()
    except Exception as e:
        _debug_registry_error("programs", e)

    # 4. Auto-discovered external harnesses (owner-recorded directories or
    #    local-dev symlinks in applications_dir). Still supported for the
    #    ``<pkg>/agentics/__init__.py`` convention, but no longer the
    #    primary path — a developer working on a harness locally can just
    #    ``pip install -e`` their checkout and it registers via (3) above.
    if applications_dir is None:
        try:
            from openprogram.programs._programs import applications_dir as _root
            applications_dir = _root()
        except Exception:
            applications_dir = None
    for harness_name, harness_root in _iter_external_harness_dirs(
        applications_dir or ""
    ):
        try:
            from openprogram.programs._programs import (
                owner_controlled_program_sources,
            )
            source = next(
                (row for row in owner_controlled_program_sources(applications_dir)
                 if row["path"] == harness_root),
                {},
            )
            logger.info(
                "loading owner-controlled agentic program path=%s source=%s",
                harness_root,
                source.get("source", "unknown"),
            )
            _import_external_harness(harness_root)
        except Exception as e:
            _debug_registry_error(f"external:{harness_name}", e)
            continue


def _iter_external_harness_dirs(applications_dir: str) -> Iterator[tuple[str, str]]:
    """Yield ``(name, real_path)`` for every entry under ``applications_dir``
    that we treat as an external harness — i.e. a third-party agentic
    program dropped in here, whether as a **real directory** (the normal
    case: ``git clone`` into ``agentics/<name>/``) or a symlink (the
    local-dev case: ``ln -s`` your checkout).

    Accepting real directories is what makes "install a third-party
    harness = clone it into agentics/, done" work without symlinks
    (symlinks need admin/developer mode on Windows). A hyphenated name
    like ``Research-Agent-Harness`` is the canonical shape — Python can't
    import it directly, so the PROGRAM_MODULES loop ignores it, but this
    loop picks it up via its inner Python package (see
    :func:`_find_python_package`).

    Skips: dotfiles, the ``_NOT_A_HARNESS`` set (internal private dirs),
    plain ``.py`` files (single-module agentics, loaded elsewhere), and
    the official first-party programs — those are loaded explicitly by
    ``_programs.import_installed_programs`` (step 2 of
    :func:`load_program_modules`), so re-discovering their clone dirs
    here would import them a second time.
    """
    if not os.path.isdir(applications_dir):
        return
    from openprogram.programs._programs import owner_controlled_program_sources
    skip = set(_NOT_A_HARNESS) | _official_program_dir_names()
    for row in sorted(
        owner_controlled_program_sources(applications_dir),
        key=lambda item: os.path.basename(item["path"]),
    ):
        name = os.path.basename(row["path"])
        if name in skip or name.startswith("."):
            continue
        target = row["path"]
        if not os.path.isdir(target):
            continue
        yield name, target


def _official_program_dir_names() -> set[str]:
    """Clone-dir names of the first-party programs (GUI-Agent-Harness …),
    which ``_programs`` already imports — so auto-discovery skips them to
    avoid a double import. Best-effort: empty set if the catalogue can't
    be read."""
    try:
        from openprogram.programs._programs import KNOWN_PROGRAMS
        return {p.package for p in KNOWN_PROGRAMS}
    except Exception:
        return set()


def _find_python_package(harness_root: str) -> Optional[str]:
    """Locate the harness's agentic-exposing Python package directory.

    The convention is: the harness exposes itself via
    ``<pkg>/agentics/__init__.py``. We look for any ascii-identifier
    subdirectory under ``harness_root`` that contains both an
    ``__init__.py`` and an ``agentics/__init__.py``. That uniquely
    identifies the "main" package even when the harness root also
    contains vendored dependencies that happen to be Python packages
    (e.g. GUI harness ships ``desktop_env/`` alongside ``gui_harness/``).

    Falls back to the harness root itself when the harness IS the
    package and has agentics directly inside.
    """
    # case 1: harness root is itself a python package with agentics/
    if (os.path.isfile(os.path.join(harness_root, "__init__.py"))
            and os.path.isfile(os.path.join(
                harness_root, "agentics", "__init__.py"))):
        return harness_root

    # case 2: one of the children is the agentic-exposing package
    try:
        children = os.listdir(harness_root)
    except OSError:
        return None
    for child in sorted(children):
        if child.startswith((".", "_")):
            continue
        if not child.isidentifier():
            continue
        child_path = os.path.join(harness_root, child)
        if (os.path.isdir(child_path)
                and os.path.isfile(os.path.join(child_path, "__init__.py"))
                and os.path.isfile(os.path.join(
                    child_path, "agentics", "__init__.py"))):
            return child_path
    return None


def _import_external_harness(harness_root: str) -> None:
    """Capture the authorized package and register PROGRAM_ENTRIES exports."""

    pkg_dir = _find_python_package(harness_root)
    if pkg_dir is None:
        return

    agentics_init = os.path.join(pkg_dir, "agentics", "__init__.py")
    if not os.path.isfile(agentics_init):
        return  # harness exists but doesn't expose any agentics — fine

    # Put the harness's package root on sys.path so its internal absolute
    # imports (e.g. ``from research_harness.foo import bar``) resolve.
    sys_path_root = os.path.dirname(pkg_dir)
    if sys_path_root not in sys.path:
        sys.path.insert(0, sys_path_root)

    pkg_name = os.path.basename(pkg_dir)
    from openprogram.programs._source_loader import install_program_source, register_public_entries
    from openprogram.programs._programs import is_owner_controlled_program_path
    install_program_source(pkg_name, pkg_dir,
                           lambda: is_owner_controlled_program_path(pkg_dir))
    module = importlib.import_module(f"{pkg_name}.agentics")
    register_public_entries(module, require_exports=True)


# ---------------------------------------------------------------------------
# Single-file loader — the WebUI hot-reload path for external harness sources
# ---------------------------------------------------------------------------


def _load_external_file(
    agentics_dir: str, mod_name: str, rel_path: str
) -> None:
    """Import one file as ``agentics.<mod_name>``.

    Used by the WebUI function loader to re-execute an external
    harness's source file so an edit the user just made takes effect
    without a restart. The path must be owner-recorded.
    """
    abs_path = os.path.join(agentics_dir, rel_path)
    if not os.path.isfile(abs_path):
        return
    from openprogram.programs._programs import is_owner_controlled_program_path
    if not is_owner_controlled_program_path(abs_path):
        raise PermissionError(
            f"refusing to import unrecorded agentic source: {abs_path}"
        )

    inner_pkg_dir = os.path.dirname(abs_path)
    sys_path_root = os.path.dirname(inner_pkg_dir)
    if sys_path_root not in sys.path:
        sys.path.insert(0, sys_path_root)

    slug = re.sub(r"[^A-Za-z0-9_]", "_", mod_name).strip("_") or "mod"
    digest = hashlib.sha256(os.path.realpath(abs_path).encode()).hexdigest()[:12]
    full_mod = f"openprogram.programs._external.{slug}_{digest}"
    from openprogram.programs._source_loader import ManagedSourceLoader, register_public_entries
    spec = importlib.util.spec_from_file_location(
        full_mod, abs_path, loader=ManagedSourceLoader(full_mod, abs_path),
    )
    if spec is None or spec.loader is None:
        return
    module = importlib.util.module_from_spec(spec)
    sys.modules[full_mod] = module
    spec.loader.exec_module(module)
    register_public_entries(module, mod_name)
    # WebUI `_load_function` still looks up workflow.{mod_name}. Alias
    # only when that key is free or already this same file — never clobber
    # a builtin like workflow.browser / goal / text.
    legacy = f"openprogram.programs.workflow.{mod_name}"
    existing = sys.modules.get(legacy)
    existing_file = getattr(existing, "__file__", None) if existing else None
    if existing is None or (
        existing_file
        and os.path.realpath(existing_file) == os.path.realpath(abs_path)
    ):
        sys.modules[legacy] = module


# ---------------------------------------------------------------------------
# Enumeration for WebUI / CLI listing
# ---------------------------------------------------------------------------


def iter_program_files(
    programs_dir: str,
    applications_dir: str | None = None,
) -> Iterator[tuple[str, str, bool]]:
    """Yield ``(module_name, file_path, is_harness)`` for every loadable
    agentic — used by the WebUI function browser and ``programs list``.

    - Internal entries: ``module_name`` is the PROGRAM_MODULES name;
      ``file_path`` is the on-disk ``.py``.
    - External harnesses: ``module_name`` is the harness's inner Python
      package name; ``file_path`` is its ``agentics/__init__.py``.

    Entries whose file is missing on this machine are silently skipped.
    """
    # Internal explicit list
    for mod_name in PROGRAM_MODULES:
        parts = mod_name.split(".")
        simple = os.path.join(programs_dir, *parts[:-1], f"{parts[-1]}.py") if len(parts) > 1 else os.path.join(programs_dir, f"{mod_name}.py")
        pkg = os.path.join(programs_dir, *parts, "__init__.py")
        if os.path.isfile(simple):
            yield mod_name, simple, False
        elif os.path.isfile(pkg):
            named = os.path.join(programs_dir, *parts, f"{parts[-1]}.py")
            workflow_py = os.path.join(programs_dir, *parts, "workflow.py")
            if os.path.isfile(named):
                yield mod_name, named, False
            elif os.path.isfile(workflow_py):
                yield mod_name, workflow_py, False
            else:
                yield mod_name, pkg, False

    # Auto-discovered external harnesses — yield the actual source file
    # of every function listed in PROGRAM_ENTRIES, so the WebUI scanner
    # can inspect the public source and method metadata.
    import inspect as _inspect
    if applications_dir is None:
        try:
            from openprogram.programs._programs import applications_dir as _root
            applications_dir = _root()
        except Exception:
            applications_dir = None
    for _name, harness_root in _iter_external_harness_dirs(applications_dir or ""):
        pkg_dir = _find_python_package(harness_root)
        if pkg_dir is None:
            continue
        agentics_init = os.path.join(pkg_dir, "agentics", "__init__.py")
        if not os.path.isfile(agentics_init):
            continue
        # Make sure the harness package is importable, then read its
        # PROGRAM_ENTRIES export.
        sys_path_root = os.path.dirname(pkg_dir)
        if sys_path_root not in sys.path:
            sys.path.insert(0, sys_path_root)
        pkg_name = os.path.basename(pkg_dir)
        try:
            mod = importlib.import_module(f"{pkg_name}.agentics")
        except Exception as e:
            _debug_registry_error(f"iter:{pkg_name}", e)
            continue
        for fn in getattr(mod, "PROGRAM_ENTRIES", []) or []:
            inner = _inspect.unwrap(fn)
            try:
                src_file = _inspect.getsourcefile(inner)
            except (TypeError, OSError):
                src_file = None
            name = getattr(fn, "__name__", None) or getattr(inner, "__name__", "")
            if src_file and os.path.isfile(src_file) and name:
                yield name, src_file, True


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _debug_registry_error(name: str, e: Exception) -> None:
    logger.warning("Cannot load Program %s: %s", name, e)
    if os.environ.get("OPENPROGRAM_DEBUG_REGISTRY"):
        import traceback
        print(f"[registry] failed to load {name}: "
              f"{type(e).__name__}: {e}")
        traceback.print_exc()


# ---------------------------------------------------------------------------
# Rescan — re-run discovery to pick up newly-installed harnesses at runtime
# ---------------------------------------------------------------------------


def _default_programs_dir() -> Optional[str]:
    """The live ``programs/workflow/`` directory, or None if it can't be
    located. Used as :func:`rescan`'s default scan root."""
    try:
        import openprogram.programs.workflow as _workflow
        return os.path.dirname(_workflow.__file__)
    except Exception:
        return None


def rescan(applications_dir: Optional[str] = None) -> dict:
    """Re-run agentic discovery to pick up harnesses installed since boot.

    This is the single core both the manual "refresh" button and the
    background watcher call. It re-invokes :func:`load_program_modules`,
    which is idempotent — already-imported modules are skipped by Python's
    module cache. A newly-present harness is imported and its public entries
    register through the shared tool registry. The new functions are
    immediately live for the agent and visible to ``/api/functions``.

    Returns ``{"added": [tool_label, ...], "total": <count>}`` — ``added``
    lists tools that appeared this pass (the watcher / endpoint only
    broadcast when it's non-empty).

    Caveat (documented, intentional): only **additions** are reliable.
    Removing or hot-swapping a harness needs a worker restart — Python's
    module cache means an unimported / changed module isn't re-evaluated,
    and tearing down a live registry entry is unsafe. So ``rescan`` never
    *removes* tools; it only ever adds.
    """
    from openprogram.programs._runtime import all_tools
    scan_dir = _default_programs_dir()
    before = {t.label for t in all_tools()}
    if scan_dir:
        load_program_modules(scan_dir, applications_dir)
    after_tools = all_tools()
    after = {t.label for t in after_tools}
    return {"added": sorted(after - before), "total": len(after_tools)}
