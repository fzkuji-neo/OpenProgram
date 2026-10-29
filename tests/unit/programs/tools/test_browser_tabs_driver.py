"""The built-in browser's tab driver: which tab an action goes to, and how a ref is found again."""
from __future__ import annotations

import pytest

from openprogram.programs.workflow.browser import tabs


def _surface(tab_id, **extra):
    return {"window_id": "main", "tab_id": tab_id, "target_id": f"T{tab_id}", "binding_id": f"b{tab_id}",
            "title": tab_id.upper(), "origin": "https://x.test", **extra}


@pytest.fixture
def driver(monkeypatch):
    from openprogram.agent import surface_context

    value = tabs.Driver()
    listed = {"surfaces": [_surface("a"), _surface("b", visible=True, focused=True)]}
    monkeypatch.setattr(surface_context, "current", lambda: None)
    monkeypatch.setattr(surface_context, "capture_pages_for_listing", lambda _context=None: listed)
    value.listed = listed
    yield value
    value._owner.shutdown()


def test_an_action_goes_to_the_named_tab_then_the_last_used_then_the_focused(driver):
    assert driver._tab("", "s1").title == "B"
    first = driver._tab("t1", "s1")
    assert first.title == "A" and driver._tab(None, "s1") is first
    # Ids stay with their tabs when the App lists them again, in any order.
    driver.listed["surfaces"].reverse()
    driver._refresh()
    assert driver._tab("t1", "s2").title == "A"
    with pytest.raises(tabs.BrowserError) as missing:
        driver._tab("t9", "s1")
    assert missing.value.reason_code == "tab_not_found"
    assert [row["tab"] for row in missing.value.extra["tabs"]] == ["t2", "t1"]


def test_snapshot_lines_give_each_ref_its_role_and_name():
    text = '- generic [ref=e1]:\n  - button "Say \\"hi\\"" [ref=e2] [cursor=pointer]\n- <changed> radio "A" [checked] [ref=f1e3]'
    assert tabs._REF_LINE.findall(text) == [("generic", "", "e1"), ("button", 'Say \\"hi\\"', "e2"),
                                            ("radio", "A", "f1e3")]


class _Locator:
    def __init__(self, count):
        self._count = count

    def count(self):
        return self._count


class _Page:
    url = "https://x.test/form"

    def __init__(self, refs=(), roles=()):
        self.refs, self.roles = set(refs), dict(roles)

    def locator(self, selector):
        return _Locator(1 if selector.removeprefix("aria-ref=") in self.refs else 0)

    def get_by_role(self, role, name=None, exact=False):
        return _Locator(self.roles.get((role, name), 0))

    def title(self):
        return "Form"


def test_a_ref_whose_element_was_rendered_again_is_found_by_role_and_name(driver, monkeypatch):
    tab = tabs.Tab(id="t1", window_id="main", tab_id="a", roles={"e4": ("button", "Next")})
    _, label = driver._locate(_Page(refs={"e4"}), tab, {"ref": "e4"})
    assert label == "e4"
    _, label = driver._locate(_Page(roles={("button", "Next"): 1}), tab, {"ref": "e4"})
    assert label == 'button "Next"'
    monkeypatch.setattr(driver, "_snapshot", lambda page, tab: ('- button "Back" [ref=e9]', ""))
    with pytest.raises(tabs.BrowserError) as gone:
        driver._locate(_Page(), tab, {"ref": "e4"})
    assert gone.value.reason_code == "element_gone" and "Back" in gone.value.extra["page"]


def test_a_result_carries_the_changes_or_the_whole_page_after_moving(driver, monkeypatch):
    tab = tabs.Tab(id="t1", window_id="main", tab_id="a")
    monkeypatch.setattr(driver, "_snapshot", lambda page, tab: ("- full", "- <changed> part"))
    assert driver._state(_Page(), tab, full=False, before_url="https://x.test/form")["changes"] == "- <changed> part"
    assert driver._state(_Page(), tab, full=False, before_url="https://x.test/start")["page"] == "- full"
    monkeypatch.setattr(driver, "_snapshot", lambda page, tab: ("- full", None))
    assert "page" in driver._state(_Page(), tab, full=False, before_url="https://x.test/form")
