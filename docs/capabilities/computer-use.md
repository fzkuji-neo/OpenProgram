# Computer use

The `computer_use` tool lets the model read and operate the windows of a macOS application while you keep working: the application stays in the background, the keyboard and mouse remain yours, and nothing is brought to the front. The model sees a screenshot of the window together with its Accessibility tree, acts on a numbered element, and gets back only the lines that changed.

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

After an action the tool waits for the window to settle instead of a fixed pause: at least 0.3 seconds, until the tree stops changing, at most 1.5 seconds — or 5 seconds while a spinner or progress bar is showing.

## Actions

| Action | Arguments | Effect |
|---|---|---|
| `list_apps` | — | Running and installed applications, with bundle ids |
| `list_windows` | `app` | The app's windows with their `window_id`, title, size, and whether each is main, focused, minimised or on another Space |
| `get_app_state` | `app`, `window?` or `window_id?`, `full?`, `include?` | Screenshot and tree. A closed app is launched in the background. `window` picks one by title substring or index; the window read last stays selected. `include` is `all`, `tree` or `screenshot` |
| `zoom` | `app`, `x`, `y`, `width`, `height` | A region of the last screenshot at the display's full pixel density, for small text. Action coordinates still refer to the screenshot |
| `find` | `app`, `text?`, `role?` | Elements of the last tree whose label, value or placeholder contains `text`, optionally of one role (`button`, `text field` …) |
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
| `batch` | `app`, `actions` | Up to 20 of the acting steps above, run in order on one app; stops at the first error and returns the state once, at the end |

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

A page in the App's browser stays in the background throughout: the events are dispatched inside the page and the tab is not activated. On the Playwright and Chrome DevTools MCP backends an option the backend cannot perform, such as a triple click or a held key, fails with `unsupported_option` before anything is sent.

## Approval

The first time a conversation touches an application, an approval card names it and offers:

- **Allow once** — this one call.
- **Allow this conversation** — every later `computer_use` call on the same application in this session, saved as a session rule.
- **Always allow** — saved as the project rule `computer_use(<app>)`, so future sessions in the project do not ask again.
- **Deny**.

The card appears in every permission mode, Auto and Bypass included: only a saved rule for that application skips it. Scheduled and other unattended runs cannot answer a card, so they can only operate applications already allowed for the project. `list_apps` never asks. Each application is approved separately: allowing Notes says nothing about Mail. Rules can be inspected and removed like any other permission rule; see [Permissions](permissions.md).

## Requirements

- macOS. Windows and Linux are not supported yet.
- The signed runtime (`ai.openprogram.runtime`) must hold **Accessibility** and **Screen Recording**. The tool reports which grant is missing, and Settings → System access requests it. [Permissions](permissions.md) describes how macOS grants work for the runtime.

## What the tool refuses

The tool does not type into secure text fields or while macOS reports secure keyboard input, and it never operates the Keychain Access and Passwords apps, system login and authorisation prompts, or OpenProgram itself. When a task needs one of those steps, the model asks you to do it.

The tool's description asks the model to check with you before deleting data, sending messages, submitting forms, spending money, changing accounts, permissions or system settings, and installing software, and to hand CAPTCHAs, password entry and security prompts to you. Text shown in a window is never treated as your permission.

The tool is not offered in WeChat and Telegram channels, nor in plan mode.
