# Computer and browser use

OpenProgram gives the model one tool for everything that happens on a screen: `computer_use_agent`. It operates applications on macOS, Linux and Windows, pages in the App's built-in browser and the headless Chromium, and a remote virtual machine. This record explains the tool's shape, how it hands the model only the instructions it needs, how a click target becomes a screen position, how the model chooses whether the work runs in the current context, and how the application and browser backends underneath are built.

## Three ways to give a model a screen

**Codex** (ChatGPT.app) has one execution tool, `js` in the `cua_repl` MCP server: the model writes JavaScript against `sky` (Mac apps) and `agent.browsers` (the in-app browser, Chrome). The knowledge sits in three skills, `computer-use`, `control-in-app-browser` and `control-chrome`, each about 3,200–3,400 tokens. The context holds one line per skill; the model reads a `SKILL.md` itself when the task needs it, and the browser skill then has it run `documentation()` inside `js` to fetch the browser API reference. Loading costs two or three model calls, and a model that skips the reading does not know the API.

**Claude Code** has many small tools: the built-in browser's `navigate`, `read_page`, `find`, `computer`, `form_input` and about fifteen more, whose full schemas are always in context, and a second set for the user's Chrome, deferred as bare names until `ToolSearch` loads them. Every parameter is schema-checked, but two sets with the same verbs invite picking the wrong one, and the resident set costs context in every conversation.

**OpenProgram** takes Codex's single entry and Claude Code's structured arguments:

- **One tool.** `computer_use_agent` is the only screen tool the model sees. Its schema is small and the same for every target; the actions and their arguments live in per-target guides.
- **Guides arrive with the first call.** The tool description is a catalogue of the targets. The first call for a target returns that target's guide together with its current state (installed and running apps, open pages), so the guide costs no extra call and does not depend on the model remembering to read it. The guides are [tool guides](../function/tool-guides.md), delivered by the agent loop rather than by the tool.
- **Arguments or code.** Simple steps are structured calls (`action` + `args`, or up to 20 `actions`). Steps with loops, conditions or data handling are a Python snippet (`code`) that runs in an isolated interpreter whose variables survive between calls.
- **The model chooses the context.** `context: "inherit"` (default) runs in the current conversation; `context: "fresh"` starts an agent with a clean context and a written brief, which returns only its result.
- **Grounding is a layer.** A click target is an element index, a page ref, a pixel, or a text description resolved by visual detection.

## `computer_use_agent`

### Shape

```
computer_use_agent(target, action?, args?, actions?, code?, timeout?, context?, brief?)
```

| Parameter | Meaning |
|---|---|
| `target` | `app`, `browser` or `vm`; all three are always in the schema, and a target this host cannot reach answers with how to set it up |
| `action`, `args` | one step and its arguments; omitted, the call opens the target |
| `actions` | up to 20 steps `{action, args}` on one target, stopping at the first error; the state comes back once |
| `code` | Python run in the isolated interpreter (see Code) |
| `timeout` | seconds a code call may run, at most 120 (default 60) |
| `context` | `inherit` (default) or `fresh` |
| `brief` | with `fresh`: goal, known facts, limits and what to hand back |

`action`, `actions` and `code` are exclusive. Arguments are validated by the target, and an error names the right spelling, since the schema does not list every action's arguments.

### Targets and guides

| Target | Backend | Opening returns |
|---|---|---|
| `app` | `openprogram/computer_use/` (macOS, Linux X11, Windows) | `args.app` given: its state (tree and screenshot); otherwise the app list |
| `browser` | the `web_use` runtime (App Pages, headless Chromium); with `args.browser` = `chrome` or `edge`, Playwright MCP in extension mode connected to the user's browser | the page list (the tab list in the user's browser) |
| `vm` | an OSWorld-compatible server at `computer_use.vm_url` | a screenshot |

Each target has a guide (`guides/<target>.md`; the app guide has macOS, Linux and Windows variants): its actions, their arguments, how results look, and the confirmation policy. `tool.py` registers them as tool guides: `computer_use_agent.<target>` is included in the first result of a call that operates that target (`context` other than `fresh`); `computer_use_agent.code` and `computer_use_agent.describe` are lookup guides required by a call with `code` or with `describe` in a step, so that call is refused once with the guide attached. Whether a guide is known is read from the request the agent loop last sent, so compaction, cleared tool results and a worker restart all lead to the guide being sent again, and a fresh agent, whose prompt holds the marked guides, is not sent them a second time. `action: "guide"` and `help("computer_use_agent.<target>")` return them on request.

The `app` actions are those of the application backend below, with the same arguments; the `browser` actions are the `web_use` runtime's commands: `list_pages`, `observe`, `verify` and `close` keep their names, and each `act` action (`navigate`, `click`, `type`, …) is an action of its own. As in Codex, the browser is chosen first and the actions do not change with it. `args.browser` omitted is the built-in browser through `web_use`; `chrome` or `edge` is the user's own browser, which none of the `web_use` backends reaches. For those, `targets/browser.py` hands each step to `workflow/browser/extension_browser.py`, which runs `@playwright/mcp --extension --browser chrome|msedge` (the version pinned for `web_use`) through `_SyncMCPClient`, one server per conversation and browser, kept between calls. The server opens `chrome-extension://<id>/connect.html` in that browser with the address of its relay, and the Playwright Extension connects back and relays CDP for the tab the user shares; with `computer_use.chrome_extension_token` set, the server passes `PLAYWRIGHT_MCP_EXTENSION_TOKEN` and the extension connects without asking. `list_pages`, `observe`, `close`, `screenshot`, `upload`, `evaluate`, the logs and `verify` map to the server's tab, snapshot, screenshot, file, evaluate and log tools; every element and pointer action goes through `OfficialMCPPageBackend._action_call`, the same translation the `playwright_mcp` backend applies to App Pages. Refs are the server's snapshot refs. Code mode registers no resource for the user's browser.

