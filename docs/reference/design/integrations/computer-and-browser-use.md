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

Actions: `list_apps`, `get_app_state`, `click`, `type_text`, `press_key`, `set_value`, `scroll`, `drag`, `perform_secondary_action`, `select_text`, `paste`. The names and arguments follow Codex's target API so the same model habits transfer. Only `list_apps` is read-only and approval-free.

Every acting call returns `Done: <summary>` followed by the Accessibility tree **diff** against the state the model last saw: `- line` for elements that vanished, `+ index line` for new or changed ones. When more than half the lines (and at least twelve) changed, the whole tree is returned instead, because a diff of a rebuilt view is longer than the view. `get_app_state(full=true)` returns the full tree on demand. The tree is capped at 1500 nodes and rendered one element per line: index, role (`AXTextField` → `text field`, with the subrole in parentheses), label, value, placeholder, flags (`focused`, `selected`, `checked`, `disabled`, `secure`, `settable` …) and the element's secondary actions other than the primary press.

The screenshot is the window's own image captured through ScreenCaptureKit, scaled so the long side is at most 1568 pixels; coordinates the model sends are pixels of that image and are mapped back to screen points with the scale that produced it.

### Module layout

| Module | Role |
|---|---|
| `openprogram/computer_use/keys.py` | xdotool chord parsing to macOS key codes and modifier flags (`super+shift+z`, `ctrl++`, `KP_0`, lone modifiers) |
| `openprogram/computer_use/tree.py` | `Node`, rendering, signatures and the diff |
| `openprogram/computer_use/skylight.py` | ctypes bindings to SkyLight for background pointer and keyboard routing |
| `openprogram/computer_use/macos.py` | `MacComputer`: app resolution, window selection, capture, tree walk, every action |
| `openprogram/programs/tools/system/computer_use.py` | the registered tool: schema, approval reason, result assembly |

### Background delivery

Element actions go through Accessibility: `AXPress` / `AXConfirm` / `AXPick`, then `AXSelected`, then focus, then a pointer click at the element's centre as the last resort; `AXShowMenu` for right clicks; `AXValue` for `set_value`; `AXSelectedTextRange` (UTF-16 offsets) for `select_text`; page scrolling actions, then the scrollbar's value, then wheel events for `scroll`.

Pointer events that have to be real (coordinate clicks, drags, wheel) are posted with the recipe the open-source cua-driver established: a focus-without-raise record posted to the target process serial number, a `mouseMoved` primer, the event stamped with click state, button, subtype 3, target pid, window id and a click group, `CGEventSetWindowLocation` for the window-relative position, and `SLEventPostToPid` for delivery. Keyboard events carry an `SLSEventAuthenticationMessage` so the receiving process accepts them; without SkyLight the code falls back to `CGEventPostToPid`. The result is a click the application handles as if the user clicked, while the real cursor stays where it is and the front application does not change.

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

Against the Codex target API the gaps are:

| Capability | Codex | `web_use` |
|---|---|---|
| Right / middle / double click, modifier clicks | `click(target, {mouseButton, clickCount, key})` | left single click only |
| Drag | `drag(from, to)` | — |
| Scroll a specific element by ref | `scroll(index, direction, pages)` | page scroll by amount |
| Append text vs replace value | `typeText` / `setValue` | `type` only |
| Paste text, Markdown or HTML | `paste(text, {format})` | — |
| Select text or place the cursor | `selectText` | — |
| Key with duration, key without a target | `pressKey(key, {durationMs})` | `press` with a ref |
| Back / forward / reload | tab methods | `navigate(url)` only |
| New tab, visible or hidden | `createBrowserTab(kind, url, {visible})` | one page per session |
| Gated JavaScript evaluation | `evaluate` | — |
| Observation as a diff | `getAXState({diff: true})` | full snapshot each time |

These are added to `web_use`'s `act` vocabulary one by one, reusing the argument names `computer_use` already uses (`mouse_button`, `click_count`, `key`, `pages`, `format`, `selection_type`) so the two tools read alike.

## Interface work

Planned, previews first:

- a Computer use settings page listing the applications allowed for the project with a remove control, and the per-session allowances of the open conversation;
- a browser annotation mode and a region screenshot that lands in the composer;
- `@`-mentions of open tabs and running applications in the composer, so "this tab" resolves without the model guessing.

Windows and Linux backends (UI Automation; AT-SPI with xdotool) follow the same `MacComputer` interface and are not started.

## Relation to the GUI Agent

The GUI Agent workflow (`gui_agent`), its grounding pipeline and its capability planner are unchanged. `computer_use` does not call it and it does not call `computer_use`. Whether the workflow later becomes a thin sub-agent that runs on `computer_use` through the generic `agent` tool is an open decision, taken only after the base tools are complete.

## Implementation status

- Implemented: `computer_use` on macOS with all eleven actions, background pointer and keyboard delivery, tree diffs, per-app approval with the four scopes, system-access gating, web presentation, unit tests for keys, tree, rules and approval wiring.
- Not implemented: every row of the browser gap table; the settings page, annotation mode, region screenshot and `@`-mentions; Windows and Linux backends; a batch action; a perception fallback (object detection and OCR) for applications whose Accessibility tree is empty.
