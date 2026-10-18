"""Single-model text programs: summarize, translate, polish."""

from __future__ import annotations

from openprogram import Agent

editor = Agent(tools=[])


def summarize_text(text: str) -> str:
    """Compress text into a short summary."""
    return editor(f"Please summarize:\n\n{text}")


def translate_to_chinese(text: str) -> str:
    """Translate English text into Chinese."""
    return editor(f"Translate to Chinese:\n\n{text}")


def polish_text(text: str, style: str = "auto") -> str:
    """Polish text in the requested style."""
    instruction = (
        "Choose an appropriate style from the text's purpose and audience, then polish it. "
        "Preserve meaning, facts and any stated requirements. Do not ask the user to select a style."
        if style == "auto"
        else f"Polish this text in {style} style:"
    )
    return editor(f"{instruction}\n\n{text}")


PROGRAM_ENTRIES = [summarize_text, translate_to_chinese, polish_text]

ENTRY_OPTIONS = {
    "translate_to_chinese": {
        "input": {
            "text": {
                "description": "English text to translate",
                "placeholder": "e.g. Hello, how are you?",
            }
        },
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
    },
    "summarize_text": {
        "input": {
            "text": {
                "description": "Text to summarize",
                "placeholder": "Paste your text here...",
            }
        },
    },
}