### Grounding

`grounding.py` turns a step's target into what the backend takes:

| Given | Resolved to |
|---|---|
| `element_index` (app) / `ref` (browser) | passed through; the backend acts on the element |
| `x`, `y` | passed through as pixels of the target's last screenshot |
| `describe` | the last screenshot and the text go to gui_harness's `locate_target` (GPA-GUI-Detector icons, OCR text, saved components, a model check, zoom when unsure); its centre becomes `x`, `y` |

`describe` is offered for `app` and `vm`, and only where gui_harness and its perception dependencies are importable; the guide leaves it out otherwise. It costs several model calls inside the tool, so the guide places it after indices and pixels. gui_harness is not modified; only `planning.component_memory.locate_target` is called.

### Code

`code` runs in the persistent sandboxed interpreter of `backend/gui_runner.py` (seatbelt on macOS, no file, network or process access). The namespace has `cu.app`, `cu.browser` and `cu.vm`; `await cu.app.click(app="Numbers", element_index=3)` is the structured step `click` with those arguments, dispatched by the host through the same target code, grounding and checks, one effect receipt per step (`backend/gui_broker.py`). The prelude gives each `cu` method the guide line of its action as its docstring, so `dir(cu.app)` and `help(cu.app.click)` work inside the interpreter. A code call names its `target` and, for `app`, `args.app`; the approval covers that application, and steps on another application are refused. `evaluate` is not available inside code, since every page script needs its own approval. One interpreter serves one execution attempt, so variables persist for the rest of the turn; it is replaced when it fails or times out. Each call may run 120 seconds and 100 steps. Code mode needs the macOS sandbox; elsewhere a code call reports that the sandbox is unavailable.

### Context

`context: "fresh"` hands the task to an agent with a clean context through the generic `agent` spawn (`_agent_impl`, `start_from="clean"`): same session, same model and thinking settings, the result returned as this call's result. Its prompt is the brief, a line naming the target (and `args.app`), the target's guide, and, where `describe` is available, the recommendation to ground by it when an element has no index or ref. Screenshots and grounding calls stay in its context. The spawn depth limit keeps it from starting another one.

A spawned agent cannot ask for approval, so the `fresh` call carries it: it names the target and, for `app`, `args.app`, and goes through the same approval as a direct call. While the agent runs, the call's exact rule is written as a session rule (unless one already exists) and removed when the agent returns, so the agent's own calls match it and nothing outlives the call.

### Approval and access

| Call | Approval |
|---|---|
| `app` (except `list_apps`) | per application, as before: rule `computer_use_agent(<app>)`, asked in the modes that ask; former `computer_use(<app>)` rules still match |
| `browser` | the turn's Page grant when the conversation has Pages; otherwise the permission mode; `evaluate` is approved per call, once |
| `browser` with `args.browser` | the user's Chrome or Edge, once per conversation: rule `computer_use_agent(browser:chrome)` (or `browser:edge`), never the Page grant; `evaluate` is approved per call |
| `vm` | per endpoint: rule `computer_use_agent(vm:<url>)` |
| `fresh` | as the target it names |

System access (Accessibility, Screen Recording) gates `app` calls other than `list_apps` as before.

### Module layout

| Module | Role |
|---|---|
| `openprogram/programs/tools/system/computer_use_agent/tool.py` | the registered tool: schema, catalogue, routing, guide registration, approval reason |
| `…/computer_use_agent/guides/` | the target guides |
| `…/computer_use_agent/targets/app.py` | application actions over `openprogram/computer_use/` |
| `…/computer_use_agent/targets/browser.py` | page actions over the `web_use` runtime |
| `…/computer_use_agent/targets/vm.py` | screenshot and pyautogui input over the VM server's HTTP API |
| `…/computer_use_agent/grounding.py` | target resolution, including `describe` |
| `…/computer_use_agent/code.py` | code mode over `backend/gui_runner.py` and `gui_broker.py` |
| `…/computer_use_agent/fresh.py` | the clean-context agent |

There is no separate plan → decide → act → verify loop: a long task goes to a `fresh` agent working with this same tool, and gui_harness is reached only through `describe`. Its Program stays installable for that (`entries=False`, so it registers no tools of its own).

## Application backend

### Shape

```
computer_use_agent(target="app", action, args={app, element_index | x,y | describe, …})
```

Actions come in three groups:

