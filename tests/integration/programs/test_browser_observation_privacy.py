"""Real DOM observation privacy, using an owned headless Chromium instance."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from openprogram.programs.workflow.browser import BrowserPageController

pytestmark = pytest.mark.browser

_SECRET = "fixture-password-7359"


class _OwnedBrowserAPI:
    def __init__(self, attributes, *, secret=_SECRET, iframe=False):
        self.attributes, self.secret, self.iframe = attributes, secret, iframe
        self._sessions = {}
        self.playwright = self.browser = None

    def execute(self, *, action, **kwargs):
        if action == "open":
            from playwright.sync_api import sync_playwright
            self.playwright = sync_playwright().start()
            try:
                self.browser = self.playwright.chromium.launch(headless=True)
            except BaseException:
                self.playwright.stop()
                raise
            page = self.browser.new_page()
            page.set_content(f'<input type="password" {self.attributes}>'
                             '<input type="text" value="ordinary-input">')
            page.locator('input[type=password]').fill(self.secret)
            if self.iframe:
                page.evaluate("""() => { const frame = document.createElement('iframe');
                    frame.srcdoc = '<input type="password" value="frame-secret">';
                    document.body.append(frame); }""")
                page.frame_locator("iframe").locator("input").wait_for()
            self._sessions["br_private"] = {"page": page}
            return "Opened `br_private`"
        if action == "close":
            self._sessions.clear()
            self.browser.close()
            self.playwright.stop()
            return "Closed br_private"
        raise AssertionError(action)


@pytest.mark.parametrize("attributes", ["", 'aria-label="Password"', 'placeholder="Password"'])
@pytest.mark.parametrize("secret", [_SECRET, 'pāss"word\\line'])
def test_public_observation_and_accessibility_hide_passwords(monkeypatch, attributes, secret):
    from openprogram.programs.tools.web.browser import browser as browser_tool
    controller = BrowserPageController(browser_api=_OwnedBrowserAPI(attributes, secret=secret))
    try:
        observation = controller.execute(action="observe")
        visible_strings = [observation["text"], observation["title"], observation["aria_snapshot"],
                           *(element["name"] for element in observation["elements"])]
        assert all(secret not in text for text in visible_strings)
        assert "ordinary-input" in json.dumps(observation)
        if attributes:
            assert "Password" in json.dumps(observation)
        rejected = controller.execute(action="verify", expected_frame_id=observation["frame_id"],
                                      assertion="element_present", value=secret)
        assert rejected["passed"] is False

        def accessibility():
            monkeypatch.setitem(browser_tool._sessions, "br_private", {"page": controller._page()})
            return browser_tool.execute(action="accessibility", session_id="br_private")
        tree = controller._owner.submit(accessibility).result()
        assert secret not in tree
        assert "ordinary-input" in tree
    finally:
        controller.close()


@pytest.mark.parametrize("backend", ["playwright_mcp", "chrome_devtools_mcp"])
def test_official_upstream_snapshot_hides_passwords(monkeypatch, backend):
    from openprogram.programs.workflow.browser.mcp_backends import OfficialMCPPageBackend
    from openprogram.programs.workflow.browser.web_use_runtime import WebUseSession
    controller = BrowserPageController(browser_api=_OwnedBrowserAPI("", iframe=True))
    client = SimpleNamespace(call=lambda *args: SimpleNamespace(
        content=[SimpleNamespace(text=f'- textbox: {_SECRET}\n- textbox: frame-secret\n- textbox: ordinary-input')]))
    adapter = OfficialMCPPageBackend(backend, lambda: controller)
    monkeypatch.setattr(adapter, "_ensure_bound", lambda session: client)
    session = WebUseSession("private", backend, "binding")
    session.controller = controller
    session.state["upstream_page"] = 0
    try:
        observation = adapter.observe(session, {})
        assert _SECRET not in json.dumps(observation)
        assert "frame-secret" not in json.dumps(observation)
        assert "ordinary-input" in observation["aria_snapshot"]
    finally:
        controller.close()


def test_public_controller_browser_primitives_against_real_dom():
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    html = b"""<body style="height:2200px">
      <textarea aria-label="Report"></textarea>
      <div contenteditable="true" aria-label="Summary">old</div>
      <select aria-label="Week"><option value="1">One</option><option value="2">Two</option></select>
      <button aria-label="Save" onmouseenter="document.body.dataset.hover='yes'"
        onclick="document.querySelector('#status').innerText='Saved'">Save</button>
      <p id="status">Draft</p></body>"""
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    controller = BrowserPageController(browser_api=_OwnedBrowserAPI(""))

    def act(action, label=None, **arguments):
        observed = controller.execute(action="observe")
        if label:
            arguments["ref"] = next(element["ref"] for element in observed["elements"]
                                    if element["name"] == label)
        result = controller.execute(action=action, expected_frame_id=observed["frame_id"], **arguments)
        assert result["ok"] is True, result
        return result

    try:
        act("navigate", url=f"http://127.0.0.1:{server.server_port}/form")
        assert "/form" in requests
        act("type", "Report", text="weekly progress")
        act("press", "Report", key="End")
        act("press", "Report", key="Enter")
        assert controller.evaluate_bound_page("() => document.querySelector('textarea').value") == "weekly progress\n"
        act("type", "Summary", text="completed work")
        assert controller.evaluate_bound_page("() => document.querySelector('[contenteditable]').innerText") == "completed work"
        act("select", "Week", value="2")
        assert controller.evaluate_bound_page("() => document.querySelector('select').value") == "2"
        act("hover", "Save")
        assert controller.evaluate_bound_page("() => document.body.dataset.hover") == "yes"
        act("click", "Save")
        verified = act("verify", assertion="text_contains", value="Saved")
        assert verified["passed"] is True
        assert controller.final_result(summary="Saved fixture")["status"] == "succeeded"
        act("scroll", amount=350)
        controller._owner.submit(lambda: controller._page().wait_for_function("scrollY > 0")).result()
        act("navigate", url=f"http://127.0.0.1:{server.server_port}/reset")
        observed = controller.execute(action="observe")
        screenshot = controller.execute(action="screenshot", expected_frame_id=observed["frame_id"])
        assert screenshot.images[0].startswith(b"\x89PNG\r\n\x1a\n")
        point = controller.evaluate_bound_page("""() => { const rect = document.querySelector('button').getBoundingClientRect();
            return {x: rect.x+rect.width/2, y: rect.y+rect.height/2}; }""")
        result = controller.execute(action="click", expected_frame_id=observed["frame_id"], **point)
        assert result["ok"] is True
        assert act("verify", assertion="text_contains", value="Saved")["passed"] is True
    finally:
        try:
            controller.close()
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()


@pytest.mark.parametrize("mode", ["open", "closed"])
def test_shadow_password_is_redacted_from_public_observation_and_accessibility(monkeypatch, mode):
    from openprogram.programs.tools.web.browser import browser as browser_tool
    controller = BrowserPageController(browser_api=_OwnedBrowserAPI(""))
    secret = "shadow-secret-9843"
    try:
        controller.execute(action="observe")
        controller.evaluate_bound_page("""mode => { const host=document.createElement('div');
            document.body.append(host); host.attachShadow({mode}).innerHTML =
            '<input type="password" aria-label="Shadow password" value="shadow-secret-9843">'; }""", mode)
        observed = controller.execute(action="observe")
        assert secret not in json.dumps(observed)
        assert "ordinary-input" in observed["aria_snapshot"]

        def accessibility():
            monkeypatch.setitem(browser_tool._sessions, "br_private", {"page": controller._page()})
            return browser_tool.execute(action="accessibility", session_id="br_private")
        assert secret not in controller._owner.submit(accessibility).result()
    finally:
        controller.close()


def test_secret_absence_assertion_cannot_succeed_after_observation_redaction():
    controller = BrowserPageController(browser_api=_OwnedBrowserAPI(""))
    try:
        controller.execute(action="observe")
        controller.evaluate_bound_page("""secret => { const p=document.createElement('p');
            p.innerText=secret; document.body.append(p); }""", _SECRET)
        observed = controller.execute(action="observe")
        result = controller.execute(action="verify", expected_frame_id=observed["frame_id"],
                                    assertion="text_not_contains", value=_SECRET)
        assert result["passed"] is False
        assert _SECRET not in json.dumps(result)
        assert controller.final_result(summary="Password absent")["status"] == "failed"
        ordinary = controller.execute(action="verify", expected_frame_id=observed["frame_id"],
                                      assertion="text_not_contains", value="never-seen-text")
        assert ordinary["passed"] is True
    finally:
        controller.close()
