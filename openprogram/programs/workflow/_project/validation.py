"""Validate generated workflow code, package layout, imports, and metadata."""

from __future__ import annotations

import ast
import re
import traceback
from pathlib import Path

from ..errors import InvalidWorkflow

PROJECT_SCHEMA_VERSION = 1
PROJECT_RUNTIME_NAMES = {
    "llm",
    "agent",
    "agent_async",
    "Agent",
    "Context",
    "goal",
    "validate_and_retry",
    "route",
    "conditional",
    "agentic_function",
    "traced",
}


def _validate_project_metadata(
    value: object,
    *,
    require_package_name: bool = False,
) -> dict:
    if not isinstance(value, dict):
        raise InvalidWorkflow("project_metadata must be an object")
    name = str(value.get("name") or "").strip()
    summary = str(value.get("summary") or "").strip()
    tags = value.get("tags")
    if not name or len(name) > 120:
        raise InvalidWorkflow("project name must contain 1 to 120 characters")
    if require_package_name and not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", name):
        raise InvalidWorkflow("project name must be a lowercase Python identifier")
    if not summary or len(summary) > 500:
        raise InvalidWorkflow("project summary must contain 1 to 500 characters")
    if not isinstance(tags, list) or len(tags) > 20:
        raise InvalidWorkflow("project tags must be a list with at most 20 entries")
    clean_tags = []
    for tag in tags:
        text = str(tag).strip()
        if not text or len(text) > 60:
            raise InvalidWorkflow("each project tag must contain 1 to 60 characters")
        clean_tags.append(text)
    metadata = {"name": name, "summary": summary, "tags": clean_tags}
    if require_package_name:
        metadata["entrypoint"] = name
    return metadata


def _validate_legacy_project_path(value: object) -> str:
    raw = str(value or "")
    path = Path(raw)
    if (
        not raw
        or path.is_absolute()
        or ".." in path.parts
        or any(part in {"", "."} for part in path.parts)
        or path.suffix != ".py"
    ):
        raise InvalidWorkflow(f"invalid workflow project path: {raw!r}")
    normalized = path.as_posix()
    if normalized != "entry.py" and not normalized.startswith("steps/"):
        raise InvalidWorkflow(
            "workflow project Python files must be entry.py or under steps/"
        )
    return normalized


def _validate_legacy_project_candidate(
    value: object,
    *,
    allow_legacy_entry: bool = False,
) -> dict:
    if not isinstance(value, dict):
        raise InvalidWorkflow("workflow project reply must be an object")
    metadata = _validate_project_metadata(value.get("project_metadata"))
    readme = value.get("readme")
    files = value.get("files")
    if not isinstance(readme, str) or not readme.strip():
        raise InvalidWorkflow("workflow project readme must be non-empty Markdown")
    if not isinstance(files, dict) or not files:
        raise InvalidWorkflow("workflow project files must be a non-empty object")
    clean_files: dict[str, str] = {}
    workflow_count = 0
    function_names: set[str] = set()
    for raw_path, raw_source in files.items():
        path = _validate_legacy_project_path(raw_path)
        if path in clean_files:
            raise InvalidWorkflow(f"duplicate workflow project path: {path}")
        if not isinstance(raw_source, str):
            raise InvalidWorkflow(f"workflow project source must be text: {path}")
        try:
            tree = ast.parse(raw_source, filename=path)
        except SyntaxError as exc:
            detail = "".join(traceback.format_exception_only(type(exc), exc)).strip()
            raise InvalidWorkflow(detail) from exc
        if any(
            isinstance(node, (ast.Import, ast.ImportFrom)) for node in ast.walk(tree)
        ):
            raise InvalidWorkflow("workflow imports are forbidden")
        if any(isinstance(node, ast.ClassDef) for node in ast.walk(tree)):
            raise InvalidWorkflow("workflow classes are forbidden")
        for node in tree.body:
            if (
                isinstance(node, ast.Expr)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            ):
                continue
            if not isinstance(node, ast.FunctionDef):
                raise InvalidWorkflow(
                    f"workflow project top level may contain only functions: {path}"
                )
            if node.name in function_names:
                raise InvalidWorkflow(f"duplicate workflow function: {node.name}")
            if node.name in PROJECT_RUNTIME_NAMES:
                raise InvalidWorkflow(
                    f"workflow project cannot redefine managed function: {node.name}"
                )
            if node.decorator_list or node.args.defaults or any(node.args.kw_defaults):
                raise InvalidWorkflow(
                    f"workflow project functions cannot use decorators or defaults: {node.name}"
                )
            function_names.add(node.name)
            if node.name == "workflow":
                workflow_count += 1
                if path != "entry.py":
                    raise InvalidWorkflow("workflow() must be defined in entry.py")
                args = node.args
                legacy_entry = (
                    allow_legacy_entry
                    and not args.posonlyargs
                    and not args.args
                    and not args.kwonlyargs
                    and args.vararg is None
                    and args.kwarg is None
                )
                if not legacy_entry and (
                    args.posonlyargs
                    or len(args.args) != 1
                    or args.args[0].arg != "task"
                    or args.kwonlyargs
                    or args.vararg
                    or args.kwarg
                ):
                    raise InvalidWorkflow(
                        "workflow() must accept exactly one positional task argument"
                    )
        clean_files[path] = raw_source.rstrip() + "\n"
    if "entry.py" not in clean_files or workflow_count != 1:
        raise InvalidWorkflow(
            "workflow project must define exactly one def workflow() in entry.py"
        )
    if not any(path.startswith("steps/") for path in clean_files):
        raise InvalidWorkflow(
            "workflow project must contain at least one Python helper under steps/"
        )
    return {
        "project_metadata": metadata,
        "readme": readme.rstrip() + "\n",
        "files": clean_files,
    }


