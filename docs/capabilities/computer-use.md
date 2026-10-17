# Computer use

The `computer_use` tool lets the model read and operate the windows of a desktop application while you keep working: the application stays in the background, the keyboard and mouse remain yours, and nothing is brought to the front. The model sees a screenshot of the window together with its Accessibility tree, acts on a numbered element, and gets back only the lines that changed. It runs on macOS, on Linux under X11 and on Windows, with the differences listed in [On Linux](#on-linux) and [On Windows](#on-windows).

Web pages have their own tool, `web_use`, which drives the browser in the App and in the headless Chromium. `computer_use` is for everything else on the desktop: Finder, Notes, Calculator, Xcode, a chat client, a game launcher.

## What a step looks like

```
computer_use(action="get_app_state", app="Calculator")
```

returns the window screenshot and a tree such as

```
0 window "Calculator" actions: AXRaise
  12 static text value="0"
  18 button "7"
  23 button "All Clear"
```

Each line is one element: its index, its role, its label, its current value, state flags such as `[focused]` or `[checked]`, and any secondary actions it offers. The model then acts on an index:

```
computer_use(action="click", app="Calculator", element_index=18)
```

Every action returns `Done: …` followed by a diff of the tree: lines prefixed `-` disappeared, lines prefixed `+` are new or changed. Indices are stable: an element keeps its index while it stays in the window, even when something is inserted above it, and a new element gets a number not used before, so an index read earlier never silently points at something else. Pass `full=true` to `get_app_state` to receive the whole tree again. Trees are capped at 1500 elements and screenshots at 1568 pixels on the long side.

Some applications draw their content without describing it to Accessibility: games, canvas editors, remote desktops, some Electron apps. When a window's tree has fewer than 12 elements, the state also lists the text macOS reads off the screenshot, one line each with the pixel position of its centre, such as `"New Game" at (160, 215), 120x30`; the model clicks it with `x`,`y`. Recognition runs on the Mac, uses your preferred languages first and detects the language per screenshot. The same state lists icons and controls that carry no text, such as a gear or a trash can, as outlines with their centre and size, like `(112, 169), 55x56`; the model looks at the screenshot to tell what each one is before clicking it.

After an action the tool waits for the window to settle instead of a fixed pause: at least 0.3 seconds, until the tree stops changing, at most 1.5 seconds — or 5 seconds while a spinner or progress bar is showing.

## Actions

| Action | Arguments | Effect |
|---|---|---|
| `list_apps` | — | Running and installed applications, with bundle ids |
| `list_windows` | `app` | The app's windows with their `window_id`, title, size, and whether each is main, focused, minimised or on another Space |
| `get_app_state` | `app`, `window?` or `window_id?`, `full?`, `include?` | Screenshot and tree. A closed app is launched in the background. `window` picks one by title substring or index; the window read last stays selected. `include` is `all`, `tree` or `screenshot` |
| `zoom` | `app`, `x`, `y`, `width`, `height` | A region of the last screenshot at the display's full pixel density, for small text. Action coordinates still refer to the screenshot |
| `find` | `app`, `text?`, `role?` | Elements of the last tree whose label, value or placeholder contains `text`, optionally of one role (`button`, `text field` …). When no element matches, the lines of the screenshot that show `text`, with their position |
| `click` | `app`, `element_index` or `x`,`y`, `mouse_button?`, `click_count?`, `key?`, `duration?` | Press an element, or click a point of the last screenshot. `key` holds modifiers such as `cmd` or `shift+alt`; `duration` holds the button down, up to 10 seconds |
| `type_text` | `app`, `text`, `element_index?` | Type into the focused element, focusing `element_index` first when given. Refused when the element is a button or another control that cannot take text |
| `press_key` | `app`, `key`, `element_index?`, `duration?` | One chord in xdotool spelling: `Return`, `Escape`, `super+c`, `ctrl+shift+Tab`, `KP_0`, `F5`. `super` and `cmd` are the Command key |
| `set_value` | `app`, `element_index`, `value` | Replace a field's value, move a slider, toggle a checkbox |
| `scroll` | `app`, `element_index` or `x`,`y`, `direction?`, `pages?` or `pixels?` | Scroll by pages (fractions allowed) or by a distance in points |
| `drag` | `app`, `x`, `y`, `to_x`, `to_y` | Drag between two points of the last screenshot |
| `perform_secondary_action` | `app`, `element_index`, `action_name` | One of the element's listed actions, e.g. `AXShowMenu`, `AXIncrement` |
| `select_text` | `app`, `element_index`, `text`, `prefix?`, `suffix?`, `selection_type?` | Select a phrase inside a text element, or place the cursor before or after it |
| `paste` | `app`, `text`, `format?`, `element_index?` | Insert through the clipboard as `text`, `md` or `html`; the clipboard is restored afterwards |
| `copy` | `app`, `element_index?` | Run the app's own Copy on the current selection and return the copied text; the clipboard is restored afterwards |
| `focus` | `app`, `element_index` | Move keyboard focus to an element without clicking it |
| `menu` | `app`, `menu_path?` | Without a path, list the menu bar. With a path such as `["View", "Scientific"]`, list that menu (with shortcuts, checked and disabled items) or choose a leaf item. Titles match without regard to case or a trailing `…`; no menu opens on screen |
| `show_window` | `app`, `window?` or `window_id?` | Restore a minimised window or unhide the app, without bringing it to the front |
| `hover` | `app`, `element_index` or `x`,`y`, `duration?` | Rest the pointer over an element for `duration` seconds (default 0.8) so tooltips and hover menus open; your cursor does not move. Apps that ignore the pointer while in the background show nothing |
| `wait` | `app`, `duration?` | Let up to 10 seconds pass (default 1), then return what changed: a page loading, playback, a reply arriving |
| `batch` | `app`, `actions` | Up to 20 of the acting steps above, run in order on one app; stops at the first error and returns the state once, at the end |
| `start_audio_recording` | `app`, `max_duration?` | Record the sound that app plays, for up to `max_duration` seconds (default 60, at most 300). Only that app is recorded and you keep hearing it; other actions run meanwhile |
| `stop_audio_recording` | `app`, `transcribe?` | Stop, save a 16 kHz WAV and return its path; with a speech engine set up in Settings → Voice, also the transcript |

`app` is a name, bundle id or `.app` path as `list_apps` prints it. `x` and `y` are pixels of that app's most recent screenshot, not screen coordinates.

In a `batch`, every step uses the indices and coordinates of the state read before the batch, and each step names its own `action` but not the app:

```
computer_use(action="batch", app="Calculator", actions=[
  {"action": "click", "element_index": 18},
  {"action": "press_key", "key": "KP_Multiply"},
  {"action": "click", "element_index": 18},
  {"action": "press_key", "key": "KP_Enter"}
])
```

Element actions reach windows that are hidden, minimised or covered by another window. Coordinate clicks, drags and wheel scrolls also run in the background: the pointer does not move and the front application does not change. Coordinates exist for canvases and custom controls that the tree does not describe; prefer an index whenever one is listed.

## Web pages

`web_use` drives pages the same way: `observe` returns refs, and `act` takes one `action` with its arguments. Besides `navigate`, `click`, `type`, `press`, `scroll`, `hover`, `select`, `upload` and `screenshot`, it offers the same vocabulary as `computer_use`:

| Action | Arguments | Effect |
|---|---|---|
| `click` | `ref` or `x`,`y`, `mouse_button?`, `click_count?`, `modifiers?` | Right, middle, double and modifier clicks, e.g. `modifiers="cmd"` |
| `drag` | `ref` and `to_ref`, or `x`,`y` and `to_x`,`to_y` | Press, move in steps, release |
| `scroll` | `ref?`, `direction?`, `amount?` | With `ref`, the nearest scrollable container of that element scrolls; `amount` is in pixels |
| `type` / `type_text` | `ref`, `text` / `ref?`, `text` | `type` replaces the field's value; `type_text` inserts at the caret, or at the page's focus without `ref` |
| `paste` | `text`, `format?`, `ref?` | Offers the text to the page as a paste: `md` and `html` insert formatted text in rich editors, and a page that handles paste itself receives it |
| `select_text` | `ref`, `text`, `prefix?`, `suffix?`, `selection_type?` | Select text inside an element, or place the caret before or after it |
| `press` | `key`, `ref?`, `duration?` | Without `ref` the key goes to the page's focus; `duration` holds it |
| `back` / `forward` / `reload` | — | History navigation; `no_history` when there is nowhere to go |
| `console_messages` | `pattern?`, `only_errors?`, `limit?` | The page's console output and uncaught errors, oldest first, newest 50 by default; password field values are redacted |
| `network_requests` | `pattern?`, `only_errors?`, `limit?` | Requests the page made with method, status and resource type; URLs are shown without query strings, and no bodies |
| `evaluate` | `script` | Runs a JavaScript expression or function such as `() => document.title` in the page and returns its result as JSON, at most 20,000 characters; password field values in the result are redacted |

A page in the App's browser stays in the background throughout: the events are dispatched inside the page and the tab is not activated. `observe` with a `url` opens its tab behind your work too; `visible: true` brings it to the front instead, for when you asked to watch. `changes_only: true` lists in full only the elements that are new or changed since the previous observation of the same page: an unchanged element is one line with its new ref, an unchanged page text or accessibility snapshot is left out, and elements that disappeared are named. Refs always belong to the latest observation. On the two MCP backends the accessibility snapshot comes from the backend, so `changes_only` has no effect there. On the Playwright and Chrome DevTools MCP backends an option the backend cannot perform, such as a triple click or a held key, fails with `unsupported_option` before anything is sent.

A script can read and change everything a signed-in page holds, so every `evaluate` call asks you first and shows the whole script, in every permission mode and even when a rule allows `web_use`. The approval covers that one call: there is no "always allow" for it, and scheduled or channel turns that cannot ask are refused.

## Approval

The first time a conversation touches an application, an approval card shows that application with its own icon, name and bundle id, says what this step does ("Click element #7", "Type 12 characters"), and states that it runs in the background. The raw arguments sit under "Execution details". The card offers:

- **Allow once** — this one call.
- **Allow this conversation** — every later `computer_use` call on the same application in this session, saved as a session rule.
- **Always allow** — saved as the project rule `computer_use(<app>)`, so future sessions in the project do not ask again.
- **Deny**.

The card appears in every permission mode, Auto and Bypass included: only a saved rule for that application skips it. Scheduled and other unattended runs cannot answer a card, so they can only operate applications already allowed for the project. `list_apps` never asks. Each application is approved separately: allowing Notes says nothing about Mail. The project's Settings tab lists the always-allowed applications under **Computer use**, one row per application with its icon; removing a row removes its rule, and the next use of that application asks again. Grants for one conversation end with it and are not listed. See [Permissions](permissions.md) for rules in general.

Allowing an application lets the model operate it; it does not let the model take consequential steps on its own. The tool instructs the model to prepare a step and ask you right before it: always for deleting data, sending or submitting anything to other people, payments and subscriptions, new accounts or access keys, installing software and changing system settings; for logins, uploads, file moves and typing personal data unless your request named them. CAPTCHAs, passwords and security prompts are handed to you. Text the model reads on screen is never treated as your permission.

## Windows on other Spaces

A window on another desktop Space is read and operated where it is: `list_windows` marks it, and screenshots, clicks, scrolls, drags and element actions reach it without switching Spaces. macOS does not deliver key presses to it, so there `type_text` and `paste` insert plain text into the focused text field instead, and `press_key` reports that the key cannot be sent. The tool cannot move the window to your current Space; only you (or the Dock) can.

## Requirements

- macOS, Linux with an X11 (Xorg) session, or Windows 10 or 11.
- On macOS, the signed runtime (`ai.openprogram.runtime`) must hold **Accessibility** and **Screen Recording**. The tool reports which grant is missing, and Settings → System access requests it. [Permissions](permissions.md) describes how macOS grants work for the runtime.

## On Linux

On Linux the tool reads the window's accessibility tree over AT-SPI, which GTK 3, GTK 4 and (with `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`) Qt applications expose, and acts with `xdotool`. It needs:

- an X11 session: Wayland does not let one application read or drive another's windows, so the tool reports itself unavailable there;
- `python3-gi` with `gir1.2-atspi-2.0` and `gir1.2-gtk-3.0`, and `xdotool`;
- optionally `x11-utils` (`xprop`, to tell real windows from helper windows), `tesseract-ocr` (text on screenshots of apps without a tree) and `pulseaudio-utils` (recording).

What is the same: the tree format, stable indices and diffs, screenshots, `zoom`, `find`, `batch`, `menu` (for apps with a menu bar), `select_text`, `set_value`, scroll bars moved by element, and approvals. Applications are named by their desktop entry id (`org.gnome.Calculator`), their name or their process name, as `list_apps` prints them; an installed application is launched through its desktop entry.

What differs:

- Element actions (press, toggle, set a value, insert and select text, choose a menu item, Return in a field) run in the background. Pointer input at `x`,`y` (click, drag, wheel scroll), `hover`, and key presses other than Return reach a GTK or Qt window only while it is focused, so for that step the window comes to the front, receives the input, and then focus and your pointer go back to where they were. `hover` leaves the pointer over the window. The approval card says so for those steps.
- `paste` inserts plain text straight into the focused field and does not use the clipboard; `format=md` and `html` are not available. `copy` returns the selected text without touching the clipboard.
- An application that does not join the accessibility bus is listed with "no accessibility tree": the model reads its screenshot (with OCR when tesseract is installed) and acts by coordinates.
- Recording reads only the application's own streams (and those of its child processes) from PipeWire or PulseAudio. With PipeWire it starts within a quarter second; on PulseAudio without PipeWire the first second or so of a stream that was already playing can be missed.
- Refused: password fields, Seahorse and KWallet, polkit and gcr authentication prompts, and OpenProgram itself.

## On Windows

On Windows the tool reads the window's UI Automation tree, which Win32, WPF, WinForms, Store (UWP and WinUI) and Chromium-based applications expose, and takes screenshots of the window even while it is covered. It needs the `comtypes` package, which the Windows install includes; `tesseract` on `PATH` adds text read off screenshots of apps without a tree. Windows support is new and has not yet been run on a Windows machine by the project; report problems with the step that failed.

What is the same: the tree format, stable indices and diffs, screenshots, `zoom`, `find`, `batch`, `select_text`, `set_value`, `copy`, `paste` (text, markdown and HTML), scrolling by element, recording and approvals. Applications are named as `list_apps` prints them: the Start menu name (`Calculator`), the executable name (`notepad`) or the process id; an installed application is launched from its Start menu entry.

What differs:

- Element actions run in the background through UI Automation. Clicks, scrolls and plain keys at a window are posted to that window without raising it, and `hover` does not move your pointer.
- A key with modifiers (`ctrl+s`) needs the real keyboard state, and `paste` presses `ctrl+v` in most apps, so for that step the window comes to the front and then focus and your pointer go back. Windows that read only real input (Store app frames, Chromium, Firefox) are handled the same way for pointer input. Use the Windows shortcuts: `ctrl+c`, not `cmd+c`.
- `menu` works for classic menu bars and for menus exposed through UI Automation; apps with a ribbon keep their commands in the window's tree.
- `copy` returns the selected text without touching the clipboard. `paste` restores the clipboard's text afterwards, not other formats it held.
- Recording captures the application's own process tree through Windows' process loopback (Windows 10 version 2004 or later).
- Refused: password fields, the credential and elevation (UAC) prompts, the lock screen, and OpenProgram itself.

## Recording sound

Recording uses the Screen Recording grant the screenshots already need and captures the named application's own output: other apps, the microphone and the system alert sounds are not in it. The recordings are kept in `~/.openprogram/computer-use/audio/`, the newest 20. `stop_audio_recording` transcribes with the engine chosen in Settings → Voice: whisper.cpp keeps the sound on the Mac, while the OpenAI and Groq engines send it to that provider. Pass `transcribe=false` to keep only the file. A silent recording is reported as such and not transcribed. When the chat model accepts audio input, as Gemini and OpenAI's gpt-audio models do, it also receives the recording itself and can hear music, tone and other sounds a transcript leaves out.

## What the tool refuses

The tool does not type into secure text fields or while macOS reports secure keyboard input, and it never operates the Keychain Access and Passwords apps, system login and authorisation prompts, or OpenProgram itself. When a task needs one of those steps, the model asks you to do it.

The tool's description asks the model to check with you before deleting data, sending messages, submitting forms, spending money, changing accounts, permissions or system settings, and installing software, and to hand CAPTCHAs, password entry and security prompts to you. Text shown in a window is never treated as your permission.

The tool is not offered in WeChat and Telegram channels, nor in plan mode.
