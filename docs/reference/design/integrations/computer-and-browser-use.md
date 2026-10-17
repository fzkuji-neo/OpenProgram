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

Each Claude app tool group and where it lands:

| Claude app | OpenProgram |
|---|---|
| list apps and windows, screenshot, zoom | `list_apps`, `list_windows`, `get_app_state`, `zoom` |
| click (double, triple, right, with modifiers), type, key, hold a key | `click` (`click_count`, `mouse_button`, `key`, `duration`), `type_text`, `press_key` (`duration`) |
| scroll, drag, hover, wait | `scroll`, `drag`, `hover`, `wait` |
| menu, AX find, focus, batch | `menu`, `find` (with OCR fallback), `focus`, `batch` |
| request / release an application | the per-application approval card and its `computer_use(<app>)` rule; nothing to release, since nothing is held |
| display-scope full control (real pointer and keyboard) | absent by design: background delivery covers coordinate input; on Linux and for Windows chords the window comes forward only for the step, and the approval card says so |
| browser tools | `web_use` |
| `framebuffer_*` for virtual machines | absent: a VM's window is an ordinary application window, read by screenshot and OCR and driven by coordinates |

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
| `openprogram/programs/tools/system/computer_use.py` | the registered tool: schema, description with the confirmation policy, approval reason, batch, result assembly |

### Background delivery

Element actions go through Accessibility: `AXPress` / `AXConfirm` / `AXPick`, then `AXSelected`, then focus, then a pointer click at the element's centre as the last resort; `AXShowMenu` for right clicks; `AXValue` for `set_value`; `AXSelectedTextRange` (UTF-16 offsets) for `select_text`; page scrolling actions, then the scrollbar's value, then wheel events for `scroll`.

Pointer events that have to be real (coordinate clicks, drags, wheel) are posted with the recipe the open-source cua-driver established: a focus-without-raise record posted to the target process serial number, a `mouseMoved` primer, the event stamped with click state, button, subtype 3, target pid, window id and a click group, `CGEventSetWindowLocation` for the window-relative position, and `SLEventPostToPid` for delivery. Keyboard events carry an `SLSEventAuthenticationMessage` so the receiving process accepts them; without SkyLight the code falls back to `CGEventPostToPid`. The result is a click the application handles as if the user clicked, while the real cursor stays where it is and the front application does not change.

A window is chosen by `window` (title substring or index) or `window_id`; without either, the window the model read last stays selected while it is open, then the focused or main window. A minimized window or a hidden app still gives its tree; the screenshot is unavailable until `show_window` un-minimizes it (`AXMinimized`) or unhides the app, neither of which activates it. A window on another Space is read and operated where it is. `AXWindows` lists only the current Space's windows, so the app's off-screen ordinary windows (layer 0, at least 80×60) that no listed window covers are looked up by SkyLight's remote token: `_AXUIElementCreateWithRemoteToken` with the pid, `0`, `'coco'` and an element id, trying ids from zero (at most 4000) until each window id has its element, as AltTab does; the result is kept per app until that set of ids changes. ScreenCaptureKit captures such a window and SkyLight's pointer route reaches it, but the window server drops key events for it whatever their route, so `type_text` and `paste` there set the focused element's `AXSelectedText` instead, `press_key` reports that keys do not arrive, and `show_window` says the window stays on its Space. Moving it is not possible: since macOS 14.5 only the Dock may (`SLSMoveWindowsToManagedSpace` from any other process needs System Integrity Protection relaxed, as yabai documents).

`paste` writes the pasteboard (plain text, or HTML rendered from Markdown with `markdown-it`), sends Cmd+V to the target process, and restores the previous pasteboard contents when the change count shows nothing else wrote in between.

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

The tool's description is rewritten for Linux at import (`_LINUX_DESCRIPTION`): which steps bring the window forward, plain-text `paste`, clipboard-free `copy`, the Linux refusals. The `computer_use_apps` WebSocket reply carries the worker's `platform`, and on Linux the approval card states for coordinate input, drags, hovers and keys other than Return (`needsForeground`) that the window comes forward for that step.

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

The tool's description is rewritten for Windows at import (`_WINDOWS_DESCRIPTION`), and the approval card says for a chord or a paste (`needsForeground(args, "windows")`) that the window comes forward for that step.

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

