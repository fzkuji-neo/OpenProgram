"""Platform controller."""
from __future__ import annotations
from importlib import import_module

# Bind to this workflow package, including an isolated published snapshot.
state = import_module("..", __package__)


def _safe_observation_id(candidate: str, secrets, used=()) -> str:
    """Keep generated control IDs usable without echoing a known secret."""
    from openprogram.programs.tools.web.browser._privacy import contains_password_value
    if not contains_password_value(candidate, secrets):
        return candidate
    alphabet = [char for char in "abcdefghijklmnopqrstuvwxyz0123456789_-"
                if not contains_password_value(char, secrets)]
    if alphabet:
        for _ in range(64):
            candidate = "".join(alphabet[int(char, 16) % len(alphabet)]
                                for char in state.uuid.uuid4().hex)
            if candidate not in used and not contains_password_value(candidate, secrets):
                return candidate
    raise RuntimeError("Cannot safely identify browser controls")


def _bounded_field_context(context, secrets, budget):
    from openprogram.programs.tools.web.browser._privacy import redact_password_values
    original_binding = context.get("label_binding", {})
    original_label = original_binding.get("label")
    context = redact_password_values(context, secrets)
    binding = context.get("label_binding")
    if isinstance(binding, dict) and isinstance(original_label, str):
        binding["redacted"] = bool(binding.get("redacted")) or binding.get("label") != original_label
        binding["truncated"] = bool(binding.get("truncated")) or len(binding.get("label", "")) > 400
    truncated = bool(context.get("truncated"))
    def bound(value):
        nonlocal truncated
        if isinstance(value, str):
            truncated |= len(value) > 400
            return value[:400]
        if isinstance(value, dict):
            return {key: bound(item) for key, item in value.items()}
        if isinstance(value, list):
            return [bound(item) for item in value]
        return value
    context = bound(context)
    while True:
        context["truncated"] = truncated
        size = len(state.json.dumps(context, ensure_ascii=False).encode("utf-8"))
        if size <= budget:
            return context, budget - size
        if not context.get("ancestors"):
            return None, budget
        context["ancestors"].pop()
        truncated = True


_CONTENTEDITABLE_TYPE_SCRIPT = """async (element, text) => {
    if (!element.isConnected || !element.isContentEditable) return false;
    element.replaceChildren(element.ownerDocument.createTextNode(text));
    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertText', data: text
    }));
    // Observe synchronous handlers and queued editor state updates.
    await new Promise(resolve => setTimeout(resolve, 0));
    return element.isConnected && element.isContentEditable && element.innerText === text;
}"""


