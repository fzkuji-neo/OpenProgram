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

Every action returns `Done: …` followed by a diff of the tree: lines prefixed `-` disappeared, lines prefixed `+` are new or changed and carry their new index. Pass `full=true` to `get_app_state` to receive the whole tree again. Trees are capped at 1500 elements and screenshots at 1568 pixels on the long side.

## Actions

| Action | Arguments | Effect |
|---|---|---|
| `list_apps` | — | Running and installed applications, with bundle ids |
| `get_app_state` | `app`, `window?`, `full?` | Screenshot and tree. A closed app is launched in the background. `window` picks one by title substring or index |
| `click` | `app`, `element_index` or `x`,`y`, `mouse_button?`, `click_count?`, `key?` | Press an element, or click a point of the last screenshot. `key` holds modifiers such as `cmd` or `shift+alt` |
| `type_text` | `app`, `text`, `element_index?` | Type into the focused element, focusing `element_index` first when given |
| `press_key` | `app`, `key`, `element_index?`, `duration?` | One chord in xdotool spelling: `Return`, `Escape`, `super+c`, `ctrl+shift+Tab`, `KP_0`, `F5`. `super` and `cmd` are the Command key |
| `set_value` | `app`, `element_index`, `value` | Replace a field's value, move a slider, toggle a checkbox |
| `scroll` | `app`, `element_index` or `x`,`y`, `direction?`, `pages?` | Scroll a page per unit; fractions allowed |
| `drag` | `app`, `x`, `y`, `to_x`, `to_y` | Drag between two points of the last screenshot |
| `perform_secondary_action` | `app`, `element_index`, `action_name` | One of the element's listed actions, e.g. `AXShowMenu`, `AXIncrement` |
| `select_text` | `app`, `element_index`, `text`, `prefix?`, `suffix?`, `selection_type?` | Select a phrase inside a text element, or place the cursor before or after it |
| `paste` | `app`, `text`, `format?`, `element_index?` | Insert through the clipboard as `text`, `md` or `html`; the clipboard is restored afterwards |

`app` is a name, bundle id or `.app` path as `list_apps` prints it. `x` and `y` are pixels of that app's most recent screenshot, not screen coordinates.

Element actions reach windows that are hidden, minimised or covered by another window. Coordinate clicks, drags and wheel scrolls also run in the background: the pointer does not move and the front application does not change. Coordinates exist for canvases and custom controls that the tree does not describe; prefer an index whenever one is listed.

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

The tool is not offered in WeChat and Telegram channels, nor in plan mode.
