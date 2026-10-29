"""The built-in browser's tabs, operated directly through Playwright.

A tab keeps one short id (``t1``, ``t2`` …) for as long as the server runs,
the same in every turn and sub-agent of every conversation. Reading a tab
returns Playwright's AI snapshot: the page's ARIA tree, each element with a
ref (``e12``; ``f1e3`` inside a frame). A ref stays valid while its element
exists, through any number of actions, and every action returns what it
changed as an incremental snapshot, so there is no separate observe step and
nothing that expires between calls. A ref whose element is gone is found
again by its role and name; failing that, the action fails with the page as
it is now.

Playwright's sync API belongs to one thread, so one owner thread holds the
CDP connection to the App and reconnects when the App restarts. Tabs are
listed, opened, captured and closed through the App's renderer
(``surface_context`` / ``webtab``). Input is Playwright's own, trusted
input; it reaches a tab in the background without bringing it forward.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import contextvars
from dataclasses import dataclass, field
import itertools
import re
import struct
import threading
import time
from typing import Any
from urllib.parse import urlparse

from ._runtime import page_actions as pa

SNAPSHOT_LIMIT = 40_000
ACTION_TIMEOUT_MS = 10_000
_TRACK = "openprogram"
_LOG_LIMIT = 300
# "- button "Next" [ref=e12]" -> role, name, ref.
_REF_LINE = re.compile(r'^\s*- (?:<changed> )?([\w-]+)(?: "((?:[^"\\]|\\.)*)")?[^\n]*?\[ref=(\w+)\]', re.M)

_CURSOR_AT_SCRIPT = r"""
element => {
  const cursor = globalThis.__openprogramAgentCursor;
  if (!cursor?.armed || typeof cursor.show !== "function") return;
  const rect = element.getBoundingClientRect();
  cursor.armed = false;
  cursor.show(rect.left + rect.width / 2, rect.top + rect.height / 2);
}
"""

_VIEWPORT_WIDTH = "() => window.innerWidth"


class BrowserError(Exception):
    """An action that did not happen, with what the model needs to go on."""

    def __init__(self, reason_code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.reason_code = reason_code
        self.extra = extra

    def result(self) -> dict[str, Any]:
        return {"ok": False, "reason_code": self.reason_code, "error": str(self), **self.extra}


@dataclass
class Tab:
    id: str
    window_id: str
    tab_id: str
    binding_id: str = ""
    page_key: str = ""
    target_id: str = ""
    title: str = ""
    origin: str = ""
    visible: bool = False
    focused: bool = False
    # ref -> (role, name) from the latest snapshot, to find an element again.
    roles: dict[str, tuple[str, str]] = field(default_factory=dict)
    # CSS pixels per pixel of the last screenshot.
    shot_scale: float = 0.0

    def row(self, url: str = "") -> dict[str, Any]:
        return {"tab": self.id, "title": self.title, "url": url or self.origin,
                "shown": "visible" if self.visible else "background", **({"focused": True} if self.focused else {})}


@dataclass
class _Watch:
    """A page's logs and in-flight requests, recorded from the moment it is first used."""
    console: list[str] = field(default_factory=list)
    network: list[dict[str, Any]] = field(default_factory=list)
    pending: set = field(default_factory=set)
    documents: int = 0


def _target_id(page) -> str:
    session = None
    try:
        session = page.context.new_cdp_session(page)
        info = session.send("Target.getTargetInfo").get("targetInfo") or {}
        return str(info.get("targetId") or "")
    except Exception:
        return ""
    finally:
        if session is not None:
            try:
                session.detach()
            except Exception:
                pass


def _cut(text: str) -> str:
    if len(text) <= SNAPSHOT_LIMIT:
        return text
    return (text[:SNAPSHOT_LIMIT] + f"\n[{len(text) - SNAPSHOT_LIMIT} more characters not shown; scroll, "
            "or act on what is shown and the change comes back]")


def _png_width(image: bytes) -> int:
    if image[:8] != b"\x89PNG\r\n\x1a\n":
        return 0
    return struct.unpack(">I", image[16:20])[0]


def _http_url(url: Any) -> str:
    text = str(url or "").strip()
    if text and "://" not in text and not text.startswith(("about:", "data:")):
        text = "https://" + text
    if urlparse(text).scheme not in {"http", "https", "file"}:
        raise BrowserError("unsupported_url", f"cannot open {text or 'an empty url'}; give an http(s) address")
    return text


