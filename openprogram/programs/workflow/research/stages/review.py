"""
review — cross-model review and iterative improvement.

Executor and reviewer use different LLM runtimes to avoid self-play
blind spots. The loop: review → fix → re-review → until pass.
"""

from __future__ import annotations

from openprogram.agentic_programming import Agent

import os
import re
import math
from typing import Optional

from openprogram.agentic_programming import llm
from openprogram.agentic_programming.call_state import _current_runtime, check_cancelled
from openprogram.agentic_programming.runtime import Runtime
from .._paths import expanded_project_dir, read_artifact, write_artifact
from openprogram.programs.workflow.json_parsing import parse_json


class ReviewPaperAgent(Agent):
    method_options = {
        "review_paper": {
            "render_range": {"depth": 0, "siblings": 0},
            "name": "review_paper",
            "tool": True,
        },
    }

    def review_paper(self, paper_content: str, venue: str) -> str:
        """Review a paper at the level expected by top CS conferences.

        Evaluate the paper objectively: identify weaknesses AND acknowledge
        strengths. Be rigorous and precise.

        Review dimensions:
        - Community contribution: does this advance the field substantively?
        - Rigor: are claims supported by experiments? Fair baselines? Ablations?
        - Consistency: do intro claims match experimental validation?

        Distinguish fatal flaws from fixable issues — they carry different weight.
        Be specific: not "experiments insufficient" but "missing comparison with
        [specific method] on [specific dataset]".

        Score faithfully: if the paper is solid, give it a high score.
        Skip pleasantries, cut to core judgments.

        After your review, append a JSON block:
        ```json
        {"score": <1-10>, "passed": <true if score>=7>,
         "weaknesses": ["specific issues"],
         "strengths": ["specific strengths"],
         "verdict": "one-line summary"}
        ```
        """
        return llm(
            [
                {
                    "type": "text",
                    "text": (f"Target venue: {venue}\n\nPaper:\n{paper_content}"),
                },
            ]
        )


review_paper = ReviewPaperAgent().review_paper


class FixPaperAgent(Agent):
    method_options = {
        "fix_paper": {
            "render_range": {"siblings": -1},
            "name": "fix_paper",
            "tool": True,
        },
    }

    def fix_paper(
        self, paper_content: str, review_feedback: str, round_num: int
    ) -> str:
        """Fix the paper based on reviewer feedback.

        Address EVERY weakness mentioned. Do NOT weaken existing strengths.
        Rewrite actual paragraphs — don't just describe what should change.
        Maintain LaTeX formatting.

        Output the COMPLETE fixed paper content. Preserve every file boundary
        marker exactly as "% === filename.tex ==="; include all original files
        once, with no markdown fences or added files. Never invent experiment
        results or citations to satisfy review feedback.
        """
        return llm(
            [
                {
                    "type": "text",
                    "text": (
                        f"Round {round_num}\n\n"
                        f"Reviewer feedback:\n{review_feedback}\n\n"
                        f"Current paper:\n{paper_content}"
                    ),
                },
            ]
        )


fix_paper = FixPaperAgent().fix_paper


def _read_paper(paper_dir: str) -> str:
    """Read all .tex files from paper directory."""
    paper_dir = str(expanded_project_dir(paper_dir))
    parts = []
    for fname in sorted(os.listdir(paper_dir)):
        if fname.endswith(".tex"):
            parts.append(
                f"% === {fname} ===\n{read_artifact(os.path.join(paper_dir, fname))}"
            )
    if not parts or not any(part.partition("\n")[2].strip() for part in parts):
        raise ValueError("No paper source is available for review")
    return "\n\n".join(parts)


def _save_review_log(log_path: str, rounds: list):
    """Save review history."""
    lines = ["# Auto Review Log\n"]
    for r in rounds:
        lines.append(f"## Round {r['round']}")
        lines.append(f"- Score: {r.get('score', '?')}/10")
        lines.append(f"- Verdict: {r.get('verdict', '?')}")
        if r.get("weaknesses"):
            for w in r["weaknesses"]:
                lines.append(f"- Weakness: {w}")
        lines.append("")
    write_artifact(log_path, "\n".join(lines))


