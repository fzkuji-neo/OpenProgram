# Computer and browser use

OpenProgram gives the model two tools for things that happen on a screen. `web_use` drives web pages in the App's built-in browser and the headless Chromium; `computer_use` drives any other macOS application in the background. This record explains why there are exactly two, how `computer_use` is built, and what the two still lack against Codex and the Claude desktop app.

## Why two tools, and why these two

Codex (ChatGPT.app) exposes one tool, `cua_repl`: the model writes JavaScript against a `cua` object whose targets — an app from `cua.getApp(name)` or a tab from `cua.createBrowserTab(...)` — share one API (`getAXState`, `click`, `drag`, `scroll`, `selectText`, `setValue`, `performSecondaryAction`, plus `paste`, `pressKey`, `typeText` for apps). Which backend handles a target is fixed by the target kind, not chosen by the model.

The Claude desktop app exposes many tools in groups: `app_*` for background control of one application (list windows, screenshot, zoom, click, type, key, scroll, drag, menu, AX find, focus, batch), a display-scope "full control" set that takes over the real pointer and keyboard, browser tools, `framebuffer_*` for virtual machines, and a request/release pair per application.

OpenProgram takes Codex's shape and the Claude app's vocabulary:

- **One tool per surface, structured arguments.** The model does not write code to drive a window. `computer_use(action=…, app=…, …)` and `web_use(command=…, …)` are ordinary function calls with a JSON schema, which is what the rest of the harness — approval cards, permission rules, tool presentation, deferral — already understands.
- **No backend selection by the model.** A web page is a `web_use` target, an application is a `computer_use` target. The old GUI Agent plan of a planner that picks among desktop, browser and VM backends is not needed for ordinary tasks; its workflow stays as it is and is not the entry point for these tools.
- **Everything in the background.** Element actions through the Accessibility API and pointer events routed to a process do not move the user's cursor, change the key window or raise a window. A foreground "full control" tier like the Claude app's is deliberately absent: the background route already covers coordinate clicks, drags and wheel scrolls.
- **Approval per application.** The unit the user reasons about is "may it touch Notes", not "may it click". The rule is `computer_use(<app>)`, and it can be granted once, for the conversation, or for the project.

## `computer_use`

### Shape

```
computer_use(action, app, element_index | x,y, …)
```

Actions come in three groups:

- **Reading:** `list_apps`, `list_windows`, `get_app_state` (`include` = all / tree / screenshot, `window` or `window_id`), `zoom` (a region of the last screenshot at full pixel density), `find` (text and role search over the last tree).
- **Acting**, Codex's target API: `click` (button, count, held modifiers, hold duration), `type_text`, `press_key`, `set_value`, `scroll` (pages or pixels), `drag`, `perform_secondary_action`, `select_text`, `paste`; and from the Claude app's `app_*` set: `copy`, `focus`, `menu`, `show_window`.
- **`batch`:** up to 20 acting steps on one app, in order, stopping at the first error; one settle and one state at the end.

Only `list_apps` is approval-free. A batch step cannot name a different app, because the approval the call carries names only the batch's app.

Every acting call returns `Done: <summary>` followed by the Accessibility tree **diff** against the state the model last saw: `- line` for elements that vanished, `+ index line` for new or changed ones. When more than half the lines (and at least twelve) changed, the whole tree is returned instead, because a diff of a rebuilt view is longer than the view. `get_app_state(full=true)` returns the full tree on demand. The tree is capped at 1500 nodes and rendered one element per line: index, role (`AXTextField` → `text field`, with the subrole in parentheses), label, value, placeholder, flags (`focused`, `selected`, `checked`, `disabled`, `secure`, `settable` …) and the element's secondary actions other than the primary press. Bidirectional marks some apps wrap numbers in are dropped from the rendering and from `find`.

The tree covers the window, the menus, popovers and dialogs beside it, and the menu bar with only open menus expanded. Closed menus are read by the `menu` action, so every read covers the same ground and a diff never shows a whole menu bar appearing or vanishing.

Results that changed nothing are marked: `menu` listings, `copy` and an already-visible `show_window` return a `Report`, and the tool returns it without settling or reading the state again.