class Driver:
    def __init__(self) -> None:
        self._owner = ThreadPoolExecutor(max_workers=1, thread_name_prefix="browser-tabs")
        self._lock = threading.Lock()
        self._tabs: dict[tuple[str, str], Tab] = {}
        self._ids = itertools.count(1)
        self._last: dict[str, str] = {}
        self._playwright = None
        self._browser = None
        self._pages: dict[str, Any] = {}
        self._known: dict[int, str] = {}
        self._watches: dict[str, _Watch] = {}

    # -- the conversation's side: listing, choosing, opening, closing ------

    def run(self, action: str, args: dict[str, Any], session: str) -> dict[str, Any]:
        """One action; a failure is a result with ``ok: False``, never an exception."""
        try:
            if action == "tabs":
                return self._list(session)
            if action == "open":
                return self._open(args, session)
            tab = self._tab(args.get("tab"), session)
            for attempt in (1, 2):
                try:
                    return self._dispatch(tab, action, args)
                except BrowserError as exc:
                    if exc.reason_code != "tab_gone" or attempt == 2:
                        raise
                    # The tab may have moved to another window, or the App restarted.
                    self._refresh()
                    tab = self._find(tab.id)
                    if tab is None:
                        raise BrowserError("tab_closed", "that tab is closed",
                                           tabs=[item.row() for item in self._refresh()]) from None
        except BrowserError as exc:
            return exc.result()
        except pa.ActionError as exc:
            return {"ok": False, "reason_code": exc.reason_code, "error": str(exc)}
        raise AssertionError("unreachable")

    def _dispatch(self, tab: Tab, action: str, args: dict[str, Any]) -> dict[str, Any]:
        if action == "close":
            return self._close(tab)
        if action == "screenshot":
            return self._screenshot(tab)
        result = self._on_owner(self._operate, tab, action, args)
        self._publish(tab, result)
        return result

    def _refresh(self) -> list[Tab]:
        from openprogram.agent import surface_context
        try:
            captured = surface_context.capture_pages_for_listing(surface_context.current())
        except surface_context.DesktopUnavailableError as exc:
            raise BrowserError("app_unavailable", str(exc) or "the OpenProgram App is not connected") from None
        return [self._remember(surface) for surface in captured.get("surfaces") or []
                if isinstance(surface, dict) and surface.get("window_id") and surface.get("tab_id")]

    def _remember(self, surface: dict[str, Any]) -> Tab:
        key = (str(surface["window_id"]), str(surface["tab_id"]))
        with self._lock:
            tab = self._tabs.get(key)
            if tab is None:
                tab = self._tabs[key] = Tab(id=f"t{next(self._ids)}", window_id=key[0], tab_id=key[1])
        tab.binding_id = str(surface.get("binding_id") or tab.binding_id)
        tab.page_key = str(surface.get("page_key") or tab.page_key)
        tab.target_id = str(surface.get("target_id") or tab.target_id)
        tab.title = str(surface.get("title") or "")
        tab.origin = str(surface.get("origin") or "")
        tab.visible = bool(surface.get("visible"))
        tab.focused = bool(surface.get("focused"))
        if not tab.target_id and tab.binding_id:
            from openprogram.webui.ws_actions.webtab import request_bound_tab
            tab.target_id = str(request_bound_tab(tab.binding_id).get("target_id") or "")
        return tab

    def _find(self, name: str) -> Tab | None:
        with self._lock:
            return next((tab for tab in self._tabs.values() if tab.id == name), None)

    def _tab(self, name: Any, session: str) -> Tab:
        """The named tab, else the one this conversation used last, else the focused one."""
        wanted = str(name or "").strip()
        tab = self._find(wanted or self._last.get(session, ""))
        if tab is None:
            listed = self._refresh()
            tab = self._find(wanted) if wanted else (
                self._find(self._last.get(session, ""))
                or next((item for item in listed if item.focused), None)
                or next((item for item in listed if item.visible), None)
                or (listed[0] if listed else None))
            if tab is None:
                message = f"there is no tab {wanted}" if wanted else "no tab is open; open(url) opens one"
                raise BrowserError("tab_not_found", message, tabs=[item.row() for item in listed])
        self._last[session] = tab.id
        return tab

    def _list(self, session: str) -> dict[str, Any]:
        listed = self._refresh()
        urls = self._on_owner(self._urls, listed)
        current = self._last.get(session, "")
        return {"ok": True, "tabs": [{**tab.row(urls.get(tab.id, "")), **({"current": True} if tab.id == current else {})}
                                     for tab in listed]}

    def _open(self, args: dict[str, Any], session: str) -> dict[str, Any]:
        from openprogram.agent import surface_context
        url = _http_url(args.get("url"))
        opened = surface_context.open_page(url, background=not args.get("visible"))
        surfaces = opened.get("surfaces") or []
        if opened.get("ok") is False or not surfaces:
            raise BrowserError(str(opened.get("reason_code") or "open_failed"),
                               str(opened.get("error") or f"the App did not open {url}"))
        tab = self._remember(surfaces[0])
        self._last[session] = tab.id
        result = self._on_owner(self._operate, tab, "read", {"wait_for_load": True})
        self._publish(tab, result)
        return result

    def _close(self, tab: Tab) -> dict[str, Any]:
        from openprogram.webui.ws_actions.webtab import request_close_tab
        closed = request_close_tab(tab.binding_id) if tab.binding_id else {"ok": False}
        if not closed.get("ok"):
            raise BrowserError("tab_gone", str(closed.get("error") or "the App did not close the tab"))
        with self._lock:
            self._tabs.pop((tab.window_id, tab.tab_id), None)
        for session, name in list(self._last.items()):
            if name == tab.id:
                self._last.pop(session, None)
        return {"ok": True, "tab": tab.id, "done": "closed the tab"}

    def _screenshot(self, tab: Tab) -> dict[str, Any]:
        """The tab as the user would see it, captured by the App without bringing it forward."""
        import base64
        from openprogram.webui.ws_actions.webtab import request_bound_screenshot
        captured = request_bound_screenshot(tab.binding_id) if tab.binding_id else {}
        data = str(captured.get("image_data_url") or "")
        if captured.get("ok") and data.startswith("data:image/png;base64,"):
            image = base64.b64decode(data.split(",", 1)[1])
            width = self._on_owner(lambda: self._page(tab).evaluate(_VIEWPORT_WIDTH))
        elif captured.get("reason_code") == "page_context_stale" or not tab.binding_id:
            raise BrowserError("tab_gone", "the tab's binding expired")
        else:
            image, width = self._on_owner(self._page_screenshot, tab)
        pixels = _png_width(image)
        tab.shot_scale = (float(width) / pixels) if pixels and width else 1.0
        return {"ok": True, "tab": tab.id, "done": "took a screenshot; x,y of pointer actions are its pixels",
                "_images": [image]}

    def _page_screenshot(self, tab: Tab) -> tuple[bytes, int]:
        page = self._page(tab)
        return page.screenshot(scale="css", timeout=5000), page.evaluate(_VIEWPORT_WIDTH)

    def _publish(self, tab: Tab, result: dict[str, Any]) -> None:
        """Show the conversation which tab it is operating."""
        if not tab.page_key or not result.get("ok"):
            return
        try:
            from openprogram.browser_resources import publish_bound_page
            publish_bound_page(tab.page_key, window_id=tab.window_id, tab_id=tab.tab_id,
                               title=str(result.get("title") or tab.title), target=str(result.get("url") or ""))
        except Exception:
            pass

    # -- the owner thread: Playwright ---------------------------------------

    def _on_owner(self, function, *args):
        return self._owner.submit(contextvars.copy_context().run, function, *args).result()

    def _connect(self) -> None:
        if self._browser is not None and self._browser.is_connected():
            return
        self._disconnect()
        from playwright.sync_api import sync_playwright
        from openprogram.programs.tools.web.browser._chrome_bootstrap import desktop_app_ws_url
        endpoint = desktop_app_ws_url()
        if not endpoint:
            raise BrowserError("app_unavailable", "the OpenProgram App's browser is not reachable")
        self._playwright = sync_playwright().start()
        try:
            self._browser = self._playwright.chromium.connect_over_cdp(endpoint)
        except Exception as exc:
            self._disconnect()
            raise BrowserError("app_unavailable", f"cannot reach the App's browser ({type(exc).__name__})") from None

    def _disconnect(self) -> None:
        for close in (getattr(self._browser, "close", None), getattr(self._playwright, "stop", None)):
            try:
                if close:
                    close()
            except Exception:
                pass
        self._browser = self._playwright = None
        self._pages.clear()
        self._known.clear()
        self._watches.clear()

    def _page(self, tab: Tab):
        self._connect()
        page = self._pages.get(tab.target_id)
        if page is None or page.is_closed():
            page = self._scan(tab.target_id)
        if page is None:
            # A connection does not always learn of tabs the App opens after it: connect again.
            self._disconnect()
            self._connect()
            page = self._scan(tab.target_id)
        if page is None:
            raise BrowserError("tab_gone", "the tab is no longer in the App")
        if tab.target_id not in self._watches:
            self._watch(page, tab.target_id)
        return page

    def _scan(self, target_id: str):
        for context in self._browser.contexts:
            for candidate in context.pages:
                if id(candidate) not in self._known:
                    target = _target_id(candidate)
                    if target:
                        self._known[id(candidate)] = target
                        self._pages[target] = candidate
        page = self._pages.get(target_id)
        return page if page is not None and not page.is_closed() else None

    def _watch(self, page, target: str) -> None:
        watch = self._watches[target] = _Watch()
        page.set_default_timeout(ACTION_TIMEOUT_MS)

        def keep(items: list, item) -> None:
            items.append(item)
            del items[:-_LOG_LIMIT]

        def request(item) -> None:
            if item.is_navigation_request() and item.frame == page.main_frame:
                watch.documents += 1
            elif item.resource_type in {"fetch", "xhr", "document"}:
                watch.pending.add(item)

        def settled(item, error: str = "") -> None:
            watch.pending.discard(item)
            try:
                status = 0 if error else (item.response().status if item.response() else 0)
            except Exception:
                status = 0
            keep(watch.network, {"method": item.method, "url": item.url, "type": item.resource_type,
                                 "status": status, **({"error": error} if error else {})})

        page.on("console", lambda message: keep(watch.console, f"[{message.type}] {message.text}"))
        page.on("pageerror", lambda error: keep(watch.console, f"[error] {error}"))
        page.on("request", request)
        page.on("requestfinished", settled)
        page.on("requestfailed", lambda item: settled(item, item.failure or "failed"))

    def _urls(self, tabs: list[Tab]) -> dict[str, str]:
        urls = {}
        for tab in tabs:
            try:
                urls[tab.id] = self._page(tab).url
            except BrowserError:
                pass
        return urls

    def _snapshot(self, page, tab: Tab) -> tuple[str, str | None]:
        from openprogram.programs.tools.web.browser._privacy import password_values, redact_password_values
        impl = page._impl_obj
        raw = page._sync(impl._channel.send_return_as_dict(
            "snapshotForAI", impl._timeout_settings.timeout, {"track": _TRACK}))
        full, incremental = str(raw.get("full") or ""), raw.get("incremental")
        tab.roles = {ref: (role, name.replace('\\"', '"')) for role, name, ref in _REF_LINE.findall(full)}
        secrets = password_values(page)
        return redact_password_values(full, secrets), (
            None if incremental is None else redact_password_values(str(incremental), secrets))

    def _state(self, page, tab: Tab, *, full: bool, before_url: str | None = None) -> dict[str, Any]:
        snapshot, changes = self._snapshot(page, tab)
        url = page.url
        try:
            title = page.title()
        except Exception:
            title = tab.title
        out: dict[str, Any] = {"ok": True, "tab": tab.id, "url": url, "title": title}
        tab.title = out["title"] or tab.title
        if full or changes is None or (before_url is not None and url != before_url):
            out["page"] = _cut(snapshot)
        else:
            out["changes"] = _cut(changes)
        return out

    def _locate(self, page, tab: Tab, args: dict[str, Any], prefix: str = ""):
        """The element named by ref, or by role and name; its locator and how to call it."""
        ref = str(args.get(f"{prefix}ref") or "").strip().lstrip("@").removeprefix("ref=")
        role = str(args.get(f"{prefix}role") or "").strip()
        name = str(args.get(f"{prefix}name") or "")
        if ref:
            if not tab.roles:
                self._snapshot(page, tab)
            locator = page.locator(f"aria-ref={ref}")
            if locator.count() == 1:
                return locator, ref
            role, name = tab.roles.get(ref, (role, name))
        if role:
            locator = page.get_by_role(role, name=name, exact=True) if name else page.get_by_role(role)
            count = locator.count()
            if count == 1:
                return locator, f'{role} "{name}"' if name else role
            if count > 1 and not ref:
                raise BrowserError("ambiguous_element", f'{count} elements are {role} "{name}"; use a ref')
        if not ref and not role:
            raise BrowserError("target_required", "name the element with ref (or role and name)")
        raise BrowserError("element_gone", f"{ref or role} is not on the page any more; the page as it is now follows",
                           **self._state(page, tab, full=True))

    def _settle(self, page, watch: _Watch, documents: int, pending: set) -> None:
        """Wait for what the action started: a new document, then its requests (2 s at most)."""
        deadline = time.monotonic() + 0.3
        while time.monotonic() < deadline and watch.documents == documents:
            page.wait_for_timeout(50)
        if watch.documents != documents:
            try:
                page.wait_for_load_state("domcontentloaded", timeout=ACTION_TIMEOUT_MS)
            except Exception:
                pass
        deadline = time.monotonic() + 2
        while watch.pending - pending and time.monotonic() < deadline:
            page.wait_for_timeout(50)

    def _operate(self, tab: Tab, action: str, args: dict[str, Any]) -> dict[str, Any]:
        page = self._page(tab)
        watch = self._watches[tab.target_id]
        if action == "read":
            if args.get("wait_for_load"):
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=ACTION_TIMEOUT_MS)
                except Exception:
                    pass
            return self._state(page, tab, full=not args.get("changes_only"))
        if action in ("console", "network"):
            return self._logs(tab, watch, action, args)
        if action == "evaluate":
            from openprogram.programs.tools.web.browser._privacy import password_values, redact_password_values
            value = page.evaluate(pa.evaluate_source(args))
            return {"ok": True, "tab": tab.id,
                    "result": redact_password_values(pa.evaluation_text(value), password_values(page))}
        before_url, documents, pending = page.url, watch.documents, set(watch.pending)
        try:
            done = self._act(page, tab, action, args)
        except (BrowserError, pa.ActionError):
            raise
        except Exception as exc:
            if page.is_closed():
                raise BrowserError("tab_gone", "the tab closed during the action") from None
            message = str(exc).split("\n", 1)[0]
            raise BrowserError("action_failed", f"{action} failed: {message}",
                               **self._state(page, tab, full=False, before_url=before_url)) from None
        self._settle(page, watch, documents, pending)
        return {**self._state(page, tab, full=False, before_url=before_url), "done": done}

    def _act(self, page, tab: Tab, action: str, args: dict[str, Any]) -> str:
        if action == "navigate":
            url = _http_url(args.get("url"))
            page.goto(url, wait_until="domcontentloaded")
            return f"opened {url}"
        if action in ("back", "forward", "reload"):
            go = {"back": page.go_back, "forward": page.go_forward, "reload": page.reload}[action]
            response = go(wait_until="domcontentloaded")
            if response is None and action != "reload":
                return f"there is no page to go {action} to"
            return {"back": "went back", "forward": "went forward", "reload": "reloaded"}[action]
        if action == "wait":
            seconds = max(0.0, min(float(args.get("seconds") or (10 if args.get("text") else 1)), 30.0))
            text = str(args.get("text") or "")
            if text:
                page.get_by_text(text).first.wait_for(timeout=seconds * 1000)
                return f"{text!r} is on the page"
            page.wait_for_timeout(seconds * 1000)
            return f"waited {seconds:g}s"
        if action == "press":
            key = str(args.get("key") or "").strip()
            if not key:
                raise pa.ActionError("key_required", "press needs key, such as Enter or Control+A")
            if args.get("ref") or args.get("role"):
                locator, label = self._locate(page, tab, args)
                locator.press(key)
                return f"pressed {key} on {label}"
            page.keyboard.press(key)
            return f"pressed {key}"
        if action == "scroll":
            dx, dy = pa.scroll_delta(args)
            if args.get("ref") or args.get("role"):
                locator, label = self._locate(page, tab, args)
                moved = locator.evaluate(pa.SCROLL_SCRIPT, {"dx": dx, "dy": dy})
            else:
                moved = page.evaluate(f"(o) => ({pa.SCROLL_SCRIPT.strip()})(document.documentElement, o)",
                                      {"dx": dx, "dy": dy})
                label = "the page"
            return f"scrolled {label} by ({dx}, {dy})px" + ("" if (moved or {}).get("moved") else "; it did not move")
        if action == "click" and args.get("x") is not None and not args.get("ref") and not args.get("role"):
            return self._click_point(page, tab, args)
        if action == "drag":
            source, label = self._locate(page, tab, args)
            target, to_label = self._locate(page, tab, args, prefix="to_")
            source.drag_to(target)
            return f"dragged {label} to {to_label}"
        if action in ("type", "paste") and not args.get("ref") and not args.get("role"):
            return self._type_into(page, None, "the focused element", action, args)
        locator, label = self._locate(page, tab, args)
        if action == "click":
            click = pa.click_options(args)
            self._show_cursor(page, locator)
            locator.click(**pa.mouse_options(click), **({"modifiers": click["modifiers"]} if click["modifiers"] else {}))
            words = {1: "clicked", 2: "double-clicked", 3: "triple-clicked"}[click["count"]]
            return f"{words} {label}" + (f" with the {click['button']} button" if click["button"] != "left" else "")
        if action == "hover":
            locator.hover()
            return f"hovered {label}"
        if action == "select":
            values = args.get("value")
            values = [str(item) for item in values] if isinstance(values, list) else [str(values or "")]
            if not any(values):
                raise pa.ActionError("value_required", "select needs value, the option's value or label")
            chosen = locator.select_option(values)
            return f"selected {', '.join(chosen) or 'nothing'} in {label}"
        if action in ("type", "paste"):
            return self._type_into(page, locator, label, action, args)
        if action == "upload":
            from ._runtime.file_inputs import file_payload
            payload, problem = file_payload(args.get("path"))
            if problem:
                raise BrowserError(problem["reason_code"], problem["message"])
            locator.set_input_files(payload)
            return f"chose {payload['name']} in {label}"
        raise BrowserError("unknown_action", f"unknown browser action {action!r}")

    def _type_into(self, page, locator, label: str, action: str, args: dict[str, Any]) -> str:
        text = args.get("text")
        if not isinstance(text, str):
            raise pa.ActionError("text_required", f"{action} needs text")
        if action == "paste":
            payload = pa.paste_payload(args)
            target = locator.element_handle() if locator is not None else None
            result = page.evaluate(f"([e, o]) => ({pa.PASTE_SCRIPT.strip()})(e, o)", [target, payload])
            if not (result or {}).get("ok"):
                raise BrowserError("not_editable", f"{label} does not take text")
            return f"pasted {len(text)} character(s) into {label}"
        if locator is None:
            page.keyboard.insert_text(text)
        elif args.get("clear") is False:
            locator.focus()
            page.keyboard.insert_text(text)
        else:
            locator.fill(text)
        done = f"typed {len(text)} character(s) into {label}"
        if args.get("submit"):
            (locator.press if locator is not None else page.keyboard.press)("Enter")
            done += " and pressed Enter"
        return done

    def _click_point(self, page, tab: Tab, args: dict[str, Any]) -> str:
        if not tab.shot_scale:
            raise BrowserError("screenshot_required", "x,y are pixels of a screenshot; take one first, or use a ref")
        click = pa.click_options(args)
        x, y = float(args["x"]) * tab.shot_scale, float(args.get("y") or 0) * tab.shot_scale
        for key in click["modifiers"]:
            page.keyboard.down(key)
        try:
            page.mouse.click(x, y, **pa.mouse_options(click))
        finally:
            for key in reversed(click["modifiers"]):
                page.keyboard.up(key)
        return f"clicked ({args['x']}, {args.get('y')}) of the screenshot"

    def _show_cursor(self, page, locator) -> None:
        """The App's agent cursor, drawn where the click lands."""
        from . import _AGENT_CURSOR_SCRIPT
        try:
            page.evaluate(_AGENT_CURSOR_SCRIPT, True)
            locator.evaluate(_CURSOR_AT_SCRIPT)
        except Exception:
            pass

    def _logs(self, tab: Tab, watch: _Watch, action: str, args: dict[str, Any]) -> dict[str, Any]:
        pattern = str(args.get("pattern") or "")
        limit = max(1, min(int(args.get("limit") or 50), _LOG_LIMIT))
        if action == "console":
            lines = [line for line in watch.console
                     if (not args.get("only_errors") or line.startswith("[error]")) and pattern in line]
            return {"ok": True, "tab": tab.id, "console": lines[-limit:]}
        rows = [row for row in watch.network if pattern in row["url"]
                and (not args.get("only_errors") or row.get("error") or row["status"] >= 400)]
        return {"ok": True, "tab": tab.id, "network": rows[-limit:]}


_driver: Driver | None = None
_driver_lock = threading.Lock()


def driver() -> Driver:
    global _driver
    with _driver_lock:
        if _driver is None:
            _driver = Driver()
        return _driver


ACTIONS = ("tabs", "open", "read", "click", "type", "paste", "select", "press", "hover", "scroll", "drag",
           "upload", "navigate", "back", "forward", "reload", "wait", "screenshot", "console", "network",
           "evaluate", "close")

__all__ = ["ACTIONS", "BrowserError", "Driver", "Tab", "driver"]