def review_loop(
    paper_dir: str,
    venue: str = "NeurIPS",
    exec_runtime: Runtime = None,
    review_runtime: Runtime = None,
    max_rounds: int = 4,
    pass_threshold: int = 7,
    callback: Optional[callable] = None,
) -> dict:
    """Cross-model review loop until paper passes or max rounds.

    Args:
        paper_dir:       Path to paper/ directory with .tex files.
        venue:           Target venue.
        exec_runtime:    Runtime for fixing (executor).
        review_runtime:  Runtime for reviewing (different model recommended).
        max_rounds:      Max review-fix cycles.
        pass_threshold:  Min score to pass (default: 7/10).
        callback:        Called after each round.

    Returns:
        dict with: passed, rounds, final_score, reviews
    """
    if exec_runtime is None:
        raise ValueError("exec_runtime is required")
    if review_runtime is None:
        review_runtime = exec_runtime

    paper_dir = str(expanded_project_dir(paper_dir))
    paper_content = _read_paper(paper_dir)
    log_path = os.path.join(os.path.dirname(paper_dir), "AUTO_REVIEW.md")
    reviews = []

    if type(max_rounds) is not int or max_rounds < 1:
        raise ValueError("max_rounds must be a positive integer")
    if (
        isinstance(pass_threshold, bool)
        or not isinstance(pass_threshold, (int, float))
        or not 1 <= pass_threshold <= 10
    ):
        raise ValueError("pass_threshold must be between 1 and 10")
    names = sorted(name for name in os.listdir(paper_dir) if name.endswith(".tex"))
    marker = re.compile(r"^% === ([^\r\n]+\.tex) ===[ \t]*$", re.MULTILINE)

    for round_num in range(1, max_rounds + 1):
        check_cancelled()
        # Preserve caller provider configuration, credentials and working context.
        runtime_token = _current_runtime.set(review_runtime)
        try:
            reply = review_paper(paper_content=paper_content, venue=venue)
        finally:
            _current_runtime.reset(runtime_token)
        review = reply if isinstance(reply, dict) else parse_json(reply)
        if not isinstance(review, dict):
            raise ValueError("Paper review must return an object")
        score = review.get("score")
        if (
            isinstance(score, bool)
            or not isinstance(score, (int, float))
            or not math.isfinite(score)
            or not 1 <= score <= 10
        ):
            raise ValueError(
                "Paper review score must be a finite number between 1 and 10"
            )
        review["passed"] = score >= pass_threshold
        review["round"] = round_num
        review["full_review"] = reply
        reviews.append(review)
        _save_review_log(log_path, reviews)
        if callback and callback({"type": "review", **review}) is False:
            break
        if review["passed"]:
            return {
                "passed": True,
                "rounds": round_num,
                "final_score": score,
                "reviews": reviews,
            }
        # Do not generate an unreviewed fix after the final allowed review.
        if round_num == max_rounds:
            break
        runtime_token = _current_runtime.set(exec_runtime)
        try:
            fixed = fix_paper(
                paper_content=paper_content,
                review_feedback=reply if isinstance(reply, str) else str(reply),
                round_num=round_num,
            )
        finally:
            _current_runtime.reset(runtime_token)
        if not isinstance(fixed, str):
            raise ValueError("Paper repair must return complete text")
        matches = list(marker.finditer(fixed))
        if sorted(match.group(1) for match in matches) != names or len(matches) != len(
            names
        ):
            raise ValueError(
                "Paper repair must preserve every original file boundary exactly once"
            )
        if fixed[: matches[0].start()].strip():
            raise ValueError("Paper repair includes text outside file boundaries")
        files = {}
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(fixed)
            content = fixed[match.end() : end].strip()
            if not content or "```" in content:
                raise ValueError("Paper repair contains empty or fenced file content")
            files[match.group(1)] = content + "\n"
        check_cancelled()
        for name, content in files.items():
            write_artifact(os.path.join(paper_dir, name), content)
        paper_content = _read_paper(paper_dir)
        if callback and callback({"type": "fix", "round": round_num}) is False:
            break

    return {
        "passed": False,
        "rounds": len(reviews),
        "final_score": reviews[-1].get("score", 0) if reviews else 0,
        "reviews": reviews,
    }
