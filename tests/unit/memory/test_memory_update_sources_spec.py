"""memory_update's declared sources match what the transaction accepts, so a
model writing from the schema alone gets the call right the first time."""

from __future__ import annotations

import re

import pytest


def _items():
    from openprogram.programs.tools.knowledge.memory.memory import UPDATE_SPEC

    return UPDATE_SPEC["parameters"]["properties"]["sources"]["items"]


def test_declared_source_fields_are_the_validated_ones():
    from openprogram.memory.management.transaction import SOURCE_LABEL_PATTERN, VALID_ROLES

    items = _items()
    assert set(items["required"]) == {"label", "role", "content"}
    assert items["properties"]["role"]["enum"] == list(VALID_ROLES)
    assert items["properties"]["label"]["pattern"] == f"^{SOURCE_LABEL_PATTERN.pattern}$"
    # Strict mode drops `pattern`; the description still states the format.
    assert "new-source-" in items["properties"]["label"]["description"]


def test_a_source_written_from_the_schema_parses():
    from openprogram.memory.management.transaction import TransactionLimits, parse_sources

    example = re.search(r"new-source-[a-z0-9-]+", _items()["properties"]["label"]["description"])[0]
    parsed = parse_sources([{"label": example, "role": "user", "content": "以后就按照这个格式给我写。"}],
                           TransactionLimits())
    assert parsed[0].label == example


@pytest.mark.parametrize("source", [
    {"source": "format-owner", "speaker": "owner/local", "quote": "x"},
    {"label": "new-source-a", "speaker": "owner/local", "text": "x"},
])
def test_the_shapes_models_guessed_are_outside_the_schema(source):
    items = _items()
    assert items["additionalProperties"] is False
    assert not set(source) <= set(items["properties"]) or not set(items["required"]) <= set(source)