- **Reading:** `list_apps`, `list_windows`, `get_app_state` (`include` = all / tree / screenshot, `window` or `window_id`), `zoom` (a region of the last screenshot at full pixel density), `find` (text and role search over the last tree).
- **Acting**, Codex's target API: `click` (button, count, held modifiers, hold duration), `type_text`, `press_key`, `set_value`, `scroll` (pages or pixels), `drag`, `perform_secondary_action`, `select_text`, `paste`; and from the Claude app's `app_*` set: `copy`, `focus`, `menu`, `show_window`.
- **Several steps** (`actions`): up to 20 acting steps on one app, in order, stopping at the first error; one settle and one state at the end.

Only `list_apps` is approval-free. A step in `actions` cannot name a different app, because the approval the call carries names only the call's app.

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

A window whose own walk yields fewer than 12 elements (frame, title bar buttons and little else) is drawn without Accessibility. For such a window every full or screenshot-only read also runs Vision's accurate text recognizer on the screenshot it just took and lists each line as `"text" at (cx, cy), WxH` in screenshot pixels, top to bottom and left to right, at most 150 lines. The first recognition language picks Vision's model, so the languages are a hint (the user's preferred languages, then Chinese, Japanese, Korean and English) and language detection chooses per image. `find` with `text` falls back to these lines when no element matches; for a window that was not sparse it captures and reads the window once at the same scale, so the positions stay valid for actions. OCR text has no indices and is not part of the tree diff: it is evidence for coordinate actions, and a failure of the recognizer leaves the read without it. The same reads list icons and controls without text (`ocr.detect_shapes`): Vision's contour detector runs twice, once for dark marks on a light window and once for light on dark, at most 1024 pixels on the long side. Top-level outlines within 3 points of each other merge into one shape, and a shape is dropped when it covers a recognized line of two or more characters, is under 8 points on its short side, over 80 points on its long side, more than 4:1, or touches the screenshot's edge (the window's rounded corners and border). A one-character line does not rule a shape out, because the recognizer often reads an icon as a glyph. Shapes the two passes both find are kept once, and the list is sorted in 16-point rows, left to right, at most 60. A shape carries no name: the model reads the screenshot to tell a gear from a trash can.

### Audio

Codex records computer audio with `start_audio_recording` / `stop_audio_recording` (60 seconds by default, 300 at most) and hands the clip to the model as audio input. OpenProgram keeps the two actions and their limits. The clip becomes a WAV on disk plus a transcript from the Settings → Voice engine, which every model can read. `ToolReturn.audio` also carries the WAV as an `AudioContent` block. When the model lists `audio` among its inputs, the Gemini converter passes it as inline audio and the Chat Completions converter as `input_audio`, each in a user turn after the run of tool results, which must stay together. That Chat Completions turn also carries the run's screenshots for vision models, since a `tool` message holds only text. The Responses and Anthropic converters skip audio blocks, and tool-result media is not written to the conversation history, so the clip costs nothing for models that cannot hear it. `audio.py` opens an `SCStream` whose filter is the display with only the target application included, asks for 16 kHz mono float samples, excludes the OpenProgram process, and attaches only an audio output: the 2×2, one-frame-a-second video side is never consumed. Samples past the limit are dropped and a timer stops the stream half a second after it, so a forgotten recording releases the capture. One recording runs per conversation; it is converted to 16-bit PCM on stop and saved under the state directory, keeping the newest 20. The action keeps the per-application approval: only the named app's sound is in the clip. A clip whose peak stays under 1e-4 is reported silent and not transcribed. An application without a window has no `SCRunningApplication` and cannot be recorded.

### Module layout

| Module | Role |
|---|---|
| `openprogram/computer_use/base.py` | what every backend shares: `ComputerUseError`, `Report`, `Observation`, `AudioClip`, argument checks, recording storage |
| `openprogram/computer_use/backends.py` | `support()` and `backend()` for the host: `macos` on Darwin, `linux` on Linux, `windows` on Windows |
| `openprogram/computer_use/keys.py` | xdotool chord parsing to macOS key codes and modifier flags (`super+shift+z`, `ctrl++`, `KP_0`, lone modifiers) |
| `openprogram/computer_use/tree.py` | `Node`, rendering, signatures, stable numbering (`Snapshot`, `number`) and the diff |
| `openprogram/computer_use/audio.py` | ScreenCaptureKit audio capture of one application, sample limit, WAV encoding |
| `openprogram/computer_use/ocr.py` | Vision text recognition (tesseract TSV on Linux), box conversion to screenshot pixels, reading order, language hints, contour shapes |
| `openprogram/computer_use/skylight.py` | ctypes bindings to SkyLight for background pointer and keyboard routing |
| `openprogram/computer_use/macos.py` | `MacComputer`: app resolution, window selection, capture, tree walk, every action |
| `openprogram/computer_use/linux.py` | `LinuxComputer`: the same interface over AT-SPI, xdotool, Gdk capture and PipeWire/PulseAudio |
| `openprogram/computer_use/windows.py` | `WindowsComputer`: the same interface over UI Automation (comtypes), window messages, `SendInput` and `PrintWindow` |
| `openprogram/computer_use/windows_audio.py` | WASAPI process-loopback capture of one process tree |
| `openprogram/programs/tools/system/computer_use_agent/targets/app.py` | the `app` target: step validation, `describe` resolution, several steps, result assembly |

### Background delivery

