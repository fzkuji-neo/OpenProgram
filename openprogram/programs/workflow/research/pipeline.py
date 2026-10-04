"""
pipeline — main research workflow orchestrator.

Chains all stages: init → literature → idea → experiment →
analysis → writing → review → submission.

Each stage can run independently. Supports starting from any stage.

Usage:
    from openprogram.programs.workflow.research.pipeline import research_pipeline

    # Full pipeline
    result = research_pipeline(
        project_dir="~/research/LLM Uncertainty",
        topic="Uncertainty quantification in LLMs",
        venue="NeurIPS",
        exec_runtime=claude_runtime,
        review_runtime=gpt_runtime,
    )

    # Just writing + review
    result = research_pipeline(
        project_dir="~/research/LLM Uncertainty",
        stages=["writing", "review"],
        exec_runtime=claude_runtime,
    )
"""

from __future__ import annotations

import os
from typing import Optional

from openprogram.agentic_programming.call_state import _current_runtime, check_cancelled
from openprogram.agentic_programming.runtime import Runtime
from ._paths import expanded_project_dir, read_artifact, write_artifact


STAGES = [
    "init", "literature", "idea", "experiment",
    "analysis", "writing", "review", "submission",
]


def research_pipeline(
    project_dir: str,
    topic: str = None,
    venue: str = None,
    stages: list[str] = None,
    start_from: str = None,
    exec_runtime: Runtime = None,
    review_runtime: Runtime = None,
    callback: Optional[callable] = None,
) -> dict:
    """Run the research pipeline.

    Args:
        project_dir:     Path to research project directory.
        topic:           Research topic (needed for literature/idea stages).
        venue:           Target venue (e.g. "NeurIPS").
        stages:          Specific stages to run (default: all).
        start_from:      Start from this stage.
        exec_runtime:    Runtime for execution tasks.
        review_runtime:  Runtime for review (different model recommended).
        callback:        Progress callback.

    Returns:
        dict with results from each completed stage.
    """
    if exec_runtime is None:
        raise ValueError("exec_runtime is required")

    project_dir = str(expanded_project_dir(project_dir))

    # Determine stages to run
    if stages is not None:
        unknown = [s for s in stages if s not in STAGES]
        if unknown:
            raise ValueError(f"Unknown research stages: {unknown}")
        run_stages = list(stages)
    elif start_from is not None:
        idx = STAGES.index(start_from)
        run_stages = STAGES[idx:]
    else:
        run_stages = STAGES

    results = {}
    handlers = {
        "init": lambda: _stage_init(project_dir, venue),
        "literature": lambda: _stage_literature(project_dir, topic, exec_runtime),
        "idea": lambda: _stage_idea(project_dir, topic, exec_runtime),
        "experiment": lambda: _stage_experiment(project_dir, exec_runtime),
        "analysis": lambda: _stage_analysis(project_dir, exec_runtime),
        "writing": lambda: _stage_writing(project_dir, exec_runtime),
        "review": lambda: _stage_review(project_dir, venue, exec_runtime, review_runtime, callback),
        "submission": lambda: _stage_submission(project_dir, venue, exec_runtime),
    }

    for stage in run_stages:
        check_cancelled()
        if callback:
            callback({"type": "stage_start", "stage": stage})

        handler = handlers.get(stage)
        if handler:
            results[stage] = handler()

        if callback:
            callback({"type": "stage_done", "stage": stage, "result": results.get(stage)})
        # A generated experiment plan is not executed experimental evidence.
        if stage == "experiment" and results[stage].get("status") == "planned":
            break

    return results


# ---------------------------------------------------------------------------
# Stage handlers
# ---------------------------------------------------------------------------

def _stage_init(project_dir, venue):
    """Initialise a research project directory inline.

    Directory creation is inlined here (was previously a thin shim
    over an ``init_research`` helper that's been removed).
    """
    from pathlib import Path
    from openprogram.sandbox import validate_write_path
    target = Path(project_dir)
    violation = validate_write_path(str(target))
    if violation:
        raise ValueError(f"sandbox policy: {violation}")
    existed = target.exists()
    for name in ("notes", "sources", "drafts", "paper", "experiments", "related_work"):
        child = target / name
        violation = validate_write_path(str(child))
        if violation:
            raise ValueError(f"sandbox policy: {violation}")
        child.mkdir(parents=True, exist_ok=True)
    return {"status": "exists" if existed else "created", "path": str(target)}


def _stage_literature(project_dir, topic, runtime):
    from openprogram.programs.workflow.research.stages.literature import run_literature
    if not topic:
        return {"status": "skipped", "reason": "no topic provided"}
    return run_literature(topic=topic, project_dir=project_dir, runtime=runtime)


def _stage_idea(project_dir, topic, runtime):
    from openprogram.programs.workflow.research.stages.idea import run_idea
    if not topic:
        return {"status": "skipped", "reason": "no topic provided"}
    return run_idea(topic=topic, project_dir=project_dir, runtime=runtime)


def _stage_experiment(project_dir, runtime):
    from openprogram.programs.workflow.research.stages.experiment import run_experiments
    return run_experiments(project_dir=project_dir, runtime=runtime)


def _stage_analysis(project_dir, runtime):
    from openprogram.programs.workflow.research.stages.writing import analyze_results
    exp_dir = os.path.join(project_dir, "experiments")
    if not os.path.isdir(exp_dir):
        return {"status": "no_experiments_dir"}
    data_files = [f for f in os.listdir(exp_dir)
                  if f.endswith((".csv", ".json", ".txt"))
                  and f.lower() not in ("experiment_plan.json", "experiment_plan.txt")
                  and os.path.isfile(os.path.join(exp_dir, f))]
    if not data_files:
        return {"status": "no_data_files"}
    results = {}
    for fname in sorted(data_files):
        check_cancelled()
        data = read_artifact(os.path.join(exp_dir, fname))
        runtime_token = _current_runtime.set(runtime)
        try:
            output = analyze_results(data=data)
        finally:
            _current_runtime.reset(runtime_token)
        results[fname] = output
    return results


def _stage_writing(project_dir, runtime):
    from openprogram.programs.workflow.research.stages.writing import write_section, gather_context
    sections = ["introduction", "method", "experiments", "related_work", "conclusion"]
    section_files = {
        "introduction": "1Introduction.tex",
        "method": "2Method.tex",
        "experiments": "3Experiments.tex",
        "related_work": "5RelatedWork.tex",
        "conclusion": "6Conclusion.tex",
    }
    results = {}
    for section in sections:
        check_cancelled()
        ctx = gather_context(project_dir, section)
        runtime_token = _current_runtime.set(runtime)
        try:
            content = write_section(section=section, project_context=ctx)
        finally:
            _current_runtime.reset(runtime_token)
        tex_file = section_files[section]
        write_artifact(os.path.join(project_dir, "paper", tex_file), content)
        results[section] = {"status": "written", "length": len(content)}
    return results


def _stage_review(project_dir, venue, exec_runtime, review_runtime, callback):
    from openprogram.programs.workflow.research.stages.review import review_loop
    paper_dir = os.path.join(project_dir, "paper")
    return review_loop(
        paper_dir=paper_dir, venue=venue or "NeurIPS",
        exec_runtime=exec_runtime,
        review_runtime=review_runtime or exec_runtime,
        callback=callback,
    )


def _stage_submission(project_dir, venue, runtime):
    from openprogram.programs.workflow.research.stages.submission import run_submission_check
    return run_submission_check(
        project_dir=project_dir, venue=venue or "NeurIPS", runtime=runtime,
    )
