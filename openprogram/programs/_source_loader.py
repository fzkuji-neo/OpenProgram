"""Definition-time call scopes for explicitly authorized Program sources."""
from __future__ import annotations

import ast
import importlib.machinery
import inspect


_CAPTURE_NAME = "__openprogram_managed_definition__"


class _Definitions(ast.NodeTransformer):
    def visit_FunctionDef(self, node):
        return self._function(node)

    def visit_AsyncFunctionDef(self, node):
        return self._function(node)

    def _function(self, node):
        # Yield in a nested definition does not make its parent a generator.
        class Yields(ast.NodeVisitor):
            found = False
            def visit_Yield(self, item):
                self.found = True
            visit_YieldFrom = visit_Yield
            def visit_FunctionDef(self, item):
                pass
            visit_AsyncFunctionDef = visit_FunctionDef
            def visit_Lambda(self, item):
                pass
        yields = Yields()
        for statement in node.body:
            yields.visit(statement)
        self.generic_visit(node)
        if not yields.found:
            node.decorator_list.insert(0, ast.copy_location(
                ast.Name(id=_CAPTURE_NAME, ctx=ast.Load()), node,
            ))
        return node


def compile_managed_source(source, filename):
    tree = _Definitions().visit(ast.parse(source, filename=filename))
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec", dont_inherit=True)


class ManagedSourceLoader(importlib.machinery.SourceFileLoader):
    """Transform only the source selected by the authorized source finder.

    Source is compiled on each import. A bytecode cache cannot bypass capture.
    Existing decorators execute in their original order, before capture.
    Generators retain normal Python behavior and do not create call scopes.
    """
    def get_code(self, fullname):
        source = self.get_data(self.path)
        return compile_managed_source(source, self.path)

    def exec_module(self, module):
        from openprogram.agentic_programming.call_scope import managed_function, capture_suspended
        # Keep the binding: nested definitions can execute after module import.
        module.__dict__[_CAPTURE_NAME] = managed_function
        token = capture_suspended.set(True)
        try:
            super().exec_module(module)
        finally:
            capture_suspended.reset(token)


def register_public_entries(module, entrypoint=None):
    """Adapt only explicitly exported functions to the existing tool registry."""
    from openprogram.agentic_programming.agent_method import wrap_agent_method, register_agent_method
    from openprogram.agentic_programming.call_scope import managed_function
    entries = list(getattr(module, "AGENTIC_FUNCTIONS", ()) or ())
    if entrypoint:
        entry = getattr(module, entrypoint, None)
        if entry is not None:
            entries.append(entry)
    replacements = {}
    for entry in entries:
        if getattr(entry, "_agent_tool", None) is not None:
            continue
        if not (inspect.isfunction(entry) or inspect.ismethod(entry)):
            # Existing legacy decorator objects register themselves.
            if getattr(entry, "_is_agentic", False):
                continue
            raise TypeError("Program entries must be Python functions or Agent methods")
        is_method = inspect.ismethod(entry)
        original = entry
        if not is_method and getattr(entry, "_is_managed_function", False):
            original = entry.__wrapped__
        if inspect.isgeneratorfunction(original) or inspect.isasyncgenfunction(original):
            raise TypeError("Program entries cannot be generator functions")
        if id(entry) not in replacements:
            metadata = getattr(entry, "__agentic_options__", {})
            if is_method:
                metadata = {**getattr(entry.__self__, "method_options", {}).get(entry.__name__, {}), **metadata}
            options = {"as_tool": True, **metadata}
            available_if = options.pop("available_if", None)
            available = True
            if available_if is not None:
                try:
                    available = bool(available_if())
                except Exception:
                    available = False
            execution_metadata = {key: value for key, value in metadata.items() if key != "available_if"}
            if entrypoint and entry is getattr(module, entrypoint, None):
                options.setdefault("name", entrypoint)
            # Agent methods already carry their scope and instance binding.
            if is_method or getattr(entry, "_is_agentic", False):
                wrapper = entry
            elif execution_metadata:
                wrapper = wrap_agent_method(original, options)
            else:
                wrapper = entry if getattr(entry, "_is_managed_function", False) else managed_function(original)
            if available:
                tool = register_agent_method(wrapper, options)
                if tool is not None:
                    tool._python_callable = wrapper
                if not is_method:
                    wrapper._agent_tool = tool
            replacements[id(entry)] = wrapper
    for name, value in list(vars(module).items()):
        if id(value) in replacements:
            setattr(module, name, replacements[id(value)])
    if hasattr(module, "AGENTIC_FUNCTIONS"):
        module.AGENTIC_FUNCTIONS = [replacements.get(id(fn), fn) for fn in entries[:len(module.AGENTIC_FUNCTIONS)]]


class ManagedSourceFinder:
    """Resolve exact approved packages and their own Python submodules."""
    def __init__(self):
        self.sources = {}

    def add(self, name, root, authorization=None):
        import os
        self.sources[name] = (os.path.realpath(root), authorization)

    def find_spec(self, fullname, path=None, target=None):
        import os
        import importlib.util
        package = next((name for name in self.sources
                        if fullname == name or fullname.startswith(name + ".")), None)
        if package is None:
            return None
        root, authorization = self.sources[package]
        if authorization is not None and not authorization():
            raise ModuleNotFoundError(f"Program source is no longer authorized: {fullname}")
        relative = fullname[len(package):].lstrip(".").split(".") if fullname != package else []
        base = os.path.join(root, *relative)
        filename = os.path.join(base, "__init__.py")
        is_package = os.path.isfile(filename)
        if not is_package:
            filename = base + ".py"
        if not os.path.isfile(filename):
            raise ModuleNotFoundError(f"Program module does not exist: {fullname}")
        if os.path.commonpath((os.path.realpath(filename), root)) != root:
            raise ModuleNotFoundError(f"Program module is outside its authorized source: {fullname}")
        return importlib.util.spec_from_file_location(
            fullname, filename, loader=ManagedSourceLoader(fullname, filename),
            submodule_search_locations=[base] if is_package else None,
        )


_program_source_finder = ManagedSourceFinder()


def install_program_source(package, root, authorization=None):
    """Install capture for a package selected by an authorized loader."""
    import sys
    _program_source_finder.add(package, root, authorization)
    if _program_source_finder not in sys.meta_path:
        sys.meta_path.insert(0, _program_source_finder)
