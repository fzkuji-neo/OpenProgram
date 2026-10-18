# Computer use

One tool, `computer_use_agent`, lets the model operate a screen: the windows of a desktop application, a web browser (the App's built-in one, or your own Chrome or Edge), or a virtual machine. Application windows are read and operated while you keep working: the application stays in the background, the keyboard and mouse remain yours, and nothing is brought to the front. The model sees a screenshot of the window together with its Accessibility tree, acts on a numbered element, and gets back only the lines that changed. Applications are supported on macOS, on Linux under X11 and on Windows, with the differences listed in [On Linux](#on-linux) and [On Windows](#on-windows).

## Targets and guides

Every call names a `target`:

| Target | What it operates | Needs |
|---|---|---|
| `app` | Application windows on this computer, named by `args.app`: Finder, Notes, Calculator, Xcode, a chat client, a game launcher | The desktop grants below |
| `browser` | Web pages, in the browser named by `args.browser`: the App's built-in browser by default (tabs in the App's windows and tabs it opens in the background), or your own Chrome or Edge | The App; for Chrome or Edge, see [Your own Chrome or Edge](#your-own-chrome-or-edge) |
| `vm` | A remote machine behind an OSWorld-compatible server | `computer_use.vm_url`, see [Virtual machine](#virtual-machine) |

The tool's description is only this list. The first call to a target in a conversation returns that target's guide, its actions and their arguments, together with the target's current state, so the model learns the actions of the screen it is about to use and nothing else. `action="guide"` shows the guide again.

## What a step looks like

```
computer_use_agent(target="app", args={"app": "Calculator"})
```

returns the guide, the window screenshot and a tree such as

```
0 window "Calculator" actions: AXRaise
  12 static text value="0"
  18 button "7"
  23 button "All Clear"
```

Each line is one element: its index, its role, its label, its current value, state flags such as `[focused]` or `[checked]`, and any secondary actions it offers. The model then acts on an index:

```
computer_use_agent(target="app", action="click", args={"app": "Calculator", "element_index": 18})
```

Every action returns `Done: …` followed by a diff of the tree: lines prefixed `-` disappeared, lines prefixed `+` are new or changed. Indices are stable: an element keeps its index while it stays in the window, even when something is inserted above it, and a new element gets a number not used before, so an index read earlier never silently points at something else. Pass `full=true` to `get_app_state` to receive the whole tree again. Trees are capped at 1500 elements and screenshots at 1568 pixels on the long side.

Some applications draw their content without describing it to Accessibility: games, canvas editors, remote desktops, some Electron apps. When a window's tree has fewer than 12 elements, the state also lists the text macOS reads off the screenshot, one line each with the pixel position of its centre, such as `"New Game" at (160, 215), 120x30`; the model clicks it with `x`,`y`. Recognition runs on the Mac, uses your preferred languages first and detects the language per screenshot. The same state lists icons and controls that carry no text, such as a gear or a trash can, as outlines with their centre and size, like `(112, 169), 55x56`; the model looks at the screenshot to tell what each one is before clicking it.

After an action the tool waits for the window to settle instead of a fixed pause: at least 0.3 seconds, until the tree stops changing, at most 1.5 seconds — or 5 seconds while a spinner or progress bar is showing.

## Application actions

| Action | Arguments | Effect |
|---|---|---|
| `list_apps` | — | Running and installed applications, with bundle ids |
| `list_windows` | `app` | The app's windows with their `window_id`, title, size, and whether each is main, focused, minimised or on another Space |
| `get_app_state` | `app`, `window?` or `window_id?`, `full?`, `include?` | Screenshot and tree. A closed app is launched in the background. `window` picks one by title substring or index; the window read last stays selected. `include` is `all`, `tree` or `screenshot` |
| `zoom` | `app`, `x`, `y`, `width`, `height` | A region of the last screenshot at the display's full pixel density, for small text. Action coordinates still refer to the screenshot |
| `find` | `app`, `text?`, `role?` | Elements of the last tree whose label, value or placeholder contains `text`, optionally of one role (`button`, `text field` …). When no element matches, the lines of the screenshot that show `text`, with their position |
| `click` | `app`, `element_index` or `x`,`y` or `describe`, `mouse_button?`, `click_count?`, `key?`, `duration?` | Press an element, or click a point of the last screenshot. `key` holds modifiers such as `cmd` or `shift+alt`; `duration` holds the button down, up to 10 seconds |
| `type_text` | `app`, `text`, `element_index?` | Type into the focused element, focusing `element_index` first when given. Refused when the element is a button or another control that cannot take text |
| `press_key` | `app`, `key`, `element_index?`, `duration?` | One chord in xdotool spelling: `Return`, `Escape`, `super+c`, `ctrl+shift+Tab`, `KP_0`, `F5`. `super` and `cmd` are the Command key |
| `set_value` | `app`, `element_index`, `value` | Replace a field's value, move a slider, toggle a checkbox |
| `scroll` | `app`, `element_index` or `x`,`y` or `describe`, `direction?`, `pages?` or `pixels?` | Scroll by pages (fractions allowed) or by a distance in points |
| `drag` | `app`, `x`,`y` or `describe`, `to_x`,`to_y` or `to_describe` | Drag between two points of the last screenshot |
| `perform_secondary_action` | `app`, `element_index`, `action_name` | One of the element's listed actions, e.g. `AXShowMenu`, `AXIncrement` |
| `select_text` | `app`, `element_index`, `text`, `prefix?`, `suffix?`, `selection_type?` | Select a phrase inside a text element, or place the cursor before or after it |
| `paste` | `app`, `text`, `format?`, `element_index?` | Insert through the clipboard as `text`, `md` or `html`; the clipboard is restored afterwards |
| `copy` | `app`, `element_index?` | Run the app's own Copy on the current selection and return the copied text; the clipboard is restored afterwards |
| `focus` | `app`, `element_index` | Move keyboard focus to an element without clicking it |
| `menu` | `app`, `menu_path?` | Without a path, list the menu bar. With a path such as `["View", "Scientific"]`, list that menu (with shortcuts, checked and disabled items) or choose a leaf item. Titles match without regard to case or a trailing `…`; no menu opens on screen |
| `show_window` | `app`, `window?` or `window_id?` | Restore a minimised window or unhide the app, without bringing it to the front |
| `hover` | `app`, `element_index` or `x`,`y` or `describe`, `duration?` | Rest the pointer over an element for `duration` seconds (default 0.8) so tooltips and hover menus open; your cursor does not move. Apps that ignore the pointer while in the background show nothing |
| `wait` | `app`, `duration?` | Let up to 10 seconds pass (default 1), then return what changed: a page loading, playback, a reply arriving |
| `start_audio_recording` | `app`, `max_duration?` | Record the sound that app plays, for up to `max_duration` seconds (default 60, at most 300). Only that app is recorded and you keep hearing it; other actions run meanwhile |
| `stop_audio_recording` | `app`, `transcribe?` | Stop, save a 16 kHz WAV and return its path; with a speech engine set up in Settings → Voice, also the transcript |

`app` is a name, bundle id or `.app` path as `list_apps` prints it. `x` and `y` are pixels of that app's most recent screenshot, not screen coordinates.

Element actions reach windows that are hidden, minimised or covered by another window. Coordinate clicks, drags and wheel scrolls also run in the background: the pointer does not move and the front application does not change. Coordinates exist for canvases and custom controls that the tree does not describe; prefer an index whenever one is listed.

On macOS the desktop App shows where each step lands: the agent cursor, the same one that marks actions on the App's Pages, glides over the application's window to the element or point and plays a click there, while your own pointer stays put. **Show actions** in the browser toolbar turns it off for Pages and applications alike. While the agent works in a window, macOS also marks that window as shared: a purple badge covers its title-bar buttons and the screen-sharing icon shows in the menu bar. Both go away about 20 seconds after the last step.

## Several steps, code and a new agent

Several steps go in `actions`, up to 20, run in order on one app. They stop at the first error and return the state once, at the end; every step uses the indices and coordinates of the state read before them:

```
computer_use_agent(target="app", args={"app": "Calculator"}, actions=[
  {"action": "click", "args": {"element_index": 18}},
  {"action": "press_key", "args": {"key": "KP_Multiply"}},
  {"action": "click", "args": {"element_index": 18}},
  {"action": "press_key", "args": {"key": "KP_Enter"}}
])
```

For loops, conditions and data handling the model sends `code` instead: Python with top-level `await`, run in an isolated interpreter without files, network or processes, whose variables last for the turn. Each target is an object whose methods are its actions: `await cu.app.click(app="Numbers", element_index=3)`, `await cu.browser.observe()`, `await cu.vm.screenshot()`. Code acts only on the app the call names, cannot run page scripts, upload files or open a new website, and runs at most 120 seconds and 100 actions per call. Code runs on macOS only.

`context` says who does the work. `inherit`, the default, means the model operates the screen itself in this conversation and sees every result. `fresh` hands the task to a new agent of the same model and settings: it starts from a `brief` (the task, what is already known, what to report back) and the target's guide, does the work with its own `computer_use_agent` calls, and only its final reply comes back. Use it for long operations whose intermediate screens the conversation does not need. A fresh agent cannot start another one.

## Pointing by description

Wherever an action takes `x`,`y`, the model may give `describe` instead: a short description of the target as it looks, such as "the blue Send button" or "the gear icon top right" (`to_describe` for the end of a drag). The tool takes a fresh screenshot, finds the description with the GUI perception package (an icon detector, OCR and remembered components, checked by the conversation's model) and acts at the centre of what it found. It is slower and costs model calls, so element indices and refs come first; it pairs well with a fresh agent working from a written brief.

The package is the [GUI-Agent-Harness](https://github.com/Fzkuji/GUI-Agent-Harness) Program. Every release includes it with the GPA detector weight, but the libraries its detector runs on (PyTorch, OpenCV, EasyOCR) are not in the product runtime, so `describe` works only where they are installed, such as a development environment. Elsewhere the guide says `describe` is unavailable and the other ways to point remain.

## Web pages

The `browser` target drives the Pages of the App's built-in browser: `list_pages` lists them, `observe` returns refs, and every other action acts on a ref. Besides `navigate`, `click`, `type`, `press`, `scroll`, `hover`, `select`, `upload` and `screenshot`, it offers the same vocabulary as application windows:

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

A page in the App's browser stays in the background throughout: the events are dispatched inside the page and the tab is not activated. `observe` with a `url` opens its tab behind your work too; `visible: true` brings it to the front instead, for when you asked to watch. `changes_only: true` lists in full only the elements that are new or changed since the previous observation of the same page: an unchanged element is one line with its new ref, an unchanged page text or accessibility snapshot is left out, and elements that disappeared are named. Refs always belong to the latest observation.

The conversation's Pages need no approval. Opening a website outside your computer, and uploading a file, ask first. A script can read and change everything a signed-in page holds, so every `evaluate` call asks you first and shows the whole script, in every permission mode and even when a rule allows `computer_use_agent`. That approval covers the one call: there is no "always allow" for it, and scheduled or channel turns that cannot ask are refused.

## Watching and taking over Pages

In the desktop App, Agent-opened Pages remain in the background. Open **Resources** in the right sidebar to see the current conversation's Pages grouped by branch, including Pages used by its child agents. Continuing a branch keeps its resource group. Distinct Pages stay distinct even when they have the same URL; pages without established branch ownership appear under **Unassigned**.

A popup or new window opened by an Agent's Page loads in the background as a Page of its own and joins the same conversation and branch in **Resources**; it does not take over your view. The Agent's next result for the opening Page names the popup, so the Agent continues there instead of starting the same flow again. A popup from a Page you opened yourself opens in front as an ordinary tab.

Select a resource to inspect its image preview in chat. **Preview in conversation** is the explicit control for the same existing Page: it does not add a top tab and if a webpage currently occupies center, returns to the owning session so the chat preview is visible. The chat preview chrome has a persistent **Pin preview** / **Unpin preview** control: pin holds the current page as Fixed preview; unpin returns to Auto preview of the Page most recently operated on by that branch. Selecting a resource shows it without pinning and does not steal tab focus; in Auto preview, the next Page the Agent reads or operates on replaces it. Opening, reading and acting on a Page all count, not only clicks and typing. These pin controls exist only on the chat preview; Session resources has no pin control. **Hide** stops preview capture and keeps the Page available. Restore a hidden preview with the resource row or **Preview in conversation**; there is no separate Show preview control. **Expand** enlarges the image preview without changing Auto or Fixed preview. **Open page** opens the existing Page as an ordinary top tab and hides the chat preview. Returning to the conversation restores the preview unless it was hidden. These controls keep their selection per conversation and branch. A pin lasts until the app reloads; afterwards the preview is in Auto preview again.

A webpage tab and its preview never display together. The actual webpage remains usable in its own tab. There is no dimming mask. Its toolbar identifies the current controller and provides **Pause Agent to use page**, **Continue Agent**, **Show actions**, and **Operation history**. The chat preview uses a single compact chrome row; Idle and closed pages show **Ready to use** and have no Pause or Continue control. The default overlay is 300×198.75. Drag the header to move it, or resize from any edge or corner; the image aspect stays linked and the page itself is not resized. Action markers are brief and do not intercept input; history contains operation types and results rather than the text entered into a webpage.

Using the real webpage requests a pause: clicking, typing, scrolling, and navigating close later Agent input admission and request execution pause. Merely focusing the page or inspecting its preview does not pause execution. An action already dispatched can still finish. **Pausing…** means stopping is pending; **Paused** requires execution acknowledgement and reconciliation. **Could not pause. Try again** means the App has not confirmed stopping; **Retry pause** repeats the pause request while connected, and the webpage remains usable. **Continue Agent** is explicit and requires a fresh observation and current permission.

Closing a Page affects every branch reference to that same Page. An active Page first requests stopping; it stays available until stopping is confirmed. Closing is separate from hiding the preview. Disconnection or an unavailable target shows the last image as stale. Saved resource metadata does not restore an Agent input lease or recreate a closed Page.

If the App or worker restarts, pages you had not closed come back in the background without extra top tabs. The retained tab, session, and branch stay; the last confirmed title and URL stay. The App creates a new live page for that retained tab. Previous live handles are invalid. Explicitly closed pages stay under **Closed pages**. A hidden preview stays hidden until you select the resource or use **Preview in conversation**. Rows that are restoring, failed to restore, or need a reconnect stay in the original branch and show **Restoring page…**, **Could not restore page**, or **Reconnect**. They do not move to a generic Unavailable group. Restoring a page does not require **Continue Agent**. Idle pages stay **Ready to use**. New task actions still use a fresh observation and current permission on the new page. Restore reloads the last confirmed URL with existing site persistent storage; unsaved DOM and form values from the old process are not restored. An older resource record with no retained tab descriptor cannot be recreated automatically and reports **Could not restore page** in its original group. This bounded restart recovery is implemented.

The chat preview also follows the other things the Agent works on. When it acts on a desktop app window, the preview shows that app with the latest screenshot the Agent took of the window, refreshed after every step. When it takes or types into a Desktop Terminal, the preview shows that terminal's live output, read-only. The same Auto preview, pin and close rules apply; the next Page the Agent works on takes the preview back. Screenshots stay in memory and are not kept after the worker restarts.

These controls operate on exact OpenProgram Pages. Application windows and VM displays keep their own approvals described above.

## Your own Chrome or Edge

The `browser` target works in the browser you browse with when a call sets `args.browser` to `chrome` or `edge`, so pages open with your sign-ins and cookies. The actions are the same as in the built-in browser: `list_pages` lists your tabs by index, `observe(page=<index>)` switches to one and `observe(url=…)` opens a new tab, and `click`, `type`, `press`, `scroll`, `screenshot`, `verify` and the rest act on refs from that observation. The model is told to use your browser only when you name it or the task needs your signed-in state, and to stay in the browser you named.

It runs Microsoft's Playwright MCP server in extension mode (`@playwright/mcp --extension`), and the [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm) in your browser connects to it; Edge installs the same extension from the Chrome Web Store. Install it once; the server itself is fetched with `npx`, so Node.js must be installed. On the first action the extension asks which tab to share. To connect without that prompt, copy the token the extension shows and set it:

```bash
openprogram config set computer_use.chrome_extension_token <token>
```

One approval covers your Chrome (or Edge) for the conversation; `evaluate` (page JavaScript) asks every time, and `upload` names the upload. Code mode does not reach your browser.

## Virtual machine

The `vm` target drives a machine behind an [OSWorld](https://os-world.github.io/)-compatible server: the tool takes screenshots with `GET /screenshot` and runs pointer and keyboard input through `POST /execute` with pyautogui on that machine. Set the server's address once:

```bash
openprogram config set computer_use.vm_url http://192.168.64.2:5000
```

The VM has no element tree: its actions are `screenshot`, `click`, `move`, `drag`, `scroll`, `type_text`, `press_key` and `wait`, pointed by pixels of the last screenshot or by `describe`. Every acting call returns a new screenshot. The first use of a VM in a conversation asks for approval, which names the endpoint.

## Approval

The first time a conversation touches an application, an approval card shows that application with its own icon, name and bundle id, says what this step does ("Click element #7", "Type 12 characters", "Run code that operates it"), and states that it runs in the background. The raw arguments sit under "Execution details". The card offers:

- **Allow once** — this one call.
- **Allow this conversation** — every later `computer_use_agent` call on the same application in this session, saved as a session rule.
- **Always allow** — saved as the project rule `computer_use_agent(<app>)`, so future sessions in the project do not ask again. Rules saved under the tool's earlier name, `computer_use(<app>)`, keep working.
- **Deny**.

The card appears in the modes that ask (Default and Accept edits) until a saved rule names that application. Bypass operates applications without asking, and Auto reviews each operation like any other tool call. Scheduled and other unattended runs cannot answer a card, so outside Bypass they can only operate applications already allowed for the project. `list_apps` never asks. Each application is approved separately: allowing Notes says nothing about Mail. A `fresh` agent runs on the approval its call received: for as long as it works, that application is allowed in the conversation. The project's Settings tab lists the always-allowed applications under **Computer use**, one row per application with its icon; removing a row removes its rule, and the next use of that application asks again. Grants for one conversation end with it and are not listed. See [Permissions](permissions.md) for rules in general.

Allowing an application lets the model operate it; it does not let the model take consequential steps on its own. The tool instructs the model to confirm with you before sending a message, submitting a form, buying, deleting, or following instructions that appear on screen. CAPTCHAs, passwords and security prompts are handed to you. Text the model reads on screen is never treated as your permission.

## System access

System settings shows live optional desktop access on the execution computer.
Opening this page or running `openprogram doctor` does not request permission.
The TUI `/doctor` command and `GET /api/system/access` expose the same checks.
Missing optional desktop access does not prevent ordinary chat or upgrades.

On macOS, managed installations run the worker and its Python children through
**OpenProgram**, an embedded application with the OpenProgram icon and
a stable bundle identifier. This is the name to look for in System Settings;
the installer does not grant its permissions. Screen recording and Accessibility
are checked separately in a fresh process of the executable used for desktop tasks. In local System settings, **Set up access** explicitly requests
only a missing permission; an existing grant is left untouched. Complete the
system confirmation, then return to the page for automatic verification.
Remote clients must arrange authorization on the execution computer. A grant
for another application is not evidence that the worker is authorized.

Linux headless sessions and unsupported Wayland desktop capture are reported
separately from missing dependencies. An X11 display alone does not prove access.
Windows desktop access depends on the active session and target; ordinary
applications cannot assume access to secure desktops or elevated targets.
Neither platform is instructed to disable security or run the entire application
as administrator. Native Linux and Windows desktop acceptance remains unverified.

The current macOS development build is not production-signed. Permission
persistence across signed release upgrades, first-run capability onboarding,
and automatic task recovery after authorization remain unverified. System
access setup never retries a declined operation.


### Authorization

An application call pauses before it acts when system access is missing. OpenProgram requests the missing permission through the native authorization flow and opens the corresponding System Settings page when necessary. The conversation shows a brief paused waiting status and an Open System Settings text action, without a permission form, Continue button, null result, Retry, or Edit action on the paused runtime card. Genuine failed and cancelled runs keep their own terminal statuses.

The background worker saves the waiting task and checks permission through a fresh OpenProgram process, using the same executable as the desktop task. This avoids reusing a permission result retained before the system setting changed. These checks do not request permission. Once access is available, it continues the same task once. Closing the page does not stop this check. If an application restart is needed, the saved task is checked again after startup. Cancelling the task prevents later continuation. A failed check keeps the task waiting; it is never treated as permission granted. Viewing an old conversation does not itself start an operation or reopen system prompts. System access does not replace operation approval.

On local ad-hoc macOS builds, an update can invalidate a previously granted recording permission while the system switch remains enabled. OpenProgram remembers successful recording checks for its installed application. If a later application identity changes and recording is denied, the next local authorization action renews only OpenProgram’s obsolete recording registration before opening the native permission flow. This recovery runs at most once per changed identity; status checks and reconnects never reset permissions. Stable Developer ID releases use the normal system authorization flow.

Repeated delivery of the same waiting task does not reopen native authorization when you switch conversations. You can still open System Settings explicitly.

### Automation errors on macOS

Some desktop commands send Apple Events to System Events or a target application. macOS controls Automation separately for each target; screen recording and Accessibility access do not imply Automation access. If an operation reports an Automation denial, open **System Settings → Privacy & Security → Automation** on the execution Mac and inspect the requesting application's access to the named target. The failed operation remains failed; changing the system setting does not approve or repeat it. Other native command failures retain their actual error instead of being reported as success.

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

What is the same: the tree format, stable indices and diffs, screenshots, `zoom`, `find`, several steps in `actions`, `menu` (for apps with a menu bar), `select_text`, `set_value`, scroll bars moved by element, and approvals. Applications are named by their desktop entry id (`org.gnome.Calculator`), their name or their process name, as `list_apps` prints them; an installed application is launched through its desktop entry.

What differs:

- Element actions (press, toggle, set a value, insert and select text, choose a menu item, Return in a field) run in the background. Pointer input at `x`,`y` (click, drag, wheel scroll), `hover`, and key presses other than Return reach a GTK or Qt window only while it is focused, so for that step the window comes to the front, receives the input, and then focus and your pointer go back to where they were. `hover` leaves the pointer over the window. The approval card says so for those steps.
- `paste` inserts plain text straight into the focused field and does not use the clipboard; `format=md` and `html` are not available. `copy` returns the selected text without touching the clipboard.
- An application that does not join the accessibility bus is listed with "no accessibility tree": the model reads its screenshot (with OCR when tesseract is installed) and acts by coordinates.
- Recording reads only the application's own streams (and those of its child processes) from PipeWire or PulseAudio. With PipeWire it starts within a quarter second; on PulseAudio without PipeWire the first second or so of a stream that was already playing can be missed.
- Refused: password fields, Seahorse and KWallet, polkit and gcr authentication prompts, and OpenProgram itself.

## On Windows

On Windows the tool reads the window's UI Automation tree, which Win32, WPF, WinForms, Store (UWP and WinUI) and Chromium-based applications expose, and takes screenshots of the window even while it is covered. It needs the `comtypes` package, which the Windows install includes; `tesseract` on `PATH` adds text read off screenshots of apps without a tree. Windows support is new and has not yet been run on a Windows machine by the project; report problems with the step that failed.

What is the same: the tree format, stable indices and diffs, screenshots, `zoom`, `find`, several steps in `actions`, `select_text`, `set_value`, `copy`, `paste` (text, markdown and HTML), scrolling by element, recording and approvals. Applications are named as `list_apps` prints them: the Start menu name (`Calculator`), the executable name (`notepad`) or the process id; an installed application is launched from its Start menu entry.

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
