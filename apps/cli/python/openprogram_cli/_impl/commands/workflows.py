"""Workflow package commands: check and list."""

from __future__ import annotations

import json
import sys


def _cmd_workflows_check(directory: str, *, message: str = "", as_json: bool = False) -> int:
    from openprogram.programs._workflow_check import CheckFailed, check_workflow

    try:
        report = check_workflow(directory, message=message)
    except CheckFailed as exc:
        report = exc.report
    except (OSError, RuntimeError, ValueError) as exc:
        report = {"ok": False, "problems": [f"{type(exc).__name__}: {exc}"]}
    if as_json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 0 if report.get("ok") else 1
    if not report.get("ok"):
        for problem in report.get("problems") or []:
            print(f"error: {problem}", file=sys.stderr)
        if report.get("traceback"):
            print(report["traceback"].rstrip(), file=sys.stderr)
        tests = report.get("tests") or {}
        if tests.get("ran") and not tests.get("passed"):
            print(tests.get("output", "").rstrip(), file=sys.stderr)
            print("Tests failed; nothing was committed.", file=sys.stderr)
        return 1
    tests = report.get("tests") or {}
    if tests.get("ran"):
        where = "in the OS sandbox" if tests.get("sandboxed") else "without a sandbox"
        print(f"Tests passed {where}.")
    else:
        print("No tests in tests/.")
    entries = ", ".join(report.get("entries") or [])
    action = "Committed" if report.get("committed") else "Already committed"
    print(f"{action} {report['workflow']} at {report['revision'][:12]}; entries: {entries}")
    return 0


def _cmd_workflows_list(*, as_json: bool = False) -> int:
    from openprogram.programs._workflow_packages import load_user_workflows, workflow_statuses, workflows_root

    load_user_workflows()
    rows = workflow_statuses()
    if as_json:
        print(json.dumps({"root": str(workflows_root()), "workflows": rows}, ensure_ascii=False, sort_keys=True))
        return 0
    if not rows:
        print(f"No workflows in {workflows_root()}")
        return 0
    for row in rows:
        detail = ", ".join(row["entries"]) or row["error"] or row["note"]
        print(f"{row['name']:<28} {row['state']:<8} {detail}")
        if row["entries"] and row["note"]:
            print(f"{'':<28} {'':<8} {row['note']}")
    return 0
