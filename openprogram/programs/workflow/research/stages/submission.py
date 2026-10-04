"""
submission — pre-submission checklist stage.

Checks anonymity, page limits, format, references, and other
submission requirements based on venue guidelines.
"""

from __future__ import annotations

from openprogram.agentic_programming import Agent

import os

from openprogram.agentic_programming import llm
from openprogram.agentic_programming.call_state import _current_runtime
from openprogram.agentic_programming.runtime import Runtime
from .._paths import expanded_project_dir, read_artifact, write_artifact


class CheckSubmissionAgent(Agent):
    method_options = {
        "check_submission": {
            "render_range": {"depth": 0, "siblings": 0},
            "name": "check_submission",
            "tool": True,
        },
    }

    def check_submission(self, paper_content: str, venue: str) -> str:
        """Pre-submission checklist for academic paper.

        Run final checks before paper submission. Check for ALL of the
        following:

        1. Anonymity:
           - No author names, affiliations, or institutional info
           - No "our previous work..." or self-identifying references
           - No personal info in code links or supplementary
           - Check for hidden metadata

        2. Format:
           - Page limit compliance (body, references, appendix separately)
           - Correct venue template and meta information
           - Title and abstract match submission system

        3. References:
           - Verify against publisher or official paper metadata
           - Published versions preferred over arXiv
           - No duplicate citations (arXiv + published of same paper)
           - Recent baselines (within 2 years)
           - No AI-generated fake references

        4. Figures & Tables:
           - All referenced in text ("Figure X", "Table Y")
           - Order matches first mention in text
           - Vector format (PDF/EPS) for figures, not PNG/JPG
           - Text in figures >= body text size
           - Booktabs style for tables

        5. Writing:
           - Last line of each paragraph has >= 4 words
           - Consistent terminology throughout
           - No absolute claims without hedging (use "generally", "often")
           - Proper label prefixes (sec:, fig:, tab:, equ:, alg:)

        6. Code submission:
           - Anonymous repository link
           - No personal info or hardcoded paths in code
           - No hidden files (.git) with author info

        Output: Checklist with [PASS]/[FAIL]/[WARN] for each item.
        Flag critical issues that could cause desk rejection. Checks requiring
        rendered PDFs, metadata, external venue rules, or repository inspection
        must be marked WARN/unverified unless the input supplies that evidence.
        """
        return llm(
            [
                {
                    "type": "text",
                    "text": (
                        f"Target venue: {venue}\n\nPaper content:\n{paper_content}"
                    ),
                },
            ]
        )


check_submission = CheckSubmissionAgent().check_submission


def run_submission_check(
    project_dir: str,
    venue: str,
    runtime: Runtime,
) -> dict:
    """Run pre-submission checks.

    Args:
        project_dir:  Project directory.
        venue:        Target venue.
        runtime:      LLM runtime.

    Returns:
        dict with checklist results.
    """
    project_dir = str(expanded_project_dir(project_dir))
    paper_dir = os.path.join(project_dir, "paper")

    # Read paper
    parts = []
    for fname in sorted(os.listdir(paper_dir)):
        if fname.endswith(".tex"):
            parts.append(read_artifact(os.path.join(paper_dir, fname)))
    paper_content = "\n\n".join(parts)
    if not paper_content.strip():
        raise ValueError("No paper source is available for submission checks")

    runtime_token = _current_runtime.set(runtime)
    try:
        result = check_submission(
            paper_content=paper_content,
            venue=venue,
        )
    finally:
        _current_runtime.reset(runtime_token)

    # Save report
    write_artifact(
        os.path.join(project_dir, "SUBMISSION_CHECKLIST.md"),
        f"# Submission Checklist — {venue}\n\n{result}",
    )

    return {"checklist": result}