Element actions go through Accessibility: `AXPress` / `AXConfirm` / `AXPick`, then `AXSelected`, then focus, then a pointer click at the element's centre as the last resort; `AXShowMenu` for right clicks; `AXValue` for `set_value`; `AXSelectedTextRange` (UTF-16 offsets) for `select_text`; page scrolling actions, then the scrollbar's value, then wheel events for `scroll`.

Pointer events that have to be real (coordinate clicks, drags, wheel) are posted with the recipe the open-source cua-driver established: a focus-without-raise record posted to the target process serial number, a `mouseMoved` primer, the event stamped with click state, button, subtype 3, target pid, window id and a click group, `CGEventSetWindowLocation` for the window-relative position, and `SLEventPostToPid` for delivery. Keyboard events carry an `SLSEventAuthenticationMessage` so the receiving process accepts them; without SkyLight the code falls back to `CGEventPostToPid`. The result is a click the application handles as if the user clicked, while the real cursor stays where it is and the front application does not change.

A window is chosen by `window` (title substring or index) or `window_id`; without either, the window the model read last stays selected while it is open, then the focused or main window. A minimized window or a hidden app still gives its tree; the screenshot is unavailable until `show_window` un-minimizes it (`AXMinimized`) or unhides the app, neither of which activates it. A window on another Space is read and operated where it is. `AXWindows` lists only the current Space's windows, so the app's off-screen ordinary windows (layer 0, at least 80×60) that no listed window covers are looked up by SkyLight's remote token: `_AXUIElementCreateWithRemoteToken` with the pid, `0`, `'coco'` and an element id, trying ids from zero (at most 4000) until each window id has its element, as AltTab does; the result is kept per app until that set of ids changes. ScreenCaptureKit captures such a window and SkyLight's pointer route reaches it, but the window server drops key events for it whatever their route, so `type_text` and `paste` there set the focused element's `AXSelectedText` instead, `press_key` reports that keys do not arrive, and `show_window` says the window stays on its Space. Moving it is not possible: since macOS 14.5 only the Dock may (`SLSMoveWindowsToManagedSpace` from any other process needs System Integrity Protection relaxed, as yabai documents).

`paste` writes the pasteboard (plain text, or HTML rendered from Markdown with `markdown-it`), sends Cmd+V to the target process, and restores the previous pasteboard contents when the change count shows nothing else wrote in between.

### Agent cursor

