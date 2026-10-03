"""Single-model text programs: summarize, translate, polish."""

from __future__ import annotations

from openprogram.agentic_programming import Agent, agent, llm


class TextAgent(Agent):
    method_options = {
        "translate_to_chinese": {
            "input": {
                "text": {
                    "description": "English text to translate",
                    "placeholder": "e.g. Hello, how are you?",
                }
            },
            "name": "translate_to_chinese",
            "tool": True,
        },
        "polish_text": {
            "input": {
                "text": {
                    "description": "Text to polish",
                    "placeholder": "Paste your text here...",
                },
                "style": {
                    "description": "Style",
                    "hidden": True,
                    "advanced": True,
                    "placeholder": "academic",
                    "options": ["auto", "academic", "casual", "concise"],
                },
            },
            "name": "polish_text",
            "tool": True,
        },
        "summarize_text": {
            "name": "summarize_text",
            "tool": True,
            "input": {
                "text": {
                    "description": "Text to summarize",
                    "placeholder": "Paste your text here...",
                }
            },
        },
    }

    def summarize_text(self, text: str) -> str:
        """Compress text into a short summary."""
        return agent(f"Please summarize:\n\n{text}", tools=[])

    def translate_to_chinese(self, text: str) -> str:
        """Translate English text into Chinese."""
        return llm(
            [
                {"type": "text", "text": f"Translate to Chinese:\n\n{text}"},
            ]
        )

    def polish_text(self, text: str, style: str = "auto") -> str:
        """Polish text in the requested style."""
        instruction = (
            "Choose an appropriate style from the text's purpose and audience, then polish it. "
            "Preserve meaning, facts and any stated requirements. Do not ask the user to select a style."
            if style == "auto"
            else f"Polish this text in {style} style:"
        )
        return llm(
            [
                {"type": "text", "text": f"{instruction}\n\n{text}"},
            ]
        )


_text_agent = TextAgent()
summarize_text = _text_agent.summarize_text
translate_to_chinese = _text_agent.translate_to_chinese
polish_text = _text_agent.polish_text