A `computer_use` approval card (`computer-use-approval.tsx`) leads with the application itself: its icon, display name and bundle id come from the `computer_use_apps` WebSocket action, which calls the backend's `app_info` and launches nothing, and the web caches them per name (`lib/net/computer-use-apps.ts`). Below it a chip names the step in words (`computer-use-step.ts`), two lines state that the step runs in the background (or, for audio, that only that application's sound is recorded) and what the offered scopes cover, and the arguments without empty values fold into "Execution details".

The project's Settings tab has a Computer use section (`computer-use-apps-section.tsx`) between the default settings and the permission rules. It lists the project's `computer_use(<app>)` allow rules as one row per application with icon, name, bundle id and a remove control, and the generic rule list leaves those rules out. Removing a row removes the rule. Conversation-scoped grants are session rules that end with their conversation, so the section does not list them.

The person points the agent at things the way Codex lets them:

- In a web tab, **Comment on the page…** picks one element and adds its selector, text and the comment to the draft; **Screenshot a region…** lets them drag a rectangle and adds those pixels as a PNG attachment. Both run in one isolated world (`PICKER_WORLD` in `apps/desktop/main/web-views.js`) that shares a cancel hook, so one mode ends the other. The region overlay is removed and two frames are painted before `capturePage` takes the rectangle, scaled by the page zoom. The file reaches the target conversation through `lib/composer-inbox.ts`: the composer showing that conversation takes it as a dropped file, and it waits there until one does.
- The composer's `@` menu lists open web tabs and running apps above the files (`attach/mention-sources.ts`). A tab is written as a markdown link to its address and an app as its name and bundle id, so "this tab" resolves without the model guessing. Running apps come from `computer_use_apps` with `running: true`, which lists regular apps other than the refused ones and is kept for ten seconds in the page.

## Relation to the GUI Agent

The GUI Agent workflow (`gui_agent`), its grounding pipeline and its capability planner are unchanged. `computer_use` does not call it and it does not call `computer_use`. Whether the workflow later becomes a thin sub-agent that runs on `computer_use` through the generic `agent` tool is an open decision, taken only after the base tools are complete.

## Implementation status

- Implemented: `computer_use` on macOS with the reading, acting and batch actions above, stable indices, adaptive settling, background pointer and keyboard delivery, tree diffs, per-app approval with the four scopes, system-access gating, web presentation, unit tests for keys, tree numbering, menu matching, batch, rules and approval wiring.
- Implemented for `web_use`: every row of the parity table above, on all three backends, with tests that run the page scripts in Chromium, and the per-call approval of `evaluate`.
- Implemented: OCR text for windows with a sparse tree and as the `find` fallback, with a test that reads a rendered image through Vision.
- Implemented: per-application audio recording with WAV output and Voice-engine transcription.
- Implemented: `web_use` visible tabs and `changes_only` observations on the native backends.
- Implemented: recordings as audio input for Gemini and Chat Completions audio models; tool-result screenshots on Chat Completions vision models.
- Implemented: element comments and region screenshots in web tabs; `@`-mentions of open tabs and running apps.
- Implemented: outlines of icons and controls without text in sparse windows.
- Implemented: the Linux (X11) backend described above. It is tested in a Debian 12 container with Xvfb, Openbox, the AT-SPI bus and PipeWire against a GTK 3 window (menu bar, entry, password entry, check box, slider, scrolled text view, drawing area, a button that plays sound from a child process), GNOME Calculator (GTK 4 with libadwaita, launched from its desktop entry, 7×6 computed by element clicks) and ImageMagick `display` (an Xt client without AT-SPI, read by OCR). Host-independent parts have unit tests.
- Implemented: windows on other Spaces, tested from Desktop 1 against Calculator on Desktop 2 (listing, screenshot, element presses computing 7×6, a coordinate click, a scroll, the key errors), with the pointer and the front app unchanged and the window left on its Space; inserting text there is not covered, since Calculator has no text field.
- Implemented, not yet run on Windows: the Windows backend described above. The macOS machines it is built on have no Windows guest, so only its host-independent parts (PNG encoding, key mapping, the HTML clipboard payload, Start menu parsing, the control-type table, refusals, the recording format) have unit tests.
- Not implemented: audio input over the Responses and Anthropic APIs, whose models take no audio; moving a window from another Space, and typing into it with keys (see above); naming an icon from its outline (the model reads the screenshot).
