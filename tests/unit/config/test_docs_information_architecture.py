from __future__ import annotations

from pathlib import Path

from scripts.docs_site import checklang
from scripts.docs_site.nav import build_tabs, discover


ROOT = Path(__file__).resolve().parents[3]


def test_internal_plans_are_not_part_of_the_public_docs_build() -> None:
    pages = discover(ROOT / "docs")
    paths = {page.rel.as_posix() for page in pages}

    assert not any(path.startswith("superpowers/") for path in paths)
    assert any(path.startswith("reference/design/plans/") for path in paths)
    assert "reference/design/repository-structure.html" in paths
    assert "reference/design/repository-structure-implementation.html" in paths


def test_gui_agent_design_covers_flow_boundaries_and_file_ownership() -> None:
    source = (ROOT / "docs/reference/design/ui/gui-agent.html").read_text(
        encoding="utf-8"
    )

    for section_id in (
        "scope",
        "references",
        "current",
        "architecture",
        "comparison",
        "execution",
        "surfaces",
        "macos",
        "browser",
        "platforms",
        "context",
        "performance",
        "authority",
        "recovery",
        "experience",
        "verification",
        "plan",
        "protocol",
        "evidence",
        "status",
    ):
        assert f'id="{section_id}"' in source
    for path in (
        "openprogram/programs/gui_harness_bridge.py",
        "openprogram/agent/process_runner.py",
        "openprogram/agent/surface_context.py",
        "openprogram/programs/workflow/browser/__init__.py",
        "apps/server/openprogram_server/_webui/ws_actions/webtab.py",
        "apps/web/lib/desktop/desktop-bridge.ts",
        "apps/desktop/main.js",
    ):
        assert path in source
    for contract_term in (
        "gui_exec",
        "plan_next_capability",
        "call_capability",
        "computer_use",
        "browser_use",
        "vm_use",
        "browser_agent",
        "web_use",
        "AgentSession",
        "effect_uncertain",
        "background_input",
    ):
        assert contract_term in source


def test_language_check_uses_the_same_public_docs_boundary(
    tmp_path: Path, monkeypatch
) -> None:
    internal = tmp_path / "superpowers" / "plans" / "internal.md"
    internal.parent.mkdir(parents=True)
    internal.write_text("# 内部计划\n", encoding="utf-8")
    public = tmp_path / "start" / "public.md"
    public.parent.mkdir(parents=True)
    public.write_text("# Public documentation\n", encoding="utf-8")
    monkeypatch.setattr(checklang, "DOCS", tmp_path)

    assert checklang.main() == 0


def test_ui_design_navigation_is_grouped_without_losing_pages() -> None:
    pages = discover(ROOT / "docs")
    design = next(tab for tab in build_tabs(ROOT / "docs", pages) if tab.key == "design")
    assert design.landing == Path("reference/design/README.html")
    ui_sections = {
        section.title: {page.rel.as_posix() for page in section.pages}
        for section in design.sections
        if section.title.startswith("UI ·")
    }

    assert set(ui_sections) == {
        "UI · Foundations",
        "UI · Chat and composer",
        "UI · Browser and tabs",
        "UI · Settings and catalog",
        "UI · Workspace and sidebar",
    }

    expected = {
        page.rel.as_posix()
        for page in pages
        if page.rel.parent.as_posix() == "reference/design/ui"
    }
    supporting = {
        page.rel.as_posix()
        for section in design.sections if section.title.startswith("Supporting ·")
        for page in section.pages if page.rel.parent.as_posix() == "reference/design/ui"
    }
    grouped = set().union(*ui_sections.values())
    assert grouped.isdisjoint(supporting)
    assert grouped | supporting == expected


def test_editorial_navigation_does_not_list_a_page_twice() -> None:
    pages = discover(ROOT / "docs")
    for tab in build_tabs(ROOT / "docs", pages):
        paths = [page.rel.as_posix() for section in tab.sections for page in section.pages]
        assert len(paths) == len(set(paths)), tab.key


def test_gui_agent_design_keeps_the_capability_loop_and_context_contract() -> None:
    design_dir = ROOT / "docs/reference/design/ui"
    english = (design_dir / "gui-agent.html").read_text(encoding="utf-8")
    chinese = (design_dir / "gui-agent.zh.html").read_text(encoding="utf-8")

    for required in (
        "computer_use",
        "browser_use",
        "vm_use",
        "plan_next_capability",
        "call_capability",
        "capability history",
        "adapters/mac_indicator.py",
    ):
        assert required in english
    for required in (
        "computer_use",
        "browser_use",
        "vm_use",
        "plan_next_capability",
        "call_capability",
        "上下文如何保证连续",
        "adapters/mac_indicator.py",
    ):
        assert required in chinese

    gui_page = next(
        page
        for page in discover(ROOT / "docs")
        if page.rel.as_posix() == "reference/design/ui/gui-agent.html"
    )
    assert gui_page.zh_src == design_dir / "gui-agent.zh.html"
    assert gui_page.zh_out == Path("reference/design/ui/gui-agent.zh.html")


