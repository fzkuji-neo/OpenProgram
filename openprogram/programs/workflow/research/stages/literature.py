"""
literature — literature survey stage.

Searches for related papers, reads abstracts, and generates
categorized survey notes organized by topic.
"""

from __future__ import annotations

from openprogram.agentic_programming import Agent

import os
import json

from openprogram.agentic_programming import llm
from openprogram.agentic_programming.call_state import _current_runtime
from openprogram.agentic_programming.runtime import Runtime
from .._paths import expanded_project_dir, write_artifact


def retrieve_sources(topic: str) -> str:
    """Acquire paper metadata before asking a model to synthesize it."""
    from openprogram.agentic_programming.call_state import check_cancelled
    from openprogram.programs.tools.web.web_search.providers.arxiv import ArxivProvider

    if not isinstance(topic, str) or not topic.strip():
        raise ValueError("research topic must be nonempty")
    check_cancelled()
    records = ArxivProvider().search(topic, num_results=12)
    check_cancelled()
    sources = [
        {"title": r.title, "url": r.url, "abstract_excerpt": r.snippet, **r.extras}
        for r in records
        if r.title and r.url
    ]
    if not sources:
        raise RuntimeError("Official paper search returned no source records")
    return json.dumps(sources, ensure_ascii=False)


class SurveyTopicAgent(Agent):
    method_options = {
        "survey_topic": {
            "render_range": {"depth": 0, "siblings": 0},
            "name": "survey_topic",
            "tool": True,
        },
    }

    def survey_topic(self, topic: str) -> str:
        """Survey the literature for a given research topic.

        Search for and organize the most relevant and recent papers on this
        topic.

        For each paper found:
        - Title, authors, venue, year
        - Core contribution (1-2 sentences)
        - Methodology summary
        - Limitations / gaps

        Organize papers into logical categories/subtopics.
        Prioritize recent work (within 2 years) and top venues.
        Use published versions over arXiv when available.
        Cite only the supplied retrieved records and include their exact URLs.
        Abstract excerpts are incomplete: do not assert numerical results or
        PDF verification. Missing source evidence must remain explicitly unknown.

        Output: A structured markdown survey organized by subtopic.
        """
        sources = retrieve_sources(topic)
        return llm(
            [
                {
                    "type": "text",
                    "text": f"Research topic: {topic}\n\nRetrieved source records:\n{sources}",
                },
            ]
        )


survey_topic = SurveyTopicAgent().survey_topic


class IdentifyGapsAgent(Agent):
    method_options = {
        "identify_gaps": {
            "render_range": {"depth": 0, "siblings": 0},
            "name": "identify_gaps",
            "tool": True,
        },
    }

    def identify_gaps(self, survey: str) -> str:
        """Identify research gaps from a literature survey.

        Analyze the survey and identify:
        1. What problems remain unsolved or underexplored?
        2. What assumptions in existing work are questionable?
        3. Where do methods fail or underperform?
        4. What combinations of approaches haven't been tried?

        Be specific: don't say "more research needed", say exactly what's missing.

        Output: Numbered list of specific, actionable research gaps.
        """
        return llm(
            [
                {"type": "text", "text": survey},
            ]
        )


identify_gaps = IdentifyGapsAgent().identify_gaps


def run_literature(
    topic: str,
    project_dir: str,
    runtime: Runtime,
) -> dict:
    """Run the literature survey stage.

    Args:
        topic:        Research topic/direction.
        project_dir:  Project directory path.
        runtime:      LLM runtime.

    Returns:
        dict with survey text and identified gaps.
    """
    project_dir = str(expanded_project_dir(project_dir))

    runtime_token = _current_runtime.set(runtime)
    try:
        survey = survey_topic(topic=topic)
        gaps = identify_gaps(survey=survey)
    finally:
        _current_runtime.reset(runtime_token)

    # Save to project
    rw_dir = os.path.join(project_dir, "related_work")
    write_artifact(
        os.path.join(rw_dir, "survey.md"), f"# Literature Survey: {topic}\n\n{survey}"
    )
    write_artifact(os.path.join(rw_dir, "gaps.md"), f"# Research Gaps\n\n{gaps}")

    return {"survey": survey, "gaps": gaps}