### Stable indices

`tree.number` gives indices against the window's previous `Snapshot` (its index-free lines, their indices, and the next unused index). A line that is equal, or replaced by a line of the same depth and role (a new value, a renamed button), keeps its index; any other new line takes the next unused index. Indices freed by removed elements are never reused. The model's earlier indices therefore never point at a different element after an insertion above them, which Codex's positional numbering does not guarantee.

### Settling

After an action the tool polls a cheap fingerprint of the first 400 elements every 0.2 seconds, starting after 0.3 seconds, and stops when two fingerprints agree, after 1.5 seconds, or after 5 seconds while a busy indicator or an unfinished progress indicator is present — Codex's "about a second, up to five while loading".

### Menu bar

`menu` walks `AXMenuBar` by title, case-insensitively and ignoring a trailing `…` or `...`. A path that ends at a submenu lists its items with shortcut glyphs (`⌃⌥⇧⌘` from `AXMenuItemCmdModifiers`), `[checked]` and `[disabled]`; a leaf is pressed with `AXPress`. Reading the menu tree through Accessibility opens nothing on screen. `copy` presses the app's own menu item whose shortcut is ⌘C, found by shortcut rather than by its localized title, and falls back to posting ⌘C; when that item exists but is disabled (nothing selected, or focus on a control) it reports so at once. Otherwise it waits for the pasteboard change count, reads the string, and restores the previous pasteboard.

`copy`, `press_key`, `type_text` and `paste` without an `element_index` act on the app's current focus and need no earlier `get_app_state`; `menu`, `show_window` and `wait` never need one. From Claude's computer-use tool come `hover` (three `mouseMoved` events posted to the process, approaching the point, then a 0.8-second rest; the real cursor stays put) and `wait` (up to 10 seconds, cancellable, followed by the usual settle and tree diff). `focus` sets `AXFocused` and waits up to half a second for the app to report it, since apps apply focus on a later run-loop turn.

The screenshot is the window's own image captured through ScreenCaptureKit, scaled so the long side is at most 1568 pixels; coordinates the model sends are pixels of that image and are mapped back to screen points with the scale that produced it.

### Text on the screenshot