def _validate_package_path(value: object) -> str:
    raw = str(value or "")
    path = Path(raw)
    if (
        not raw
        or path.is_absolute()
        or ".." in path.parts
        or any(part in {"", "."} for part in path.parts)
        or path.suffix != ".py"
    ):
        raise InvalidWorkflow(f"invalid workflow project path: {raw!r}")
    normalized = path.as_posix()
    if normalized in {"__init__.py", "workflow.py", "tests/test_workflow.py"}:
        return normalized
    if len(path.parts) >= 2 and path.parts[0] in {"steps", "goals", "helpers"}:
        return normalized
    raise InvalidWorkflow(
        "workflow project Python files must be package modules, helpers, or tests"
    )


def _allowed_package_import(
    node: ast.ImportFrom,
    *,
    path: str,
    entrypoint: str,
) -> bool:
    if any(alias.name == "*" for alias in node.names):
        return False
    if node.level:
        package_depth = len(Path(path).parts) - 1
        return node.level <= package_depth + 1
    module = node.module or ""
    workflow_parts = module.split(".")
    workflow_import = (
        len(workflow_parts) == 2
        and workflow_parts[0] == "workflows"
        and re.fullmatch(r"[a-z][a-z0-9_]{0,79}", workflow_parts[1])
        and len(node.names) == 1
        and node.names[0].name == workflow_parts[1]
    )
    return (
        module == "openprogram"
        or module == "openprogram.context"
        or module == "openprogram.agentic_programming"
        or module.startswith("openprogram.agentic_programming.")
        or module.startswith("openprogram.programs.workflow.")
        or module.startswith("openprogram.programs.tools.")
        or workflow_import
        or (path.startswith("tests/") and module == f"workflows.{entrypoint}")
    )


def _decorator_name(node: ast.expr) -> str:
    if isinstance(node, ast.Call):
        node = node.func
    return node.id if isinstance(node, ast.Name) else ""


def _valid_dunder_all(node: ast.Assign) -> bool:
    if not (
        len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == "__all__"
        and isinstance(node.value, (ast.List, ast.Tuple))
    ):
        return False
    return all(
        isinstance(item, ast.Constant) and isinstance(item.value, str)
        for item in node.value.elts
    )


def _name_binders(tree: ast.Module, name: str) -> list[tuple[str, str, str]]:
    binders: list[tuple[str, str, str]] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
            binders.append(("function", "", node.name))
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if (alias.asname or alias.name) == name:
                    binders.append(
                        (f"import:{node.level}:{node.module or ''}", alias.name, name)
                    )
    return binders


def _agent_entry_method(node: ast.AST, tree: ast.Module, entrypoint: str):
    """Resolve an explicit export such as workflow = Researcher().run."""
    if (not isinstance(node, ast.Assign) or len(node.targets) != 1
            or not isinstance(node.targets[0], ast.Name)
            or node.targets[0].id != entrypoint
            or not isinstance(node.value, ast.Attribute)):
        return None
    constructor = node.value.value
    if (not isinstance(constructor, ast.Call) or constructor.args or constructor.keywords
            or not isinstance(constructor.func, ast.Name)):
        return None
    classes = [item for item in tree.body if isinstance(item, ast.ClassDef)
               and item.name == constructor.func.id]
    if len(classes) != 1:
        return None
    cls = classes[0]
    methods = [item for item in cls.body
               if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
               and item.name == node.value.attr and not item.decorator_list]
    if len(methods) != 1:
        return None
    return methods[0]


