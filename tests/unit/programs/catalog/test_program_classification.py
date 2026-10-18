"""Classification contract for Vanilla / Agentic Function / Workflow."""

from __future__ import annotations

from pathlib import Path

import openprogram
from openprogram.programs._registry import PROGRAM_MODULES
from openprogram.webui.routes.catalog.programs import _called_agentic_primitives


PROGRAMS = Path(openprogram.__file__).resolve().parent / "programs"
WORKFLOW = PROGRAMS / "workflow"
TOOLS = PROGRAMS / "tools"

WORKFLOW_PLACEMENTS = {
    "browser": WORKFLOW / "browser",
    "docs_question": WORKFLOW / "docs_question",
    "security_review": WORKFLOW / "security_review",
    "goal": WORKFLOW / "goal",
    "research": WORKFLOW / "research",
}

# The former authoring tools are gone: workflows are written as files and
# checked with `openprogram workflows check`.
REMOVED_WORKFLOW_ENTRIES = (
    "search_workflows", "create_workflow", "revise_workflow",
    "resume_workflow", "auto_workflow",
)

FORBIDDEN_PRODUCT_DIRS = (
    "browser_agent",
    "docs_question",
    "security_review",
    "goal",
    "deep_work",
    "research",
    "interaction_demo",
    "llm_call_example",
    "word_count",
    "test_framework",
    "test_resume",
    "agentic_workflow",
)

INFRASTRUCTURE = {"ask_user", "json_parsing"}


def _module_path(mod_name: str) -> Path:
    parts = mod_name.split(".")
    pkg = WORKFLOW.joinpath(*parts, "__init__.py")
    simple = WORKFLOW.joinpath(*parts[:-1], f"{parts[-1]}.py") if len(parts) > 1 else WORKFLOW / f"{mod_name}.py"
    if pkg.is_file():
        return pkg
    return simple


def test_complex_capabilities_live_under_workflow_not_agentic_root():
    for name, path in WORKFLOW_PLACEMENTS.items():
        assert path.is_dir(), f"{name} must live under workflow/"
    for name in REMOVED_WORKFLOW_ENTRIES:
        assert not (WORKFLOW / f"{name}.py").exists(), name
        assert name not in PROGRAM_MODULES, name
    assert not (WORKFLOW / "authoring").exists()
    for name in FORBIDDEN_PRODUCT_DIRS:
        leftover = WORKFLOW / name
        if name not in WORKFLOW_PLACEMENTS:
            assert not leftover.exists(), f"{name} must not remain as a duplicate"


def test_builtin_workflows_declare_program_entries():
    import importlib

    for name in PROGRAM_MODULES:
        module = importlib.import_module(f"openprogram.programs.workflow.{name}")
        if name not in INFRASTRUCTURE:
            assert getattr(module, "PROGRAM_ENTRIES", None), name


def test_agentic_modules_do_not_register_demos():
    assert "interaction_demo" not in PROGRAM_MODULES
    assert "llm_call_example" not in PROGRAM_MODULES
    assert "word_count" not in PROGRAM_MODULES
    assert "test_framework" not in PROGRAM_MODULES
    assert "test_resume" not in PROGRAM_MODULES


def test_vanilla_callables_do_not_reach_model_primitives():
    for source in TOOLS.rglob("*.py"):
        if source.name.startswith("_") or "__pycache__" in source.parts:
            continue
        called, _warnings = _called_agentic_primitives(source)
        assert not called, f"{source.relative_to(TOOLS)} reached {sorted(called)}"


def test_registered_workflow_modules_have_source_files():
    for name in PROGRAM_MODULES:
        source = _module_path(name)
        assert source.is_file(), name


def test_first_party_shipped_skills_inventory_is_empty():
    skills_pkg = Path(openprogram.__file__).resolve().parent / "skills"
    shipped = [
        path for path in skills_pkg.rglob("SKILL.md")
        if "tests" not in path.parts
    ] if skills_pkg.is_dir() else []
    assert shipped == []


def test_no_workflow_decorator_or_second_runtime():
    root = Path(openprogram.__file__).resolve().parent
    hits = []
    for path in root.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if "@workflow" in text or "def call_workflow(" in text:
            hits.append(str(path.relative_to(root)))
    assert hits == []
    assert not (WORKFLOW / "runtime.py").exists()
    assert not (WORKFLOW / "legacy.py").exists()
