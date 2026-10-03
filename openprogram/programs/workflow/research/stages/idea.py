"""
idea — idea generation and novelty evaluation stage.

Generates research ideas from survey gaps, evaluates novelty,
and ranks them by feasibility and impact.
"""

from __future__ import annotations

from openprogram.agentic_programming import Agent

import os

from openprogram.agentic_programming import llm
from openprogram.agentic_programming.function import _current_runtime
from openprogram.agentic_programming.runtime import Runtime
from openprogram.programs.workflow.research._paths import (
    expanded_project_dir,
    read_artifact,
    write_artifact,
    find_project_artifact,
    writable_project_dir,
)
from openprogram.programs.workflow.json_parsing import parse_json


class GenerateIdeasAgent(Agent):
    method_options = {
        "generate_ideas": {
            "render_range": {"depth": 0, "siblings": 0},
            "name": "generate_ideas",
            "tool": True,
        },
    }

    def generate_ideas(self, topic: str, gaps: str) -> str:
        """Generate research ideas that address identified gaps.

        Brainstorm novel approaches. For each idea:
        1. Title: concise, descriptive name
        2. Hypothesis: what you believe and why
        3. Approach: high-level method (2-3 sentences)
        4. Expected outcome: what success looks like
        5. Feasibility: resources/time estimate (low/medium/high effort)
        6. Risk: what could go wrong

        Generate 3-5 diverse ideas ranging from incremental to ambitious.
        Each idea should directly address at least one identified gap.
        Prefer ideas that are testable with existing datasets/benchmarks.

        Output: Structured markdown with numbered ideas.
        """
        return llm(
            [
                {
                    "type": "text",
                    "text": (f"Research topic: {topic}\n\nIdentified gaps:\n{gaps}"),
                },
            ]
        )


generate_ideas = GenerateIdeasAgent().generate_ideas


class CheckNoveltyAgent(Agent):
    method_options = {
        "check_novelty": {
            "render_range": {"depth": 0, "siblings": 0},
            "name": "check_novelty",
            "tool": True,
        },
    }

    def check_novelty(self, idea: str) -> str:
        """Check if a research idea is novel.

        Use retrieved source records to identify existing work that:
        - Solves the same problem with the same approach
        - Uses a very similar method on the same task
        - Has already been published at a top venue

        Be honest: if the idea is incremental, say so.
        If no source evidence establishes novelty, mark confidence low and novelty
        unverified. A bounded search does not establish that no prior work exists.

        Output JSON:
        {"novel": true/false, "confidence": 0.0-1.0,
         "closest_work": "description of most similar existing work",
         "differentiation": "what makes this idea different"}
        """
        from .literature import retrieve_sources

        sources = retrieve_sources(idea[:1000])
        return llm(
            [
                {
                    "type": "text",
                    "text": f"Idea:\n{idea}\n\nRetrieved sources:\n{sources}",
                },
            ]
        )


check_novelty = CheckNoveltyAgent().check_novelty


class RankIdeasAgent(Agent):
    method_options = {
        "rank_ideas": {
            "render_range": {"depth": 0, "siblings": 0},
            "name": "rank_ideas",
            "tool": True,
        },
    }

    def rank_ideas(self, ideas: str, novelty_results: str) -> str:
        """Rank research ideas by overall promise.

        Consider: novelty, feasibility, potential impact, risk.
        Weight novelty and feasibility highest — a brilliant but infeasible
        idea is worse than a solid, executable one.

        Output JSON:
        {"ranking": [{"rank": 1, "title": "...", "score": 8.5,
                      "reasoning": "why this ranks here"}]}
        """
        return llm(
            [
                {
                    "type": "text",
                    "text": (
                        f"Ideas:\n{ideas}\n\nNovelty assessments:\n{novelty_results}"
                    ),
                },
            ]
        )


rank_ideas = RankIdeasAgent().rank_ideas


def run_idea(
    topic: str,
    project_dir: str,
    runtime: Runtime,
) -> dict:
    """Run idea generation stage.

    Reads gaps from literature stage, generates and ranks ideas.

    Args:
        topic:        Research topic.
        project_dir:  Project directory.
        runtime:      LLM runtime.

    Returns:
        dict with ideas, novelty checks, and ranking.
    """
    project_dir = str(expanded_project_dir(project_dir))

    # Read gaps from literature stage
    gaps_path = find_project_artifact(
        project_dir,
        "related_work/gaps.md",
        "literature review/synthesis/gaps.md",
        "synthesis/gaps.md",
    )
    if gaps_path is not None:
        gaps = read_artifact(gaps_path)
    else:
        import warnings

        warnings.warn(
            "Gaps file not found in the project directory. "
            "Run the 'literature' stage first for better results.",
            stacklevel=2,
        )
        gaps = "No gaps identified yet. Generate ideas based on the topic directly."

    runtime_token = _current_runtime.set(runtime)
    try:
        ideas = generate_ideas(topic=topic, gaps=gaps)

        # Check novelty for each idea
        novelty = check_novelty(idea=ideas)

        # Rank
        ranking = rank_ideas(ideas=ideas, novelty_results=novelty)
    finally:
        _current_runtime.reset(runtime_token)

    # Save
    output_dir = writable_project_dir(project_dir)
    write_artifact(
        output_dir / "IDEA_REPORT.md",
        (
            f"# Idea Report: {topic}\n\n"
            f"## Generated Ideas\n{ideas}\n\n"
            f"## Novelty Assessment\n{novelty}\n\n"
            f"## Ranking\n{ranking}\n"
        ),
    )

    return {"ideas": ideas, "novelty": novelty, "ranking": ranking}
