"""
experiment — experiment design, execution, and monitoring stage.

Designs experiments, generates code, runs them, and monitors progress.
"""

from __future__ import annotations

import os

from openprogram.agentic_programming import agent, llm
from openprogram.agentic_programming.function import _current_runtime, agentic_function
from openprogram.agentic_programming.runtime import Runtime
from .._paths import expanded_project_dir, read_artifact, write_artifact


@agentic_function(render_range={"depth": 0, "siblings": 0})
def design_experiments(idea: str) -> str:
    """Design a complete experiment plan for a research idea.

    Design a rigorous experiment plan. It must include:
    1. Research Questions (RQ1, RQ2, RQ3...)
    2. Datasets: which ones, why, train/val/test splits
    3. Baselines: recent methods (within 2 years), justify each
    4. Evaluation Metrics: which metrics, why they're appropriate
    5. Ablation Study: which components to ablate
    6. Implementation Details: framework, hardware, hyperparameter ranges
    7. Expected Experiment Types:
       - Overall Performance (all datasets × all baselines)
       - Ablation Study (remove key modules)
       - Parameter Analysis (vary hyperparameters)
       - Efficiency Study (time/space)
       - Case Study / Visualization

    Each experiment should map to a specific research question.
    Be specific about what to measure and how to interpret results.

    Output: Structured markdown experiment plan.
    """
    return llm([
        {"type": "text", "text": idea},
    ])


@agentic_function(render_range={"siblings": -1})
def run_experiment(plan: str, step: str) -> str:
    """Execute one step of the experiment plan.

    Use the provided file and command tools within the user's approved
    project, permissions, resource limits and requested experiment step.
    Do not start unrelated experiments, rent resources, or publish results.

    After execution, report:
    - What you did
    - Results obtained (exact numbers)
    - Any issues encountered
    - What to do next

    Cite the actual command output and saved logs or metrics. An intended
    command, paper abstract or generated report is not evidence of execution.
    If execution is blocked, incomplete or unavailable, report that status
    explicitly and do not invent measurements or claim completion.

    Output: Execution report with results.
    """
    return agent([
        {"type": "text", "text": (
            f"Experiment plan:\n{plan}\n\n"
            f"Current step:\n{step}"
        )},
    ], tools=["read", "write", "edit", "bash"], max_iterations=20)


@agentic_function(render_range={"depth": 0, "siblings": 0})
def check_training(log: str) -> str:
    """Check training logs for issues.

    Analyze the training log and report:
    - Is training progressing normally? (loss decreasing, metrics improving)
    - Any signs of overfitting? (train/val divergence)
    - Any NaN/Inf values?
    - Estimated time to completion?
    - Recommendation: continue / stop early / adjust hyperparameters?

    Output JSON:
    {"status": "healthy/warning/critical",
     "issues": ["list of issues"],
     "recommendation": "what to do next"}
    """
    return llm([
        {"type": "text", "text": log},
    ])


def run_experiments(
    project_dir: str,
    runtime: Runtime,
) -> dict:
    """Run the experiment stage.

    Read the idea report and save an experiment plan. Execution is a separate
    call to run_experiment for an approved step; this helper returns planned.

    Args:
        project_dir:  Project directory.
        runtime:      LLM runtime.

    Returns:
        dict with experiment plan and execution status.
    """
    project_dir = str(expanded_project_dir(project_dir))

    # Read idea
    idea_path = os.path.join(project_dir, "IDEA_REPORT.md")
    if os.path.exists(idea_path):
        idea = read_artifact(idea_path)
    else:
        import warnings
        warnings.warn(
            f"IDEA_REPORT.md not found at {idea_path}. "
            "Run the 'idea' stage first for better experiment design.",
            stacklevel=2,
        )
        idea = None
        # Fallback to outline
        outline_path = os.path.join(project_dir, "outline", "outline.md")
        if os.path.exists(outline_path):
            idea = read_artifact(outline_path)

    if not idea or not idea.strip():
        raise ValueError("An idea report or outline is required before experiment design")

    # Design
    runtime_token = _current_runtime.set(runtime)
    try:
        plan = design_experiments(idea=idea)
    finally:
        _current_runtime.reset(runtime_token)

    # Save plan
    exp_dir = os.path.join(project_dir, "experiments")
    write_artifact(os.path.join(exp_dir, "EXPERIMENT_PLAN.md"), f"# Experiment Plan\n\n{plan}")

    return {"plan": plan, "status": "planned"}