def _validate_agent_class(node: ast.ClassDef, tree: ast.Module, path: str) -> None:
    """Allow Agent declarations without arbitrary class creation at import time."""
    binding = _name_binders(tree, "Agent")
    if binding not in ([('import:0:openprogram', 'Agent', 'Agent')],
                       [('import:0:openprogram.agentic_programming', 'Agent', 'Agent')]):
        raise InvalidWorkflow(f"Agent must keep its OpenProgram import: {path}")
    if (node.decorator_list or node.keywords or len(node.bases) != 1
            or not isinstance(node.bases[0], ast.Name) or node.bases[0].id != "Agent"):
        raise InvalidWorkflow(f"Class {node.name} must inherit directly from Agent.")
    for member in node.body:
        if isinstance(member, ast.Expr) and isinstance(member.value, ast.Constant):
            if isinstance(member.value.value, str):
                continue
        if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if any(_decorator_name(item) not in {"staticmethod", "classmethod"}
                   for item in member.decorator_list):
                raise InvalidWorkflow(f"Agent method {member.name} has an unsupported decorator.")
            continue
        if isinstance(member, (ast.Assign, ast.AnnAssign)):
            value = member.value
            if value is None:
                continue
            # Class configuration must not execute arbitrary calls at import time.
            for part in ast.walk(value):
                if isinstance(part, ast.Call):
                    if not isinstance(part.func, ast.Name) or part.func.id != "Context":
                        raise InvalidWorkflow("Agent configuration only permits Context construction.")
                    if _name_binders(tree, "Context") not in (
                        [('import:0:openprogram', 'Context', 'Context')],
                        [('import:0:openprogram.context', 'Context', 'Context')],
                        [('import:0:openprogram.agentic_programming', 'Context', 'Context')],
                    ):
                        raise InvalidWorkflow("Context must keep its OpenProgram import.")
            continue
        raise InvalidWorkflow(f"Agent class {node.name} contains an unsupported statement.")