Before a step that names an element or a point, `MacOSComputer.act` computes where it lands (the element's centre from its `AXFrame`, or the screenshot point mapped through the window origin and scale) and calls `native_window_resources.note_action_point`, then waits `CUE_LEAD_SECONDS` (0.15 s) so the cursor arrives first. The point is in screen points with the origin at the top left of the main display, the space Electron also uses. The worker broadcasts it as a `native.action` frame (`session_id`, `x`, `y`, `sequence`, `at`, `action`, `app_name`); an agentic subprocess forwards it through the same parent channel as operated windows (`kind: "action"`). In the web client `native-window-store.ts` hands the frame to `openprogramDesktop.nativeActionCue` unless **Show actions** is off. The desktop main process (`showNativeActionCue` in `main/action-cues.js`) keeps one transparent, click-through, non-focusable, always-on-top window that loads the same `/menu-overlay/action-cue` page as the Page cursor, glides it from the previous point, plays the click, and hides it after `ACTION_CUE_MS`. Every App window receives the frame, so the main process drops a step it has already shown by `session_id`, `sequence` and `at`. Linux and Windows do not emit points yet.

### Window marker

The operated window carries the macOS screen-sharing marker, as under Codex Computer Use: a purple badge over its title-bar buttons and the sharing icon in the menu bar. macOS draws both for any window under a live ScreenCaptureKit stream, so `window_watch.WindowWatch` keeps one open on it, the way Codex keeps its picture-in-picture stream. `MacOSComputer` touches it with the window id on every `act` and every `get_state` that names a window. The stream filters to that one window (`SCContentFilter.initWithDesktopIndependentWindow`), asks for a 2x2 frame at one frame a second and attaches no output, so nothing is recorded. Each session watches at most one window: moving to another window releases the previous one, and a window with no step for `IDLE_SECONDS` (20 s) is released by a sweep timer. Opening the stream runs on its own thread and its failures are ignored, so a step never waits on or fails because of the marker.

### Refusals

The tool never types into `AXSecureTextField` elements or while macOS reports secure keyboard input (`kCGSSessionSecureInputPID`), and refuses to target Keychain Access, Passwords, loginwindow, SecurityAgent and OpenProgram's own bundles. The refusal is returned as an error that asks the user to do the step; no approval scope overrides it.

### Linux backend

`LinuxComputer` keeps `MacComputer`'s interface, so the tool, the server's app lookup and the tests drive either one through `backends.backend()`. It runs only in an X11 session: under Wayland no client may read or inject input into another client's surface, and `support()` says so.

- **Apps.** The AT-SPI desktop's children that own a window, plus top-level X windows whose owner does not join the accessibility bus. The owner of an X window is `_NET_WM_PID`, or, for Xt and Motif clients that do not set it, the newest process whose name or executable starts with the window's WM_CLASS instance. Each app is matched to a desktop entry (`Gio.AppInfo`) by executable or name, which gives the identifier (`org.gnome.Calculator`), the display name, and the icon looked up in the hicolor theme. Launching goes through `Gio.DesktopAppInfo.launch` and then waits for the app's AT-SPI root as well as its window, since GTK 4 apps join the bus after mapping.
- **Windows.** Top-level windows are the window manager's `_NET_CLIENT_LIST` (read with `xprop`), which leaves out GTK's 10×10 client-leader window; without a client list, windows of 10×10 or smaller are skipped. An AT-SPI frame is paired with its X window by title, then by size. A window missing from the mapped set is reported minimized; `show_window` maps it again.
- **Tree.** Roles are AT-SPI role names (`push button`, `text`, `check box`), so `role_name` prints them unchanged. A subtree is read when it is on screen: GTK 3 sets SHOWING, GTK 4 sets only VISIBLE below the window, so the walk uses SHOWING when any child of the window reports it and VISIBLE otherwise. A closed combo box's popup items and GTK's tooltip window are skipped. Unnamed fillers, panels and sections are transparent. GTK 4 names unnamed widgets after their class (`AdwGizmo`, `GtkMenuButton`); such names are not labels. Flags come from states (CHECKED or PRESSED, FOCUSED, SELECTED, EXPANDED, not ENABLED/SENSITIVE), `settable` from EditableText or Value, `secure` from the `password text` role. Secondary actions are the element's Action names other than click, press, activate, toggle, jump, open and select.
- **Element actions in the background.** Click runs the element's primary action; `set_value` uses `EditableText.set_text_contents`, `Value.set_current_value`, or a toggle when a check box's state differs; `type_text` and `paste` insert at the caret with `EditableText.insert_text` (UTF-8 byte length), replacing a selection, and a newline runs the field's `activate` action; `press_key Return` on a field runs `activate`; `select_text` uses `Text.set_selection` or the caret offset (character offsets, not UTF-16); `copy` reads `Text.get_selection` without the clipboard; `scroll` by element moves the nearest scroll bar's Value by 90 % of its length per page; `menu` walks the window's `menu bar` and runs a leaf's action. `Component.grab_focus` makes GTK present the window, so wherever focus has to move, the window that was active gets focus back.
- **Foreground input.** GTK and Qt read pointer and key input through XInput 2 and ignore core events sent with `XSendEvent` to an unfocused window, so a coordinate click, drag, wheel scroll, hover or key press is sent with XTEST: the window is activated (`windowactivate`, or `windowraise` plus `windowfocus` without an EWMH window manager), the input runs, and the pointer position and previously active window are restored; `hover` leaves the pointer. Chords use xdotool names with `cmd`, `command`, `meta` and `win` mapped to `super` and `option` to `alt`.
- **Screenshots.** `Gdk.pixbuf_get_from_window` on a foreign X window gives the window's own pixels at X resolution, scaled down to 1568 pixels on the long side; a minimized window has none. Screenshot pixels map to screen pixels through the window's position from `xdotool getwindowgeometry`, the same frame AT-SPI's screen extents use.
- **OCR.** For sparse windows (and the `find` fallback), `tesseract --psm 11 tsv` with the installed languages among eng, chi_sim, chi_tra, jpn and kor; words with confidence 30 or more are joined into lines. Contour shapes are not detected on Linux.
- **Audio.** `pactl list sink-inputs` gives each stream's `application.process.id`; the recorder polls until a stream of the app or any of its descendants (re-read on every poll, since players are usually children started after recording began) appears, then reads it with `parec --monitor-stream=<index>` as 16 kHz mono float. Reading continues until parec ends, so the samples it buffers when stop terminates it are kept. Under PipeWire the first samples arrive within a quarter second; under PulseAudio's timer-based scheduling the first monitor of a stream starts 1.2–1.7 s late and that span is lost.
- **Refusals.** `password text` elements, Seahorse, KWallet, gcr prompts, polkit agents and OpenProgram's own entries.

The app guide is rewritten for Linux when it is sent (`_LINUX_GUIDE` in `targets/app.py`): which steps bring the window forward, plain-text `paste`, clipboard-free `copy`, the Linux refusals. The `computer_use_apps` WebSocket reply carries the worker's `platform`, and on Linux the approval card states for coordinate input, drags, hovers and keys other than Return (`needsForeground`) that the window comes forward for that step.

### Windows backend

`WindowsComputer` keeps the same interface. The process is per-monitor DPI aware (`SetProcessDpiAwarenessContext(-4)`), so window frames, UI Automation bounds and input coordinates are all physical screen pixels. Every Win32 function it calls has its `restype` and `argtypes` declared, so 64-bit handles pass intact.

- **Apps.** Top-level windows from `EnumWindows` that are visible, unowned, not tool windows and titled, grouped by process. A UWP frame (`ApplicationFrameWindow`) belongs to ApplicationFrameHost; its app is the process of the `Windows.UI.Core.CoreWindow` child. Installed apps are `Get-StartApps` (desktop and Store alike, cached for a minute); a running process is matched to a row by executable or name, and launching runs `explorer.exe shell:AppsFolder\<AppID>`, then waits for a new window.
- **Tree.** `IUIAutomation.ElementFromHandle` on the window, walked with the control view walker; offscreen subtrees are skipped except menu items. Roles are the control types (50000–50040) named in lower case (`button`, `edit`, `check box`). Unnamed panes, groups and custom elements without actions are transparent. Flags come from patterns: Toggle state, `IsEnabled`, `HasKeyboardFocus`, SelectionItem, ExpandCollapse, a writable Value or a RangeValue (`settable`), `IsPassword` (`secure`). Values come from RangeValue, Value or the Text pattern's document range. Secondary actions are expand, collapse, scroll, select and a LegacyIAccessible default action other than press, click, invoke or jump.
- **Element actions in the background.** Click tries Invoke, Toggle, SelectionItem.Select, ExpandCollapse and LegacyIAccessible.DoDefaultAction in order, and focuses an edit; `set_value` uses Toggle, RangeValue, Value or LegacyIAccessible; `select_text` moves a Text pattern range by characters; `copy` reads the Text pattern's selection; `scroll` by element uses the nearest Scroll pattern by large increments; `menu` walks a classic `HMENU` (`GetMenu`) and posts `WM_COMMAND`, or expands and invokes UI Automation menu items.
- **Posted input.** A coordinate click, drag, wheel scroll or hover is posted as mouse messages to the deepest child window under the point (`ChildWindowFromPointEx`), in its client coordinates; a second click is `WM_LBUTTONDBLCLK`. A key without named modifiers is `WM_KEYDOWN`/`WM_CHAR`/`WM_KEYUP` to the thread's focus window (`GetGUIThreadInfo`); `type_text` posts `WM_CHAR` per UTF-16 unit. `paste` into a classic edit or rich edit control sends `WM_PASTE`.
- **Foreground input.** Shortcuts read `GetKeyState`, which posted messages do not change, and UWP frames, Chromium and Firefox windows read raw input, so a chord with modifiers, pointer input to those window classes, and `paste` elsewhere use `SendInput` inside `_Forward`: it joins the foreground thread's input queue (`AttachThreadInput`) to call `SetForegroundWindow`, runs the input, and then puts the cursor and the previous foreground window back.
- **Screenshots.** `PrintWindow` with `PW_RENDERFULLCONTENT` renders the window, covered or not, into a bitmap the size of its outer rectangle; the visible frame (`DWMWA_EXTENDED_FRAME_BOUNDS`) is cut from it and scaled with `StretchBlt` in HALFTONE mode to 1568 pixels on the long side, then `GetDIBits` gives BGRA rows that `png_encode` writes as a PNG without any imaging library. A minimized window has no screenshot; `show_window` restores it with `SW_SHOWNOACTIVATE`.
- **Clipboard.** `paste` writes `CF_UNICODETEXT` and, for md and html, the "HTML Format" payload whose header offsets `cf_html` computes, and restores the previous text afterwards.
- **OCR.** As on Linux, tesseract when it is installed.
- **Audio.** `ActivateAudioInterfaceAsync` on `VAD\Process_Loopback` with `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE` gives an `IAudioClient` initialised in shared loopback mode with auto-conversion to 16 kHz mono float, read event-driven through `IAudioCaptureClient` on its own COM thread. The completion handler is an agile COM object, since Windows calls it on a worker thread.
- **Refusals.** `IsPassword` elements, CredentialUIBroker, consent (UAC), LogonUI, LockApp, credwiz, keymgr and OpenProgram.

The app guide is rewritten for Windows when it is sent (`_WINDOWS_GUIDE`), and the approval card says for a chord or a paste (`needsForeground(args, "windows")`) that the window comes forward for that step.

### Permissions and approval

For the `app` target `requires_approval` returns `computer_use_agent controls <app>` for every action except `list_apps`; a call with `code`, `fresh` or no action is approved as reading the app. `parse_command` reduces a call to its normalised application name (`vm:<url>` for the VM, none for the browser), so `exact_rule_for_call` yields `computer_use_agent(calculator)` and `rule_to_string` prints it in the usual form. The approval card offers four scopes:

| Scope | Where the rule is saved |
|---|---|
| once | nowhere |
| session | the session's run config (`permission_rules.allow`) — `computer_use_agent` is in `_SESSION_SCOPE_TOOLS` |
| always | the project rules |
| deny | nowhere |

The grant applies in the modes that ask; Bypass allows the call and Auto sends it to the Auto review. `permission_decision` treats `computer_use_agent` as an app-grant tool (`_APP_GRANT_TOOLS`) for its `app` and `vm` targets: when the tool's own `requires_approval` says the call needs approval and no allow rule names the application, the decision is `ask` with reason `APP_GRANT_REQUIRED`, Unattended sources therefore deny such calls outside Bypass, and in the modes that ask an allow rule is the only way past the card. `_RULE_ALIASES` lets rules saved under the former name, `computer_use(<app>)`, match `computer_use_agent` calls. The `browser` target has no rule of its own: a conversation with Pages gets the turn's `SURFACE_GRANT`, and an upload or a website outside this computer asks.

Permission rules are reloaded at every operation boundary (global < project < session), so a session rule applies to the next call without a restart.

System access: `computer_use:desktop` is an operation of both the `accessibility` and `screen_recording` capabilities; `_desktop_operation` maps every `app` call except `list_apps` and `guide` to it, so a missing grant pauses the call with the standard "waiting" state and the Settings → System access flow; the waiting request names `computer_use_agent`.

The tool is in `DEFAULT_TOOLS` and resident: its schema is short, so it is not deferred. When the conversation has Pages, `_configure_web_use_tools` keeps it and removes the independent browser tools; `web_use` is never offered to the model. `unsafe_in` hides it in WeChat and Telegram channels and in plan mode.

### Web presentation

`lib/computer-use-agent-call.ts` reads a `computer_use_agent` call: `appStepArgs` turns an `app` call into the flat step the app renderers take (`{action, app, …}`; several steps become a batch, code and a fresh agent their own actions), and `screenStep` names a browser or VM call's action. `tool-presentation.ts` renders `app` steps with the monitor icon and the system tone; the title names the action and the application ("Clicked in Calculator"), the target line shows the key, text, action name or window where one is given. Browser calls show the action and URL, VM calls the action, code "Ran code in <app>", and a fresh agent "Handed to a new agent" with the brief's first line. The approval card's scope buttons add "Allow this conversation" between once and always, and the answer summary prints "Allowed for this conversation". Calls recorded by the earlier tools (`computer_use`, `web_use`, `gui_agent`) keep their renderers so old conversations read as before.

## Browser target: the `web_use` runtime

The `browser` target runs on the `web_use` runtime (`run_web_use` in `openprogram/programs/workflow/browser/`), which other programs still call directly. It has: `observe`, `act` with `screenshot`, `navigate`, `click`, `type`, `press`, `scroll`, `hover`, `select`, `upload`, and `verify` with text, URL, title, element and file assertions, on three backends (Playwright MCP, Chrome DevTools MCP, the App's own Chrome).

Against the Codex target API it covers:

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

The argument names are the `app` target's (`mouse_button`, `click_count`, `direction`, `format`, `prefix`, `suffix`, `selection_type`, `duration`), so the two targets read alike; only the held keys of a click are `modifiers`, because `key` already names the key of `press`.

`page_actions.py` holds the page-side half: argument parsing and five scripts (`POINTER_SCRIPT`, `SCROLL_SCRIPT`, `INSERT_TEXT_SCRIPT`, `PASTE_SCRIPT`, `SELECT_TEXT_SCRIPT`), each a function of `(element, options)`. The controller runs them with `evaluate` on a ref's handle; the MCP backends run them through `browser_evaluate` / `evaluate_script` with the options inlined as JSON and a `require` guard that throws when the page reports failure, so the backend's own error path reports it. Choices per path:

- Bound App tabs keep the background rule: plain clicks still use the existing background click script; other clicks dispatch pointer and mouse events in the page; drags and coordinate clicks go through the page's input dispatch with the tab's input scale, as before.
- The headless Chromium uses native Playwright calls: `click(button, click_count, modifiers)`, `mouse.move(steps=12)` for drags, `keyboard.down/up` for held keys, `go_back` / `go_forward` / `reload`.
- Playwright MCP uses its native `browser_click` options, `browser_drag`, `browser_mouse_drag_xy`, `browser_mouse_wheel` with both axes and `browser_navigate_back`; Chrome DevTools MCP uses `click(dblClick)`, `drag`, and `navigate_page(back|forward|reload)`. An option a backend cannot perform raises `unsupported_option` before anything is sent, rather than performing a weaker action.
- `paste` dispatches a `ClipboardEvent` carrying a `DataTransfer`; when the page does not handle it, the text is inserted with `insertHTML` (rich editors, `md`/`html`) or `insertText`. The system clipboard is never touched.

Tabs map onto existing commands: `list_pages` is `listTabs`, a Page alias from it is `getTab`, `observe` with a `url` opens a hidden background tab (`createBrowserTab` hidden) unless a bound Page already shows that origin, and `close` ends the session. `observe` with `visible: true` opens the tab in front, which the schema reserves for when the user asked to watch, since it moves their focus. `observe` with `changes_only: true` (`observe_diff.py`) is the diff form: it compares the new frame with the previous observation of the same URL by role, name, label, value, disabled state and input type, lists new and changed elements in full, gives each unchanged one as a single line with its new ref, drops an unchanged text or ARIA snapshot, and names removed elements. Every observation still issues refs for all its elements and refs belong to one frame, which is how a stale ref is refused; the diff only shortens what is shown, so no ref has to outlive its frame. The MCP backends replace the ARIA snapshot with their own and list only file inputs as elements, so the option does not apply to them.

`evaluate` reads everything a signed-in page holds, including what observations redact, so it is gated in the permission policy rather than by the tool: `force_approval` makes a `computer_use_agent` browser call with an `evaluate` step (single or in `actions`) ask in every mode, before allow rules, bypass and the bound-surface grant are consulted, and `one_shot_approval` keeps the card to the "once" scope, never saves a rule, and shows the arguments untruncated. Non-interactive sources are refused. The script runs through the controller on every backend, the MCP ones included, because the controller holds the same tab and the password values of its fields: the result passes through the same redaction as an observation and through `_mutated`, so the frame is invalidated and the next step observes again. An expression is wrapped as `() => (expr)`; scripts are capped at 8000 characters and results at 20,000.

`console_messages` and `network_requests` (`page_logs.py`) read Playwright's own per-Page history (`console_messages()`, `page_errors()`, `requests()`), so nothing has to be listening before the first read. They run through the controller on every backend like `evaluate`, are read-only and leave the frame valid. Console text passes the password redaction; requests are listed by method, URL without query or fragment, status (`no response` when the browser never received one) and resource type, never with headers or bodies.

## Interface work

The approval card for an `app` call (`computer-use-approval.tsx`) leads with the application itself: its icon, display name and bundle id come from the `computer_use_apps` WebSocket action, which calls the backend's `app_info` and launches nothing, and the web caches them per name (`lib/net/computer-use-apps.ts`). Below it a chip names the step in words (`computer-use-step.ts`), two lines state that the step runs in the background (or, for audio, that only that application's sound is recorded) and what the offered scopes cover, and the arguments without empty values fold into "Execution details".

The project's Settings tab has a Computer use section (`computer-use-apps-section.tsx`) between the default settings and the permission rules. It lists the project's `computer_use_agent(<app>)` allow rules (and those saved as `computer_use(<app>)`) as one row per application with icon, name, bundle id and a remove control, and the generic rule list leaves those rules out. Removing a row removes the rule. Conversation-scoped grants are session rules that end with their conversation, so the section does not list them.

The person points the agent at things the way Codex lets them:

- In a web tab, **Comment on the page…** picks one element and adds its selector, text and the comment to the draft; **Screenshot a region…** lets them drag a rectangle and adds those pixels as a PNG attachment. Both run in one isolated world (`PICKER_WORLD` in `apps/desktop/main/web-views.js`) that shares a cancel hook, so one mode ends the other. The region overlay is removed and two frames are painted before `capturePage` takes the rectangle, scaled by the page zoom. The file reaches the target conversation through `lib/composer-inbox.ts`: the composer showing that conversation takes it as a dropped file, and it waits there until one does.
- The composer's `@` menu lists open web tabs and running apps above the files (`attach/mention-sources.ts`). A tab is written as a markdown link to its address and an app as its name and bundle id, so "this tab" resolves without the model guessing. Running apps come from `computer_use_apps` with `running: true`, which lists regular apps other than the refused ones and is kept for ten seconds in the page.

## Implementation status

- Implemented: `computer_use_agent` with the `app`, `browser` and `vm` targets, per-target guides on first use, several steps, code mode, `fresh` agents with a carried session rule, `describe` grounding through gui_harness, the VM target over the OSWorld HTTP API (through the outbound policy as the `computer_use.vm` consumer), and the web presentation; unit tests cover routing, guides, the VM scripts, grounding and approval, and a sandbox test runs code against stub targets. Not yet run against a live VM server or with gui_harness's detector installed in the App.
- Implemented: the `app` target on macOS with the reading and acting actions above, stable indices, adaptive settling, background pointer and keyboard delivery, tree diffs, per-app approval with the four scopes, system-access gating, web presentation, unit tests for keys, tree numbering, menu matching, several steps, rules and approval wiring.
- Implemented for the browser target: every row of the parity table above, on all three backends, with tests that run the page scripts in Chromium, and the per-call approval of `evaluate`.
- Implemented: OCR text for windows with a sparse tree and as the `find` fallback, with a test that reads a rendered image through Vision.
- Implemented: per-application audio recording with WAV output and Voice-engine transcription.
- Implemented: visible tabs and `changes_only` observations on the native backends.
- Implemented: recordings as audio input for Gemini and Chat Completions audio models; tool-result screenshots on Chat Completions vision models.
- Implemented: element comments and region screenshots in web tabs; `@`-mentions of open tabs and running apps.
- Implemented: outlines of icons and controls without text in sparse windows.
- Implemented: the Linux (X11) backend described above. It is tested in a Debian 12 container with Xvfb, Openbox, the AT-SPI bus and PipeWire against a GTK 3 window (menu bar, entry, password entry, check box, slider, scrolled text view, drawing area, a button that plays sound from a child process), GNOME Calculator (GTK 4 with libadwaita, launched from its desktop entry, 7×6 computed by element clicks) and ImageMagick `display` (an Xt client without AT-SPI, read by OCR). Host-independent parts have unit tests.
- Implemented: windows on other Spaces, tested from Desktop 1 against Calculator on Desktop 2 (listing, screenshot, element presses computing 7×6, a coordinate click, a scroll, the key errors), with the pointer and the front app unchanged and the window left on its Space; inserting text there is not covered, since Calculator has no text field.
- Implemented, not yet run on Windows: the Windows backend described above. The macOS machines it is built on have no Windows guest, so only its host-independent parts (PNG encoding, key mapping, the HTML clipboard payload, Start menu parsing, the control-type table, refusals, the recording format) have unit tests.
- Implemented on macOS: the agent cursor over desktop apps, with unit tests for the step point frames and the desktop cue window. Not implemented: the Linux and Windows backends emit no step points, so no cursor shows there.
- Implemented: the user's Chrome and Edge in the `browser` target over Playwright MCP's extension mode, with unit tests for the action mapping, Edge, stopping on failure, `verify` and the approval subject. Not yet run against the Playwright Extension in a live browser.
- Implemented on macOS: the window marker, with unit tests for watching, switching and idle release. Not implemented on Linux and Windows.
- Not implemented: audio input over the Responses and Anthropic APIs, whose models take no audio; moving a window from another Space, and typing into it with keys (see above); naming an icon from its outline (the model reads the screenshot).
