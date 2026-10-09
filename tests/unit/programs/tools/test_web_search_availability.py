"""web_search backend availability, DuckDuckGo parsing and unusable-provider errors."""
from __future__ import annotations

import sys

import pytest

from openprogram.programs.tools.web.web_search import web_search
from openprogram.programs.tools.web.web_search.combine import _resolve_provider_names
from openprogram.programs.tools.web.web_search.providers import duckduckgo
from openprogram.programs.tools.web.web_search.registry import registry


_RESULTS_PAGE = """
<html><body><div class="serp__results"><div class="results">
<div class="result results_links results_links_deep result--ad ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a class="result__a"
      href="https://duckduckgo.com/y.js?ad_domain=shop.example&amp;u3=x">Sponsored laptop</a></h2>
    <a class="result__snippet" href="https://duckduckgo.com/y.js?u3=x">Buy now</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="nofollow" class="result__a"
      href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Ffzkuji2026%2Fctxpress&amp;rut=abc">fzkuji2026/<b>ctxpress</b> &amp; friends</a></h2>
    <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Ffzkuji2026%2Fctxpress">github.com</a>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Context <b>compression</b>
      for   agents.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a class="result__a" href="https://docs.example.org/guide">Guide</a></h2>
    <a class="result__snippet" href="https://docs.example.org/guide">Plain link.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a class="result__a"
    href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Ffzkuji2026%2Fctxpress">Duplicate</a></h2>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a class="result__a"
    href="//duckduckgo.com/l/?uddg=javascript%3Aalert(1)">Script</a></h2>
</div>
</div></div></body></html>
"""


def test_duckduckgo_is_available_without_optional_package(monkeypatch):
    monkeypatch.setitem(sys.modules, "ddgs", None)

    assert duckduckgo.DuckDuckGoProvider().is_available()
    assert registry.availability_problem("duckduckgo") is None
    assert "duckduckgo" in [p.name for p in registry.available()]


def test_duckduckgo_parser_keeps_organic_hits_and_decodes_redirects():
    results = duckduckgo.parse_results(_RESULTS_PAGE, 10)

    assert [(r.title, r.url) for r in results] == [
        ("fzkuji2026/ctxpress & friends", "https://github.com/fzkuji2026/ctxpress"),
        ("Guide", "https://docs.example.org/guide"),
    ]
    assert results[0].snippet == "Context compression for agents."
    assert duckduckgo.parse_results(_RESULTS_PAGE, 1)[0].title.startswith("fzkuji2026")


def test_duckduckgo_parser_distinguishes_empty_challenge_and_unknown_pages():
    assert duckduckgo.parse_results('<div class="no-results">No results.</div>', 5) == []
    with pytest.raises(duckduckgo.DuckDuckGoPageError, match="bot challenge"):
        duckduckgo.parse_results('<div class="anomaly-modal__title">Select all ducks</div>', 5)
    with pytest.raises(duckduckgo.DuckDuckGoPageError, match="layout"):
        duckduckgo.parse_results("<html><body>Something else</body></html>", 5)


def test_duckduckgo_search_uses_the_managed_fixed_endpoint(monkeypatch):
    calls = []

    def get_bytes(url, **kwargs):
        calls.append((url, kwargs))
        return _RESULTS_PAGE.encode()

    monkeypatch.setattr(duckduckgo, "get_bytes", get_bytes)

    results = duckduckgo.DuckDuckGoProvider().search("ctxpress", num_results=3)

    assert [r.url for r in results][0] == "https://github.com/fzkuji2026/ctxpress"
    assert calls[0][0] == "https://html.duckduckgo.com/html/"
    assert calls[0][1]["params"] == {"q": "ctxpress"}


def test_explicit_unusable_providers_report_each_reason(monkeypatch):
    monkeypatch.delenv("EXA_API_KEY", raising=False)
    monkeypatch.delenv("KIMI_API_KEY", raising=False)
    monkeypatch.delenv("MOONSHOT_API_KEY", raising=False)

    text = web_search.execute(
        query="ctxpress", combine="race", providers=["exa", "moonshot", "nope"]
    )

    assert text.startswith("Error: No usable web_search provider for combined search")
    assert "exa: not configured (needs EXA_API_KEY)" in text
    assert "moonshot: not configured (needs one of KIMI_API_KEY / MOONSHOT_API_KEY)" in text
    assert "nope: not a registered provider" in text
    assert "Usable now:" in text and "duckduckgo" in text
    assert "Settings > Search" in text


def test_explicit_provider_list_keeps_usable_duckduckgo(monkeypatch):
    monkeypatch.delenv("EXA_API_KEY", raising=False)

    assert _resolve_provider_names(["duckduckgo"]) == ["duckduckgo"]
    assert _resolve_provider_names(["exa", "duckduckgo"]) == ["duckduckgo"]


def test_explicit_single_provider_error_names_reason_and_alternatives(monkeypatch):
    monkeypatch.delenv("EXA_API_KEY", raising=False)

    text = web_search.execute(query="ctxpress", provider="exa")

    assert text.startswith("Error: web_search provider 'exa' is registered but not available")
    assert "not configured (needs EXA_API_KEY)" in text
    assert "Usable now:" in text and "duckduckgo" in text
