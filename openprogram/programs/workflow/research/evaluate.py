"""
evaluate — prompt competition between functions.

Each competing approach is a function whose docstring is its prompt.
``compete`` runs each one on the same input, then the ``evaluator`` role
(configure ``roles.evaluator.model`` for a different model) picks the
best output.

Usage:
    from openprogram.programs.workflow.research.evaluate import compete

    best = compete(
        functions=[polish_rigorous, polish_natural],
        kwargs={"text": "We propose ..."},
        task="Polish academic LaTeX for NeurIPS",
    )
"""

from __future__ import annotations

from .roles import evaluator
from openprogram.programs.workflow.json_parsing import parse_json


def _evaluate_candidates(task: str, candidates: list[dict]) -> dict:
    """Pick the best candidate output for an academic writing task.
    Score each on: accuracy, quality, academic rigor, naturalness.
    Return JSON: {"winner": <1-based>, "scores": [...], "reasoning": "..."}"""
    parts = [f"Task: {task}\n"]
    for i, c in enumerate(candidates):
        parts.append(f"--- Candidate {i + 1} ({c['name']}) ---")
        parts.append(c["output"][:3000])

    return evaluator(
        [
            {"type": "text", "text": "\n".join(parts)},
        ]
    )




def compete(
    functions: list[callable],
    kwargs: dict,
    task: str = "Pick the best academic writing output",
) -> dict:
    """Run prompt competition between functions.

    Each function is called with the same kwargs. Their outputs are
    judged by the ``evaluator`` role.

    Args:
        functions:  List of functions to compete.
        kwargs:     Keyword arguments to pass to each function.
        task:       Description of what we're evaluating.

    Returns:
        dict with: winner_index, winner_output, winner_name,
                   scores, reasoning, all_candidates
    """
    if not functions:
        raise ValueError("At least one candidate function is required")
    outputs = []
    if len(functions) == 1:
        output = functions[0](**kwargs)
        return {
            "winner_index": 0,
            "winner_output": output,
            "winner_name": functions[0].__name__,
            "scores": [10],
            "reasoning": "Single candidate",
            "all_candidates": [{"name": functions[0].__name__, "output": output}],
        }

    # Generate from each function
    candidates = []
    for fn in functions:
        output = fn(**kwargs)
        outputs.append(output)
        candidates.append({"name": fn.__name__, "output": str(output)})

    # Evaluate
    reply = _evaluate_candidates(task=task, candidates=candidates)

    result = reply if isinstance(reply, dict) else parse_json(reply)
    if not isinstance(result, dict):
        raise ValueError("Candidate evaluation must return an object")
    winner = result.get("winner")
    if type(winner) is not int or not 1 <= winner <= len(candidates):
        raise ValueError("Candidate evaluation returned an invalid winner")
    idx = winner - 1

    return {
        "winner_index": idx,
        "winner_output": outputs[idx],
        "winner_name": candidates[idx]["name"],
        "scores": result.get("scores", []),
        "reasoning": result.get("reasoning", ""),
        "all_candidates": candidates,
    }