class BrowserPageController:
    """One call-scoped browser session and its latest observation refs."""

    def __init__(self, browser_api=None, *, url: str = "", max_steps: int = 20):
        if browser_api is None:
            from openprogram.programs.tools.web.browser import browser as browser_api
        self.browser_api = browser_api
        self.initial_url = url
        self.binding_id = ""
        self.page_revision = 0
        self.access_revision = 0
        self.geometry_revision = 0
        self.max_steps = max(1, int(max_steps))
        self.session_id = ""
        self._frame: dict[str, state.Any] | None = None
        self._frame_identity = None
        self._frame_passwords = ()
        self._refs: dict[str, state.Any] = {}
        self._ref_meta: dict[str, dict[str, state.Any]] = {}
        self._frame_seq = 0
        self._mutations = 0
        self._verified_mutation = -1
        self._evidence: list[dict[str, state.Any]] = []
        self._screenshot_frame = ""
        self._screenshot_viewport: dict[str, state.Any] | None = None
        self._navigation_time_origin: float | None = None
        self._terminal_reason = ""
        self._last_action = ""
        self._last_result: state.Any = None
        self._planner_screenshot_result: state.ToolReturn | None = None
        self._action_seq = 0
        self._owner = state.ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="browser-agent-page",
        )
        self.tool = state.function(
            name="browser_page",
            description=(
                "Control only the exact bound OpenProgram browser Page. Start with "
                "observe. Use screenshot only for visual verification, canvas, "
                "or when DOM/ARIA refs cannot identify the target. Every write "
                "needs the latest frame_id and refs become stale after it. "
                "Editable elements provide their actual value; exact readback "
                "requires value_truncated=false and value_redacted=false."
            ),
            parameters=state._TOOL_PARAMETERS,
            requires_approval=self._requires_approval,
            register_globally=False,
            max_result_chars=100_000,
        )(self.execute)

    def _requires_approval(self, action: str = "", url: str = "", **_kw):
        if action not in {
            "navigate", "click", "type", "press", "scroll", "hover", "select",
        }:
            return False
        if self.binding_id:
            return False
        target_url = url or str((self._frame or {}).get("url") or self.initial_url)
        if state._is_local(target_url):
            return False
        return f"browser action '{action}' changes external origin {state._origin(target_url)}"

    def _ensure_open(self) -> None:
        if self.session_id:
            return
        result = self.browser_api.execute(
            action="open", engine="app", url=self.initial_url or None,
            binding_id=self.binding_id or None,
            expected_page_revision=self.page_revision,
            expected_access_revision=self.access_revision,
            expected_geometry_revision=self.geometry_revision,
        )
        match = state.re.search(r"`(br_[^`]+)`", str(result))
        if not match:
            self._terminal_reason = "target_lost"
            raise RuntimeError(str(result))
        self.session_id = match.group(1)

    def _session(self) -> dict[str, state.Any]:
        self._ensure_open()
        session = self.browser_api._sessions.get(self.session_id)
        if not isinstance(session, dict):
            self._terminal_reason = "target_lost"
            raise RuntimeError("visible browser session was lost")
        return session

    def _page(self):
        session = self._session()
        current = getattr(self.browser_api, "_current_page", None)
        return current(session) if callable(current) else session["page"]

    def evaluate_bound_page(self, expression: str, argument: state.Any = None) -> state.Any:
        """Evaluate against the Page on the controller's Playwright thread."""
        return self._owner.submit(
            self._evaluate_bound_page, expression, argument,
        ).result()

    def _evaluate_bound_page(self, expression: str, argument: state.Any) -> state.Any:
        page = self._page()
        if argument is None:
            return page.evaluate(expression)
        return page.evaluate(expression, argument)

    def capture_observation(self, capture):
        """Redact an upstream capture on the owning Page thread, including frames."""
        def redact():
            from openprogram.programs.tools.web.browser._privacy import password_values, redact_password_values
            page = self._page()
            secrets = password_values(page)
            value = capture()
            return redact_password_values(value, secrets + password_values(page))
        return self._owner.submit(redact).result()

    def set_agent_cursor_armed(self, armed: bool) -> None:
        """Show feedback only for pointer events emitted by one Agent click."""
        self._owner.submit(self._set_agent_cursor_armed, bool(armed)).result()

    def _set_agent_cursor_armed(self, armed: bool) -> None:
        try:
            page = self._page()
        except Exception:
            return
        frames = list(getattr(page, "frames", ()) or ()) or [page]
        for frame in frames:
            with state.suppress(Exception):
                frame.evaluate(state._AGENT_CURSOR_SCRIPT, armed)

    def _agent_click(self, callback) -> None:
        self._set_agent_cursor_armed(True)
        try:
            callback()
        finally:
            self._set_agent_cursor_armed(False)

    def prepare_external_action(self, arguments: state.Mapping[str, state.Any]) -> dict | None:
        """Validate an MCP action without moving Playwright objects off-owner."""
        return self._owner.submit(
            self._prepare_external_action, dict(arguments),
        ).result()

    def _prepare_external_action(self, arguments: dict[str, state.Any]) -> dict | None:
        frame_id = str(arguments.get("expected_frame_id") or "")
        stale = self._require_fresh(frame_id)
        if stale is not None:
            return stale
        action = str(arguments.get("action") or "")
        if action == "click" and not arguments.get("ref"):
            if self._screenshot_frame != frame_id:
                return {"ok": False, "reason_code": "visual_observation_required"}
            try:
                point_x = float(arguments.get("x"))
                point_y = float(arguments.get("y"))
            except (TypeError, ValueError):
                return {"ok": False, "reason_code": "invalid_coordinate"}
            page = self._page()
            viewport = self._viewport(page, page.evaluate(state._VIEWPORT_SCRIPT))
            if viewport != self._screenshot_viewport:
                return self._invalidate_frame()
            if (
                not state.math.isfinite(point_x) or not state.math.isfinite(point_y)
                or point_x < 0 or point_y < 0
                or point_x >= viewport["width"] or point_y >= viewport["height"]
            ):
                return {"ok": False, "reason_code": "invalid_coordinate"}
        return self._write_allowed()

    def invalidate_external_frame(self) -> dict[str, state.Any]:
        return self._owner.submit(self._invalidate_frame).result()

    def record_external_mutation(self, detail: str) -> dict[str, state.Any]:
        return self._owner.submit(self._mutated, detail).result()

    def pointer_scale(self) -> float | None:
        return self._owner.submit(self._pointer_scale).result()

    def hover_external_ref(self, attribute: str, frame_id: str) -> dict:
        return self._owner.submit(self._hover_external_ref, attribute, frame_id).result()

    def clear_external_ref(self, attribute: str) -> None:
        def clear():
            for frame in self._page().frames:
                with state.suppress(Exception):
                    frame.locator(f"[{attribute}]").evaluate_all(
                        "(nodes, attr) => nodes.forEach(n => n.removeAttribute(attr))", attribute,
                    )
        self._owner.submit(clear).result()

    def _hover_external_ref(self, attribute: str, frame_id: str) -> dict:
        page = self._page()
        targets = [frame.locator(f"[{attribute}]") for frame in page.frames]
        try:
            stale = self._require_fresh(frame_id) or self._write_allowed()
            if stale:
                return stale
            matches = [target for target in targets if target.count() == 1]
            scale = self._pointer_scale()
            if len(matches) != 1 or scale is None:
                return self._invalidate_frame()
            target = matches[0]
            target.scroll_into_view_if_needed()
            bounds = target.bounding_box()
            if not bounds:
                return self._invalidate_frame()
            page.mouse.move((bounds["x"] + bounds["width"] / 2) * scale,
                            (bounds["y"] + bounds["height"] / 2) * scale)
            return self._mutated("hovered external reference")
        finally:
            for target in targets:
                with state.suppress(Exception):
                    target.evaluate_all("(nodes, attr) => nodes.forEach(n => n.removeAttribute(attr))", attribute)

    def _pointer_scale(self) -> float | None:
        if not self.binding_id:
            return 1.0
        from openprogram.webui.ws_actions.webtab import request_bound_tab

        result = request_bound_tab(
            self.binding_id,
            expected_page_revision=self.page_revision,
            expected_access_revision=self.access_revision,
            expected_geometry_revision=self.geometry_revision,
        )
        if not result.get("ok"):
            return None
        scale = result.get("input_scale", 1)
        if type(scale) not in (int, float) or not state.math.isfinite(scale) or scale <= 0:
            return None
        return float(scale)

    def _viewport(self, page, snapshot: dict[str, state.Any]) -> dict[str, state.Any]:
        size = page.viewport_size or {}
        return {
            "width": int(size.get("width") or snapshot.get("viewport_width") or 0),
            "height": int(size.get("height") or snapshot.get("viewport_height") or 0),
            "device_scale_factor": snapshot.get("device_scale_factor", 1),
            "scroll_x": snapshot.get("scroll_x", 0),
            "scroll_y": snapshot.get("scroll_y", 0),
        }

    def _observe(self) -> dict[str, state.Any]:
        from openprogram.programs.tools.web.browser._privacy import password_values, redact_password_values
        page = self._page()
        secrets = password_values(page)
        snapshot = page.evaluate(state._OBSERVE_SCRIPT)
        if not isinstance(snapshot, dict):
            raise RuntimeError("browser observation did not return an object")
        self._frame_seq += 1
        frame_id = f"frame_{self._frame_seq}_{state.uuid.uuid4().hex[:8]}"
        handles_array = page.evaluate_handle(state._CAPTURE_HANDLES_SCRIPT)
        elements = []
        value_budget = 32768  # UTF-8 bytes across editable fields in this frame.
        context_budget = 32768  # UTF-8 JSON bytes across diagnostic contexts.
        refs = {}
        ref_meta = {}
        try:
            # The browser selects at most 120 visible nodes in one page-side
            # operation. JSHandle properties preserve those exact nodes while
            # avoiding an unbounded element_handles() materialization.
            for key, js_handle in handles_array.get_properties().items():
                if not key.isdigit():
                    continue
                handle = js_handle.as_element()
                if handle is None:
                    continue
                try:
                    actual = handle.evaluate(state._REF_SNAPSHOT_SCRIPT)
                except Exception:
                    handle.dispose()
                    continue
                if (
                    not isinstance(actual, dict)
                    or not actual.get("connected")
                    or not actual.get("visible")
                ):
                    handle.dispose()
                    continue
                ref = f"e{len(elements) + 1}"
                metadata = {
                    "ref": ref,
                    "tag": str(actual.get("tag") or "element"),
                    "role": str(actual.get("role") or actual.get("tag") or "element"),
                    "name": str(actual.get("name") or ""),
                    "disabled": bool(actual.get("disabled")),
                }
                for field in ("label", "value", "value_source", "value_truncated", "value_redacted", "field_context"):
                    if field in actual:
                        metadata[field] = actual[field]
                refs[ref] = handle
                ref_meta[ref] = {
                    field: metadata[field]
                    for field in ("tag", "role", "name", "disabled")
                }
                ref_meta[ref]["label"] = actual.get("label")
                ref_meta[ref]["native_label_identity"] = actual.get("native_label_identity")
                ref_meta[ref]["label_binding"] = (actual.get("field_context") or {}).get("label_binding")
                try:
                    ref_meta[ref]["bounds"] = {
                        "x": float(actual["x"]), "y": float(actual["y"]),
                        "width": float(actual["width"]), "height": float(actual["height"]),
                    }
                except (KeyError, TypeError, ValueError):
                    pass
                elements.append({
                    field: value
                    for field, value in metadata.items()
                    if field != "tag"
                })
        finally:
            handles_array.dispose()
        try:
            aria = page.locator("body").aria_snapshot() or ""
        except Exception:
            aria = ""
        session = self._session()
        frame_identity = (page.url, session.get("app_tab_id"), session.get("app_target_id"))
        frame = {
            "frame_id": frame_id,
            "url": page.url,
            "origin": state._origin(page.url),
            "title": page.title(),
            "target": {
                "kind": "web_tab",
                "tab_id": session.get("app_tab_id"),
                "target_id": session.get("app_target_id"),
            },
            "viewport": self._viewport(page, snapshot),
            "text": str(snapshot.get("text") or ""),
            "aria_snapshot": aria,
            "elements": elements,
        }
        try:
            secrets += password_values(page)
            frame["frame_id"] = _safe_observation_id(frame_id, secrets)
            for element in elements:
                original = element["ref"]
                ref = _safe_observation_id(original, secrets, refs)
                if ref != original:
                    refs[ref] = refs.pop(original)
                    ref_meta[ref] = ref_meta.pop(original)
                    element["ref"] = ref
            for element in elements:
                value = element.get("value")
                if isinstance(value, str) and redact_password_values(value, secrets) != value:
                    del element["value"]
                    element["value_redacted"] = True
                    if element.get("name") and value.startswith(element["name"]):
                        element["name"] = "[redacted]"
                elif isinstance(value, str):
                    # Redact the full host-local value before truncating it:
                    # cutting a long secret first would expose its prefix.
                    value = value[:8192]
                    encoded = value.encode("utf-8")
                    if len(encoded) > value_budget:
                        value = encoded[:value_budget].decode("utf-8", errors="ignore")
                    element["value_truncated"] = value != element["value"]
                    element["value"] = value
                    value_budget -= len(value.encode("utf-8"))
                context = element.get("field_context")
                if isinstance(context, dict):
                    context, context_budget = _bounded_field_context(context, secrets, context_budget)
                    element["field_context_truncated"] = context is None or bool(context.get("truncated"))
                    if context is None:
                        del element["field_context"]
                    else:
                        element["field_context"] = context
            frame = redact_password_values(frame, secrets)
            frame["text"] = frame["text"][:12000]
            if len(frame["aria_snapshot"]) > 12000:
                frame["aria_snapshot"] = frame["aria_snapshot"][:12000] + "\n[truncated]"
        except BaseException:
            for handle in refs.values():
                with state.suppress(Exception):
                    handle.dispose()
            raise
        self._frame = frame
        self._frame_identity = frame_identity
        self._frame_passwords = secrets
        try:
            self._navigation_time_origin = float(snapshot.get("navigation_time_origin"))
        except (TypeError, ValueError):
            self._navigation_time_origin = None
        self._dispose_refs()
        self._refs = refs
        self._ref_meta = ref_meta
        self._screenshot_frame = ""
        self._screenshot_viewport = None
        return frame

    def _fresh(self, expected_frame_id: str) -> bool:
        if not self._frame or expected_frame_id != self._frame["frame_id"]:
            return False
        page = self._page()
        session = self._session()
        if (page.url, session.get("app_tab_id"), session.get("app_target_id")) != self._frame_identity:
            return False
        if self._navigation_time_origin is not None:
            try:
                current = float(page.evaluate(state._VIEWPORT_SCRIPT).get("navigation_time_origin"))
            except (AttributeError, TypeError, ValueError):
                return False
            if current != self._navigation_time_origin:
                return False
        return True

    def _require_fresh(self, expected_frame_id: str) -> dict[str, state.Any] | None:
        if self._fresh(expected_frame_id):
            return None
        return self._invalidate_frame()

    def _invalidate_frame(self) -> dict[str, state.Any]:
        self._frame = None
        self._dispose_refs()
        self._ref_meta = {}
        self._screenshot_frame = ""
        self._screenshot_viewport = None
        self._navigation_time_origin = None
        return {"ok": False, "reason_code": "stale_observation"}

    def _ref(self, ref: str):
        key = (ref or "").lstrip("@")
        target = self._refs.get(key)
        expected = self._ref_meta.get(key)
        if target is None or expected is None:
            return None, "ref_not_found"
        try:
            actual = target.evaluate(state._REF_SNAPSHOT_SCRIPT)
        except Exception:
            return None, "stale_observation"
        if (
            not isinstance(actual, dict)
            or not actual.get("connected")
            or not actual.get("visible")
            or any(
                actual.get(field) != expected.get(field)
                for field in ("tag", "role", "name", "disabled", "label", "native_label_identity")
            )
            or (actual.get("field_context") or {}).get("label_binding") != expected.get("label_binding")
        ):
            return None, "stale_observation"
        return target, None

    def _mutated(self, detail: str, *, point: dict | None = None) -> dict[str, state.Any]:
        from openprogram.programs.tools.web.browser._privacy import password_values, redact_password_values
        secrets = self._frame_passwords
        identity: dict[str, state.Any] = {}
        try:
            page = self._page()
            secrets += password_values(page)
            session = self._session()
            identity = {
                "url": page.url,
                "title": page.title(),
                "target": {
                    "kind": "web_tab",
                    "tab_id": session.get("app_tab_id"),
                    "target_id": session.get("app_target_id"),
                },
            }
            secrets += password_values(page)
        except Exception:
            identity = {}
        self._mutations += 1
        self._frame = None
        self._dispose_refs()
        self._ref_meta = {}
        self._screenshot_frame = ""
        self._screenshot_viewport = None
        self._navigation_time_origin = None
        payload = {"ok": True, "detail": detail, "observe_required": True, **identity}
        if point is not None:
            payload["point"] = point
        return redact_password_values(payload, secrets)

    def _write_allowed(self) -> dict[str, state.Any] | None:
        if self._mutations < self.max_steps:
            return None
        self._terminal_reason = "step_limit"
        return {"ok": False, "reason_code": "step_limit"}

    def execute(
        self,
        action: str,
        expected_frame_id: str = "",
        ref: str = "",
        url: str = "",
        text: str = "",
        key: str = "",
        value: str = "",
        amount: int = 500,
        assertion: str = "",
        x: float | None = None,
        y: float | None = None,
        *, before_dispatch=None,
    ) -> state.Any:
        def dispatch():
            if before_dispatch is not None:
                before_dispatch()
            kwargs = {"before_dispatch": before_dispatch} if before_dispatch is not None else {}
            return self._execute(action, expected_frame_id, ref, url, text, key,
                                 value, amount, assertion, x, y, **kwargs)
        result = self._owner.submit(state.copy_context().run, dispatch).result()
        self._last_action = action
        self._last_result = result
        self._action_seq += 1
        return result

    def _dispose_refs(self) -> None:
        refs, self._refs = self._refs, {}
        for handle in refs.values():
            try:
                handle.dispose()
            except Exception:
                pass

    def tool_for_actions(self, actions: list[str]):
        action_schema = {
            **state._TOOL_PARAMETERS["properties"]["action"],
            "enum": list(actions),
        }
        parameters = {
            **state._TOOL_PARAMETERS,
            "properties": {
                **state._TOOL_PARAMETERS["properties"],
                "action": action_schema,
            },
        }
        def dispatch(**arguments):
            result = self.execute(**arguments)
            if isinstance(result, state.ToolReturn) and result.images:
                self._planner_screenshot_result = result
            return state._result_for_prompt(result)

        return state.function(
            name="browser_page",
            description=(
                "Act on or verify the current Runtime observation for the exact "
                "bound OpenProgram Page. Observe is Runtime-owned and is not "
                "available in this planner request."
            ),
            parameters=parameters,
            requires_approval=self._requires_approval,
            register_globally=False,
            max_result_chars=40_000,
        )(dispatch)

    def revoke_screenshot(self) -> None:
        self._owner.submit(self._revoke_screenshot).result()

    def _revoke_screenshot(self) -> None:
        self._screenshot_frame = ""
        self._screenshot_viewport = None

    def _execute(
        self,
        action: str,
        expected_frame_id: str = "",
        ref: str = "",
        url: str = "",
        text: str = "",
        key: str = "",
        value: str = "",
        amount: int = 500,
        assertion: str = "",
        x: float | None = None,
        y: float | None = None,
        *, before_dispatch=None,
    ) -> state.Any:
        def run(fn, *args, **kwargs):
            if before_dispatch is not None:
                before_dispatch()
            return fn(*args, **kwargs)

        if action == "observe":
            return run(self._observe)
        if action in {"screenshot", "verify"} and not expected_frame_id and self._frame:
            expected_frame_id = self._frame["frame_id"]
        if action == "verify":
            # A new verification attempt replaces earlier completion authority,
            # including rejected arguments and stale observations.
            self._evidence = []
            self._verified_mutation = -1
            if not self._fresh(expected_frame_id):
                return {"ok": False, "reason_code": "stale_observation"}
            if not assertion or not isinstance(value, str) or not value.strip():
                return {"ok": False, "reason_code": "invalid_assertion"}
            return run(self._verify, self._page(), expected_frame_id, assertion, value)
        stale = self._require_fresh(expected_frame_id)
        if stale:
            return stale
        page = self._page()
        if action == "screenshot":
            if self._screenshot_frame == expected_frame_id:
                return {"ok": False, "reason_code": "screenshot_already_captured"}
            # Keep image pixels equal to viewport CSS pixels so a model point
            # can be passed directly to Playwright mouse coordinates even on
            # Retina / device_scale_factor != 1 displays.
            before = page.evaluate(state._VIEWPORT_SCRIPT)
            if self.binding_id:
                from openprogram.webui.ws_actions.webtab import (
                    request_bound_screenshot,
                )

                capture = run(request_bound_screenshot,
                    self.binding_id,
                    timeout=5.0,
                    expected_page_revision=self.page_revision,
                    expected_access_revision=self.access_revision,
                    expected_geometry_revision=self.geometry_revision,
                )
                image_data_url = str(capture.get("image_data_url") or "")
                if not capture.get("ok") or not image_data_url.startswith(
                    "data:image/png;base64,"
                ):
                    return {
                        "ok": False,
                        "reason_code": str(
                            capture.get("reason_code") or "screenshot_failed"
                        ),
                    }
                try:
                    image = state.base64.b64decode(
                        image_data_url.split(",", 1)[1], validate=True,
                    )
                except (ValueError, TypeError):
                    return {"ok": False, "reason_code": "screenshot_failed"}
            else:
                image = run(page.screenshot, full_page=False, scale="css")
            after = page.evaluate(state._VIEWPORT_SCRIPT)
            if before != after or not self._fresh(expected_frame_id):
                return self._invalidate_frame()
            self._screenshot_frame = expected_frame_id
            self._screenshot_viewport = self._viewport(page, after)
            return state.ToolReturn(
                text=f"Current viewport screenshot for {expected_frame_id}.",
                images=[image],
                json_data={
                    "frame_id": expected_frame_id,
                    "viewport": dict(self._screenshot_viewport),
                },
            )
        if action == "wait":
            run(page.wait_for_timeout, max(0, min(int(amount), 5000)))
            return {"ok": True, "frame_id": expected_frame_id}
        capped = self._write_allowed()
        if capped:
            return capped
        if action == "navigate":
            if not state._is_http_url(url):
                return {"ok": False, "reason_code": "unsupported_url"}
            run(page.goto, url)
            return self._mutated(f"navigated to {url}")
        if action == "scroll":
            scale = self._pointer_scale()
            if scale is None:
                return self._invalidate_frame()
            run(page.mouse.wheel, 0, int(amount))
            return self._mutated(f"scrolled {int(amount)}px")
        if action == "click":
            if not ref:
                if x is None or y is None:
                    return {"ok": False, "reason_code": "target_required"}
                if self._screenshot_frame != expected_frame_id:
                    return {"ok": False, "reason_code": "visual_observation_required"}
                try:
                    point_x, point_y = float(x), float(y)
                except (TypeError, ValueError):
                    return {"ok": False, "reason_code": "invalid_coordinate"}
                viewport = self._viewport(page, page.evaluate(state._VIEWPORT_SCRIPT))
                if viewport != self._screenshot_viewport:
                    return self._invalidate_frame()
                if (
                    not state.math.isfinite(point_x) or not state.math.isfinite(point_y)
                    or point_x < 0 or point_y < 0
                    or point_x >= viewport["width"] or point_y >= viewport["height"]
                ):
                    return {"ok": False, "reason_code": "invalid_coordinate"}
                scale = self._pointer_scale()
                if scale is None:
                    return self._invalidate_frame()
                self._agent_click(lambda: run(page.mouse.click, point_x * scale, point_y * scale))
                return self._mutated(
                    f"clicked viewport point ({point_x:g}, {point_y:g})",
                    point={"x": point_x, "y": point_y, "width": 0, "height": 0},
                )
        target, ref_error = self._ref(ref)
        if target is None:
            if ref_error == "stale_observation":
                return self._invalidate_frame()
            return {"ok": False, "reason_code": ref_error}
        if action == "click":
            if self._ref_meta.get((ref or "").lstrip("@"), {}).get("disabled"):
                return {"ok": False, "reason_code": "target_disabled"}
            if self.binding_id:
                self._agent_click(
                    lambda: run(target.evaluate, state._BACKGROUND_REF_CLICK_SCRIPT)
                )
            else:
                self._agent_click(lambda: run(target.click))
            bounds = (self._ref_meta.get((ref or "").lstrip("@")) or {}).get("bounds")
            return self._mutated(
                f"clicked {ref}",
                point=dict(bounds) if isinstance(bounds, dict) else None,
            )
        if action == "type":
            editable = run(lambda: target.evaluate("element => element.isContentEditable"))
            if editable is True:
                # Keep native editable/visibility checks and focus; clearing avoids
                # Chromium paragraph nodes adding a rendered newline to blank lines.
                try:
                    run(target.fill, "")
                    exact = run(target.evaluate, _CONTENTEDITABLE_TYPE_SCRIPT, text)
                except BaseException:
                    self._mutated(f"unconfirmed type into {ref}")
                    raise
                result = self._mutated(f"typed {len(text)} character(s) into {ref}")
                if exact is not True:
                    result.update(ok=False, reason_code="editable_value_mismatch")
                return result
            run(target.fill, text)
            return self._mutated(f"typed {len(text)} character(s) into {ref}")
        if action == "press":
            run(target.press, key)
            return self._mutated(f"pressed {key} on {ref}")
        if action == "hover":
            scale = self._pointer_scale()
            if scale is None:
                return self._invalidate_frame()
            if scale == 1:
                run(target.hover)
            else:
                run(target.scroll_into_view_if_needed)
                bounds = target.bounding_box()
                if not bounds:
                    return self._invalidate_frame()
                run(page.mouse.move, (bounds["x"] + bounds["width"] / 2) * scale,
                    (bounds["y"] + bounds["height"] / 2) * scale)
            return self._mutated(f"hovered {ref}")
        if action == "select":
            run(target.select_option, value)
            return self._mutated(f"selected an option in {ref}")
        return {"ok": False, "reason_code": "unsupported_action"}

    def _verify(self, page, frame_id: str, assertion: str, value: str) -> dict:
        from openprogram.programs.tools.web.browser._privacy import contains_password_value, password_values, redact_password_values
        secrets = password_values(page)
        if contains_password_value(value, secrets):
            return {"ok": False, "passed": False, "reason_code": "sensitive_assertion"}
        # Assertions evaluate the real Page. Redaction is an output policy;
        # it must never turn a visible secret into a successful absence check.
        text = page.inner_text("body")
        snapshot = page.evaluate(state._OBSERVE_SCRIPT)
        checks = {
            "text_contains": value in text,
            "text_not_contains": value not in text,
            "url_contains": value in page.url,
            "title_contains": value in page.title(),
            "element_present": any(
                value.casefold() in str(item.get("name") or "").casefold()
                for item in snapshot.get("elements") or []
            ),
        }
        if assertion not in checks:
            return {"ok": False, "reason_code": "unsupported_assertion"}
        passed = bool(checks[assertion])
        evidence = {
            "kind": "assertion",
            "assertion": assertion,
            "value": value,
            "frame_id": frame_id,
            "passed": passed,
        }
        if not self._fresh(frame_id):
            return self._invalidate_frame()
        if passed:
            self._verified_mutation = self._mutations
            self._evidence = [evidence]
        return redact_password_values({"ok": True, "passed": passed, "evidence": evidence}, secrets)

    def final_result(self, *, summary: str, reason_code: str | None = None) -> dict:
        return self._owner.submit(
            self._final_result,
            summary=summary,
            reason_code=reason_code,
        ).result()

    def _final_result(self, *, summary: str, reason_code: str | None = None) -> dict:
        from openprogram.programs.tools.web.browser._privacy import password_values, redact_password_values
        secrets = ()
        privacy_failed = False
        if self.session_id:
            try:
                secrets = password_values(self._page())
            except Exception:
                privacy_failed = True
                summary = "Browser target is unavailable."
        verified = bool(self._evidence) and self._verified_mutation == self._mutations
        if privacy_failed:
            verified = False
            self._evidence = []
            self._verified_mutation = -1
        if verified:
            evidence = self._evidence[-1]
            # Human input and asynchronous Page updates do not increment the
            # controller's mutation counter. Recheck the exact document and
            # assertion before delivering a successful task result.
            self._evidence = []
            self._verified_mutation = -1
            try:
                frame_id = evidence["frame_id"]
                verified = self._fresh(frame_id) and self._verify(
                    self._page(), frame_id, evidence["assertion"], evidence["value"],
                ).get("passed") is True
            except Exception:
                verified = False
        reason = reason_code or self._terminal_reason or (
            "verified" if verified else "verification_missing"
        )
        status = "cancelled" if reason == "cancelled" else (
            "succeeded" if verified and reason == "verified" else "failed"
        )
        if privacy_failed:
            reason = "observation_privacy_unavailable"
            status = "failed"
        target = {"kind": "web_tab", "tab_id": None, "url": ""}
        if self.session_id and not privacy_failed:
            try:
                session = self._session()
                target.update({
                    "tab_id": session.get("app_tab_id"),
                    "url": self._page().url,
                })
            except Exception:
                reason = "target_lost"
                status = "failed"
        return redact_password_values({
            "status": status,
            "reason_code": reason,
            "summary": summary,
            "target": target,
            "steps_taken": self._mutations,
            "completion_evidence": list(self._evidence) if verified else [],
            "artifacts": [],
        }, secrets)

    def close(self) -> str | None:
        try:
            return self._owner.submit(self._close).result()
        finally:
            self._owner.shutdown(wait=True)

    def _close(self) -> str | None:
        session_id, self.session_id = self.session_id, ""
        self._frame = None
        self._frame_identity = None
        self._frame_passwords = ()
        self._dispose_refs()
        self._ref_meta = {}
        self._screenshot_frame = ""
        self._screenshot_viewport = None
        self._navigation_time_origin = None
        if not session_id:
            return None
        try:
            result = str(self.browser_api.execute(
                action="close", session_id=session_id,
            ))
        except Exception as exc:
            return f"{type(exc).__name__}: {exc}"
        if result.startswith("Error:") or " with warnings:" in result:
            return result
        return None