def _validate_project_candidate(
    value: object,
    *,
    allow_legacy_entry: bool = False,
) -> dict:
    if not isinstance(value, dict):
        raise InvalidWorkflow("workflow project reply must be an object")
    files = value.get("files")
    if allow_legacy_entry and isinstance(files, dict) and "entry.py" in files:
        return _validate_legacy_project_candidate(
            value,
            allow_legacy_entry=True,
        )
    metadata = _validate_project_metadata(
        value.get("project_metadata"),
        require_package_name=True,
    )
    readme = value.get("readme")
    if not isinstance(readme, str) or not readme.strip():
        raise InvalidWorkflow("workflow project readme must be non-empty Markdown")
    if not isinstance(files, dict) or not files:
        raise InvalidWorkflow("workflow project files must be a non-empty object")

    clean_files: dict[str, str] = {}
    trees: dict[str, ast.Module] = {}
    public_entries: list[tuple[str, str]] = []
    for raw_path, raw_source in files.items():
        path = _validate_package_path(raw_path)
        if path in clean_files:
            raise InvalidWorkflow(f"duplicate workflow project path: {path}")
        if not isinstance(raw_source, str):
            raise InvalidWorkflow(f"workflow project source must be text: {path}")
        try:
            tree = ast.parse(raw_source, filename=path)
        except SyntaxError as exc:
            detail = "".join(traceback.format_exception_only(type(exc), exc)).strip()
            raise InvalidWorkflow(detail) from exc
        for nested in ast.walk(tree):
            if isinstance(nested, ast.Import):
                raise InvalidWorkflow("workflow packages may not use import statements")
            if isinstance(nested, ast.ImportFrom) and nested not in tree.body:
                raise InvalidWorkflow("workflow package imports must be at module top level")
        for node in tree.body:
            if (
                isinstance(node, ast.Expr)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            ):
                continue
            if isinstance(node, ast.Import):
                raise InvalidWorkflow("workflow packages may not use import statements")
            if isinstance(node, ast.ImportFrom):
                if not _allowed_package_import(
                    node,
                    path=path,
                    entrypoint=metadata["entrypoint"],
                ):
                    raise InvalidWorkflow(
                        f"workflow package import is not allowed: {path}"
                    )
                continue
            if isinstance(node, ast.Assign):
                if _valid_dunder_all(node):
                    continue
                if path == "workflow.py" and _agent_entry_method(node, tree, metadata["entrypoint"]) is not None:
                    continue
                if any(
                    isinstance(target, ast.Name) and target.id == "__all__"
                    for target in node.targets
                ):
                    raise InvalidWorkflow(
                        "workflow package __all__ must be a string literal list or tuple"
                    )
            if isinstance(node, ast.ClassDef):
                _validate_agent_class(node, tree, path)
                continue
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                raise InvalidWorkflow(
                    f"workflow package top level must contain imports, functions, or Agent classes: {path}"
                )
            if node.name in PROJECT_RUNTIME_NAMES:
                raise InvalidWorkflow(
                    f"workflow project cannot redefine managed function: {node.name}"
                )
            decorators = [_decorator_name(item) for item in node.decorator_list]
            if any(name not in {"agentic_function", "traced"} for name in decorators):
                raise InvalidWorkflow(
                    f"workflow function uses an unsupported decorator: {node.name}"
                )
            if any(
                isinstance(item, ast.Call)
                and any(keyword.arg == "name" for keyword in item.keywords)
                for item in node.decorator_list
            ):
                raise InvalidWorkflow(
                    "workflow package decorators may not override function names"
                )
            if "agentic_function" in decorators:
                public_entries.append((path, node.name))
        clean_files[path] = raw_source.rstrip() + "\n"
        trees[path] = tree

    required = {"__init__.py", "workflow.py", "tests/test_workflow.py"}
    missing = sorted(required - clean_files.keys())
    if missing:
        raise InvalidWorkflow(
            "workflow package is missing required files: " + ", ".join(missing)
        )
    helpers = [
        path
        for path in clean_files
        if path.startswith(("steps/", "goals/", "helpers/"))
        and not path.endswith("/__init__.py")
    ]
    if not helpers:
        raise InvalidWorkflow(
            "workflow package must contain at least one helper module"
        )

    for path, tree in trees.items():
        used_decorators = {
            name
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            for item in node.decorator_list
            if (name := _decorator_name(item)) in {"agentic_function", "traced"}
        }
        for decorator in used_decorators:
            binders = _name_binders(tree, decorator)
            if len(binders) != 1 or not (
                binders[0][0].startswith("import:0:openprogram.agentic_programming")
                and binders[0][1:] == (decorator, decorator)
            ):
                raise InvalidWorkflow(
                    f"workflow package decorator {decorator} must keep its "
                    f"OpenProgram binding: {path}"
                )

    entrypoint = metadata["entrypoint"]
    entries = [
        node
        for node in trees["workflow.py"].body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == entrypoint
    ]
    bound_entries = [method for node in trees["workflow.py"].body
                     if (method := _agent_entry_method(node, trees["workflow.py"], entrypoint)) is not None]
    if len(entries) + len(bound_entries) != 1:
        raise InvalidWorkflow(f"workflow.py must define one {entrypoint} entry.")
    entry = entries[0] if entries else bound_entries[0]
    if public_entries and public_entries != [("workflow.py", entrypoint)]:
        raise InvalidWorkflow(
            f"Only workflow.py:{entrypoint} may register a public function."
        )
    args = entry.args
    positional = args.args[1:] if bound_entries else args.args
    if (
        args.posonlyargs
        or (bound_entries and (not args.args or args.args[0].arg != "self"))
        or len(positional) != 1
        or positional[0].arg != "task"
        or args.kwonlyargs
        or args.vararg
        or args.kwarg
    ):
        raise InvalidWorkflow(
            f"{entrypoint}() must accept exactly one positional task argument"
        )
    entrypoint_binders = _name_binders(trees["__init__.py"], entrypoint)
    expected_binder = ("import:1:workflow", entrypoint, entrypoint)
    if entrypoint_binders != [expected_binder]:
        raise InvalidWorkflow(
            f"__init__.py must export {entrypoint} from .workflow without shadowing"
        )
    return {
        "project_metadata": metadata,
        "readme": readme.rstrip() + "\n",
        "files": clean_files,
    }


def validate_workflow_candidate(
    value: object,
    *,
    allow_legacy_entry: bool = False,
) -> dict:
    """Validate one in-memory Workflow candidate without executing its code."""
    return _validate_project_candidate(
        value,
        allow_legacy_entry=allow_legacy_entry,
    )


def validate_workflow_directory(directory: str | Path) -> dict:
    """Validate one authored Workflow package directory without writing it."""
    root = Path(directory).expanduser()
    if root.is_symlink():
        raise InvalidWorkflow("workflow project directory must not be a symlink")
    if not root.is_dir():
        raise InvalidWorkflow(f"workflow project directory does not exist: {root}")

    from . import repository

    candidate = repository._read_repository_candidate(
        root,
        expected_project_id=root.name,
    )
    metadata = candidate["project_metadata"]
    return {
        "ok": True,
        "workflow_id": metadata["entrypoint"],
        "metadata": metadata,
        "files": sorted(candidate["files"]),
        "executed_tests": False,
    }