A window whose own walk yields fewer than 12 elements (frame, title bar buttons and little else) is drawn without Accessibility. For such a window every full or screenshot-only read also runs Vision's accurate text recognizer on the screenshot it just took and lists each line as `"text" at (cx, cy), WxH` in screenshot pixels, top to bottom and left to right, at most 150 lines. The first recognition language picks Vision's model, so the languages are a hint (the user's preferred languages, then Chinese, Japanese, Korean and English) and language detection chooses per image. `find` with `text` falls back to these lines when no element matches; for a window that was not sparse it captures and reads the window once at the same scale, so the positions stay valid for actions. OCR text has no indices and is not part of the tree diff: it is evidence for coordinate actions, and a failure of the recognizer leaves the read without it.

### Audio

Codex records computer audio with `start_audio_recording` / `stop_audio_recording` (60 seconds by default, 300 at most) and hands the clip to the model as audio input. OpenProgram keeps the two actions and their limits. Most providers it drives take no audio in a tool result, so the clip becomes a WAV on disk plus a transcript from the Settings → Voice engine, which every model can read. `audio.py` opens an `SCStream` whose filter is the display with only the target application included, asks for 16 kHz mono float samples, excludes the OpenProgram process, and attaches only an audio output: the 2×2, one-frame-a-second video side is never consumed. Samples past the limit are dropped and a timer stops the stream half a second after it, so a forgotten recording releases the capture. One recording runs per conversation; it is converted to 16-bit PCM on stop and saved under the state directory, keeping the newest 20. The action keeps the per-application approval: only the named app's sound is in the clip. A clip whose peak stays under 1e-4 is reported silent and not transcribed. An application without a window has no `SCRunningApplication` and cannot be recorded.

### Module layout

| Module | Role |
|---|---|
| `openprogram/computer_use/keys.py` | xdotool chord parsing to macOS key codes and modifier flags (`super+shift+z`, `ctrl++`, `KP_0`, lone modifiers) |
| `openprogram/computer_use/tree.py` | `Node`, rendering, signatures, stable numbering (`Snapshot`, `number`) and the diff |
| `openprogram/computer_use/audio.py` | ScreenCaptureKit audio capture of one application, sample limit, WAV encoding |
| `openprogram/computer_use/ocr.py` | Vision text recognition, box conversion to screenshot pixels, reading order, language hints |
| `openprogram/computer_use/skylight.py` | ctypes bindings to SkyLight for background pointer and keyboard routing |
| `openprogram/computer_use/macos.py` | `MacComputer`: app resolution, window selection, capture, tree walk, every action |
| `openprogram/programs/tools/system/computer_use.py` | the registered tool: schema, description with the confirmation policy, approval reason, batch, result assembly |

### Background delivery

Element actions go through Accessibility: `AXPress` / `AXConfirm` / `AXPick`, then `AXSelected`, then focus, then a pointer click at the element's centre as the last resort; `AXShowMenu` for right clicks; `AXValue` for `set_value`; `AXSelectedTextRange` (UTF-16 offsets) for `select_text`; page scrolling actions, then the scrollbar's value, then wheel events for `scroll`.

Pointer events that have to be real (coordinate clicks, drags, wheel) are posted with the recipe the open-source cua-driver established: a focus-without-raise record posted to the target process serial number, a `mouseMoved` primer, the event stamped with click state, button, subtype 3, target pid, window id and a click group, `CGEventSetWindowLocation` for the window-relative position, and `SLEventPostToPid` for delivery. Keyboard events carry an `SLSEventAuthenticationMessage` so the receiving process accepts them; without SkyLight the code falls back to `CGEventPostToPid`. The result is a click the application handles as if the user clicked, while the real cursor stays where it is and the front application does not change.

A window is chosen by `window` (title substring or index) or `window_id`; without either, the window the model read last stays selected while it is open, then the focused or main window. A minimized window or a hidden app still gives its tree; the screenshot is unavailable until `show_window` un-minimizes it (`AXMinimized`) or unhides the app, neither of which activates it. A window on another Space is reported as such and is not moved.

`paste` writes the pasteboard (plain text, or HTML rendered from Markdown with `markdown-it`), sends Cmd+V to the target process, and restores the previous pasteboard contents when the change count shows nothing else wrote in between.

### Refusals

The tool never types into `AXSecureTextField` elements or while macOS reports secure keyboard input (`kCGSSessionSecureInputPID`), and refuses to target Keychain Access, Passwords, loginwindow, SecurityAgent and OpenProgram's own bundles. The refusal is returned as an error that asks the user to do the step; no approval scope overrides it.

### Permissions and approval

`requires_approval` returns `computer_use controls <app>` for every action except `list_apps`. `parse_command` reduces a call to its normalised application name, so `exact_rule_for_call` yields `computer_use(calculator)` and `rule_to_string` prints it in the usual form. The approval card offers four scopes:

| Scope | Where the rule is saved |
|---|---|
| once | nowhere |
| session | the session's run config (`permission_rules.allow`) — `computer_use` is the first tool in `_SESSION_SCOPE_TOOLS` |
| always | the project rules |
| deny | nowhere |

The grant is mandatory in every permission mode. `permission_decision` treats `computer_use` as an app-grant tool (`_APP_GRANT_TOOLS`): when the tool's own `requires_approval` says the call needs approval and no allow rule names the application, the decision is `ask` with reason `APP_GRANT_REQUIRED`, before Auto classification or Bypass is consulted. Unattended sources therefore deny such calls, and an allow rule is the only way past the card.

Permission rules are reloaded at every operation boundary (global < project < session), so a session rule applies to the next call without a restart.

System access: `computer_use:desktop` is an operation of both the `accessibility` and `screen_recording` capabilities; `_desktop_operation` maps every call except `list_apps` to it, so a missing grant pauses the call with the standard "waiting" state and the Settings → System access flow, exactly like the GUI Agent's desktop surface.

The tool is in `DEFAULT_TOOLS` but deferred (`DEFERRED_DEFAULT_TOOLS`): its schema sits in the catalog until the model loads it. `unsafe_in` hides it in WeChat and Telegram channels and in plan mode.

### Web presentation

`tool-presentation.ts` renders `computer_use` calls with the monitor icon and the system tone; the title names the action and the application ("Clicked in Calculator"), the target line shows the key, text, action name or window where one is given. The approval card's scope buttons add "Allow this conversation" between once and always, and the answer summary prints "Allowed for this conversation". The GUI Agent's internal desktop capability is also named `computer_use`; the web tells the two apart by argument shape (`isGuiToolCall`): only a call without an `action` argument is a GUI Agent step rendered by the GUI view.

## Browser use: what `web_use` has and what it lacks

`web_use` today: `observe`, `act` with `screenshot`, `navigate`, `click`, `type`, `press`, `scroll`, `hover`, `select`, `upload`, and `verify` with text, URL, title, element and file assertions, on three backends (Playwright MCP, Chrome DevTools MCP, the App's own Chrome).

Against the Codex target API, `web_use` now covers:

| Capability | Codex | `web_use` |
|---|---|---|
| Right / middle / double click, modifier clicks | `click(target, {mouseButton, clickCount, key})` | `click` with `mouse_button`, `click_count`, `modifiers` |
| Drag | `drag(from, to)` | `drag` between refs or points |
| Scroll a specific element | `scroll(index, direction, pages)` | `scroll` with `ref` and `direction` |
| Append text vs replace value | `typeText` / `setValue` | `type_text` / `type` |
| Paste text, Markdown or HTML | `paste(text, {format})` | `paste` with `format` |
| Select text or place the cursor | `selectText` | `select_text` |
| Key with duration, key without a target | `pressKey(key, {durationMs})` | `press` with `duration`, `ref` optional |
| Back / forward / reload | tab methods | `back`, `forward`, `reload` |
| Run JavaScript in the page | `evaluate` | `evaluate` with `script`, approved per call |
| Console and network (Claude in Chrome's `read_console_messages`, `read_network_requests`) | — | `console_messages`, `network_requests` |

The argument names are `computer_use`'s (`mouse_button`, `click_count`, `direction`, `format`, `prefix`, `suffix`, `selection_type`, `duration`), so the two tools read alike; only the held keys of a click are `modifiers`, because `key` already names the key of `press`.

`page_actions.py` holds the page-side half: argument parsing and five scripts (`POINTER_SCRIPT`, `SCROLL_SCRIPT`, `INSERT_TEXT_SCRIPT`, `PASTE_SCRIPT`, `SELECT_TEXT_SCRIPT`), each a function of `(element, options)`. The controller runs them with `evaluate` on a ref's handle; the MCP backends run them through `browser_evaluate` / `evaluate_script` with the options inlined as JSON and a `require` guard that throws when the page reports failure, so the backend's own error path reports it. Choices per path:

- Bound App tabs keep the background rule: plain clicks still use the existing background click script; other clicks dispatch pointer and mouse events in the page; drags and coordinate clicks go through the page's input dispatch with the tab's input scale, as before.
- The headless Chromium uses native Playwright calls: `click(button, click_count, modifiers)`, `mouse.move(steps=12)` for drags, `keyboard.down/up` for held keys, `go_back` / `go_forward` / `reload`.
- Playwright MCP uses its native `browser_click` options, `browser_drag`, `browser_mouse_drag_xy`, `browser_mouse_wheel` with both axes and `browser_navigate_back`; Chrome DevTools MCP uses `click(dblClick)`, `drag`, and `navigate_page(back|forward|reload)`. An option a backend cannot perform raises `unsupported_option` before anything is sent, rather than performing a weaker action.
- `paste` dispatches a `ClipboardEvent` carrying a `DataTransfer`; when the page does not handle it, the text is inserted with `insertHTML` (rich editors, `md`/`html`) or `insertText`. The system clipboard is never touched.

Tabs map onto existing commands: `list_pages` is `listTabs`, a Page alias from it is `getTab`, `observe` with a `url` opens a hidden background tab (`createBrowserTab` hidden) unless a bound Page already shows that origin, and `close` ends the session. `observe` with `visible: true` opens the tab in front, which the schema reserves for when the user asked to watch, since it moves their focus. `observe` with `changes_only: true` (`observe_diff.py`) is the diff form: it compares the new frame with the previous observation of the same URL by role, name, label, value, disabled state and input type, lists new and changed elements in full, gives each unchanged one as a single line with its new ref, drops an unchanged text or ARIA snapshot, and names removed elements. Every observation still issues refs for all its elements and refs belong to one frame, which is how a stale ref is refused; the diff only shortens what is shown, so no ref has to outlive its frame. The MCP backends replace the ARIA snapshot with their own and list only file inputs as elements, so the option does not apply to them.

`evaluate` reads everything a signed-in page holds, including what observations redact, so it is gated in the permission policy rather than by the tool: `force_approval` makes a `web_use` call whose `action` (top-level or nested) is `evaluate` ask in every mode, before allow rules, bypass and the bound-surface grant are consulted, and `one_shot_approval` keeps the card to the "once" scope, never saves a rule, and shows the arguments untruncated. Non-interactive sources are refused. The script runs through the controller on every backend, the MCP ones included, because the controller holds the same tab and the password values of its fields: the result passes through the same redaction as an observation and through `_mutated`, so the frame is invalidated and the next step observes again. An expression is wrapped as `() => (expr)`; scripts are capped at 8000 characters and results at 20,000.

`console_messages` and `network_requests` (`page_logs.py`) read Playwright's own per-Page history (`console_messages()`, `page_errors()`, `requests()`), so nothing has to be listening before the first read. They run through the controller on every backend like `evaluate`, are read-only and leave the frame valid. Console text passes the password redaction; requests are listed by method, URL without query or fragment, status (`no response` when the browser never received one) and resource type, never with headers or bodies.

## Interface work

A `computer_use` approval card (`computer-use-approval.tsx`) leads with the application itself: its icon, display name and bundle id come from the `computer_use_apps` WebSocket action, which calls `MacComputer.app_info` and launches nothing, and the web caches them per name (`lib/net/computer-use-apps.ts`). Below it a chip names the step in words (`computer-use-step.ts`), two lines state that the step runs in the background (or, for audio, that only that application's sound is recorded) and what the offered scopes cover, and the arguments without empty values fold into "Execution details".

The project's Settings tab has a Computer use section (`computer-use-apps-section.tsx`) between the default settings and the permission rules. It lists the project's `computer_use(<app>)` allow rules as one row per application with icon, name, bundle id and a remove control, and the generic rule list leaves those rules out. Removing a row removes the rule. Conversation-scoped grants are session rules that end with their conversation, so the section does not list them.

Still planned, previews first:

- a browser annotation mode and a region screenshot that lands in the composer;
- `@`-mentions of open tabs and running applications in the composer, so "this tab" resolves without the model guessing.

Windows and Linux backends (UI Automation; AT-SPI with xdotool) follow the same `MacComputer` interface and are not started.

## Relation to the GUI Agent

The GUI Agent workflow (`gui_agent`), its grounding pipeline and its capability planner are unchanged. `computer_use` does not call it and it does not call `computer_use`. Whether the workflow later becomes a thin sub-agent that runs on `computer_use` through the generic `agent` tool is an open decision, taken only after the base tools are complete.

## Implementation status

- Implemented: `computer_use` on macOS with the reading, acting and batch actions above, stable indices, adaptive settling, background pointer and keyboard delivery, tree diffs, per-app approval with the four scopes, system-access gating, web presentation, unit tests for keys, tree numbering, menu matching, batch, rules and approval wiring.
- Implemented for `web_use`: every row of the parity table above, on all three backends, with tests that run the page scripts in Chromium, and the per-call approval of `evaluate`.
- Implemented: OCR text for windows with a sparse tree and as the `find` fallback, with a test that reads a rendered image through Vision.
- Implemented: per-application audio recording with WAV output and Voice-engine transcription.
- Implemented: `web_use` visible tabs and `changes_only` observations on the native backends.
- Not implemented: audio as model input for providers that accept it; moving a window from another Space; annotation mode, region screenshot and `@`-mentions; Windows and Linux backends; object detection for icons and controls that carry no text.