def test_companion_source_links_match_discovered_output_paths(tmp_path, monkeypatch):
    import pytest
    pytest.importorskip("markdown_it")
    pytest.importorskip("mdit_py_plugins")
    from scripts.docs_site import build

    section = tmp_path / "section"
    section.mkdir()
    (section / "topic.md").write_text("# Topic\n", encoding="utf-8")
    (section / "topic.html").write_text('<h1>Diagram</h1><h2 id="flow">Flow</h2>', encoding="utf-8")
    (section / "standalone.html").write_text("<h1>Standalone</h1>", encoding="utf-8")
    monkeypatch.setattr(build, "DOCS_ROOT", tmp_path)
    monkeypatch.setattr(build, "DEPLOY_BASE", "/docs/")
    pages = {page.rel.as_posix(): page.out.as_posix() for page in discover(tmp_path)}
    from html.parser import HTMLParser

    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.urls = []

        def handle_starttag(self, tag, attrs):
            if tag == "a":
                self.urls.append(dict(attrs)["href"])

    links = Links()
    links.feed(build.relink_internal(
        '<a href="topic.md">Text</a><a href="topic.html#flow">Diagram</a>'
        '<a href="standalone.html">Standalone</a><a href="topic.viz.html">Published</a>',
        Path("section"),
    ))
    assert links.urls == [
        "/docs/" + pages["section/topic.md"],
        "/docs/" + pages["section/topic.html"] + "#flow",
        "/docs/" + pages["section/standalone.html"],
        "/docs/" + pages["section/topic.html"],
    ]


def test_bilingual_companions_keep_distinct_language_outputs(tmp_path, monkeypatch):
    import pytest
    pytest.importorskip("markdown_it")
    pytest.importorskip("mdit_py_plugins")
    from scripts.docs_site import build

    section = tmp_path / "section"
    section.mkdir()
    for name in ("topic.md", "topic.html", "topic.zh.html"):
        (section / name).write_text("<h1>Topic</h1>", encoding="utf-8")
    monkeypatch.setattr(build, "DOCS_ROOT", tmp_path)
    monkeypatch.setattr(build, "DEPLOY_BASE", "/docs/")

    # The HTML translation must work with or without a Markdown translation.
    for markdown_translation in (False, True):
        if markdown_translation:
            (section / "topic.zh.md").write_text("# Topic", encoding="utf-8")
        pages = {page.rel.suffix: page for page in discover(tmp_path)}
        outputs = [output for page in pages.values()
                   for output in (page.out, page.zh_out) if output is not None]
        assert len(outputs) == len(set(outputs))
        assert pages[".html"].zh_out == Path("section/topic.zh.viz.html")
        assert build.relink_internal('<a href="topic.zh.html#flow">Diagram</a>', Path("section")) == (
            '<a href="/docs/section/topic.zh.viz.html#flow">Diagram</a>'
        )
        if markdown_translation:
            assert pages[".md"].zh_out == Path("section/topic.zh.html")
            assert build.relink_internal('<a href="topic.zh.md">Text</a>', Path("section")) == (
                '<a href="/docs/section/topic.zh.html">Text</a>'
            )


def test_root_overview_has_bilingual_navigation_titles(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text('<p>OpenProgram</p>', encoding="utf-8")
    (tmp_path / "README.zh.md").write_text('<p>OpenProgram</p>', encoding="utf-8")
    page = discover(tmp_path)[0]
    assert (page.title, page.title_zh) == ("Overview", "概览")


def test_design_structure_has_one_overview_and_covers_every_page() -> None:
    pages = discover(ROOT / "docs")
    design = next(tab for tab in build_tabs(ROOT / "docs", pages) if tab.key == "design")
    assert len({section.title for section in design.sections}) == len(design.sections)
    assert all(section.title_zh for section in design.sections)
    assert max(len(section.pages) for section in design.sections) <= 24
    actual = [page.rel for section in design.sections for page in section.pages]
    expected = [page.rel for page in pages if page.rel.as_posix().startswith("reference/design/")]
    assert sorted(actual) == sorted(expected)
    assert [section.title for section in design.sections][-3:] == [
        "Supporting · Prototypes", "Supporting · Implementation records", "Supporting · Research",
    ]


def test_design_navigation_disclosures_open_current_group() -> None:
    from scripts.docs_site.build import render_nav
    pages = discover(ROOT / "docs")
    design = next(tab for tab in build_tabs(ROOT / "docs", pages) if tab.key == "design")
    current = Path("reference/design/runtime/session/storage.html")
    markup = render_nav(design.sections, current, "/docs/", collapsible=True)
    from html.parser import HTMLParser

    class Groups(HTMLParser):
        def __init__(self):
            super().__init__()
            self.open_groups = 0
            self.group_open = False
            self.active_open = False
            self.depth = 0
            self.roots = 0
            self.active_depth = 0
        def handle_endtag(self, tag):
            if tag == "details":
                self.depth -= 1
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == "details":
                self.roots += self.depth == 0
                self.depth += 1
                self.group_open = "open" in attrs
                self.open_groups += self.group_open
            if tag == "a" and attrs.get("href") == "/docs/" + current.as_posix():
                self.active_open = self.group_open
                self.active_depth = self.depth
    parser = Groups()
    parser.feed(markup)
    assert parser.roots == 7
    assert parser.open_groups == 2
    assert parser.active_depth == 2
    assert parser.active_open
    from scripts.docs_site.build import flatten_pages
    chain = next(chain for page, chain in flatten_pages(design.sections) if page.out == current)
    assert chain == [("Agents and workflows", "Agent 与工作流"), ("Sessions", "会话与存储")]
    assert "<details" not in render_nav(design.sections, current, "/docs/")
