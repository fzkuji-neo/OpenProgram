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


def test_retired_document_urls_publish_redirects_without_duplicate_catalog_entries(
    tmp_path: Path, monkeypatch
) -> None:
    import json
    from scripts.docs_site import build, generate_reference

    (tmp_path / 'start').mkdir()
    (tmp_path / 'start/topic.md').write_text('# Canonical topic\n\n## Details\nBody\n')
    (tmp_path / 'redirects.json').write_text(json.dumps({'start/old.html': 'start/topic.html#details'}))
    monkeypatch.setattr(build, 'DOCS_ROOT', tmp_path)
    monkeypatch.setattr(build, 'OUT_ROOT', tmp_path / '_site')
    monkeypatch.setattr(generate_reference, 'generate_all', lambda: None)
    assert build.build() == 0
    output = tmp_path / '_site'
    redirect = (output / 'start/old.html').read_text()
    assert '<script src="/docs/assets/redirect.js"></script>' in redirect
    assert '<script>' not in redirect  # The default worker blocks inline scripts.
    redirect_script = (output / 'assets/redirect.js').read_text()
    assert 'location.replace' in redirect_script
    assert 'location.search' in redirect_script and 'location.hash' in redirect_script
    assert '/docs/start/topic.html#details' in redirect
    assert 'noindex' in redirect
    assert 'old.html' not in (output / 'sitemap.xml').read_text()
    assert {p.rel.as_posix() for p in discover(tmp_path)} == {'start/topic.md'}
    assert 'old.html' not in (output / 'start/topic.html').read_text()


def test_invalid_document_redirect_preserves_published_site(tmp_path: Path, monkeypatch) -> None:
    import json
    import pytest
    from scripts.docs_site import build, generate_reference

    (tmp_path / 'start').mkdir()
    (tmp_path / 'start/topic.md').write_text('# Topic\n')
    monkeypatch.setattr(build, 'DOCS_ROOT', tmp_path)
    monkeypatch.setattr(build, 'OUT_ROOT', tmp_path / '_site')
    monkeypatch.setattr(generate_reference, 'generate_all', lambda: None)
    assert build.build() == 0
    published = (tmp_path / '_site/start/topic.html').read_bytes()
    for aliases in (
        {'start/old.html': 'missing.html'},
        {'start/topic.html': 'start/topic.html'},
        {'start/old.html': 'start/other.html', 'start/other.html': 'start/topic.html'},
        {'../outside.html': 'start/topic.html'},
    ):
        (tmp_path / 'redirects.json').write_text(json.dumps(aliases))
        with pytest.raises(ValueError):
            build.build()
        assert (tmp_path / '_site/start/topic.html').read_bytes() == published


def test_consolidated_entity_proposal_retains_replay_and_project_sections() -> None:
    import re
    from scripts.docs_site import build

    for language, headings in (
        ('', ('42-projects-panel', '43-project-indicator-at-the-top-of-chat',
              '5-key-invariants', '6-risks',
              '8-relationship-with-the-existing-commit-chain', 'appendix-proposed-build-order')),
        ('.zh', ('42-projects-panel', '43-chat-顶部-project-指示',
                 '5-关键不变式', '6-风险点', '8-跟现有-commit-chain-的关系', '附录-提议的构建顺序')),
    ):
        source = (ROOT / f'docs/reference/design/memory/entity-memory-proposal{language}.md').read_text()
        build._SLUG_DEDUP = {}
        rendered = build.make_md().render(source)
        ids = re.findall(r'\bid="([^"]+)"', rendered)
        assert set(headings) <= set(ids)
        assert len(ids) == len(set(ids))
        assert '&lt;span' not in rendered


def test_local_topic_titles_render_as_headings_after_compatibility_anchors() -> None:
    import re
    from scripts.docs_site import build

    for name in ('context/composition', 'memory/overview',
                 'runtime/session/storage', 'runtime/dag/rendering'):
        for language in ('', '.zh'):
            source = (ROOT / f'docs/reference/design/{name}{language}.md').read_text()
            build._SLUG_DEDUP = {}
            rendered = build.make_md().render(source)
            assert re.search(r'<h1\b[^>]*>[^<]+', rendered), name + language
            assert not re.search(r'^# ', rendered, re.MULTILINE), name + language


def test_previous_next_and_tabs_follow_document_language(tmp_path):
    from scripts.docs_site.build import render_prevnext, render_tabbar

    (tmp_path / 'start').mkdir()
    (tmp_path / 'start/README.md').write_text('# Introduction\n', encoding='utf-8')
    (tmp_path / 'start/README.zh.md').write_text('# 介绍\n', encoding='utf-8')
    page = discover(tmp_path)[0]
    rendered = render_prevnext(page, None)
    assert 'data-title-zh="介绍"' in rendered
    assert 'data-href-zh="/docs/start/README.zh.html"' in rendered
    tabs = render_tabbar(build_tabs(tmp_path, [page]), 'start', '/docs/')
    assert 'data-href-zh="/docs/start/README.zh.html"' in tabs


def test_language_check_includes_html_and_design_prose_but_preserves_code(tmp_path, monkeypatch):
    source = tmp_path / 'reference/design/topic.html'
    source.parent.mkdir(parents=True)
    source.write_text('<h1>中文标题</h1><p>English explanation.</p>', encoding='utf-8')
    monkeypatch.setattr(checklang, 'DOCS', tmp_path)
    assert checklang.main() == 1
    source.write_text('<h1>Topic</h1><svg aria-label="调用关系"></svg>', encoding='utf-8')
    assert checklang.main() == 1
    source.write_text('<h1>Topic</h1><div id="旧锚点"></div><pre>示例代码</pre>', encoding='utf-8')
    assert checklang.main() == 0


def test_standalone_search_text_excludes_styles_and_scripts():
    from scripts.docs_site.search import plain_text

    assert plain_text('<style>.ui { color: red; }</style><script>const hidden = 1;</script>'
                      '<h1>模型选型</h1><p>比较备选设计。</p>') == '模型选型 比较备选设计。'
