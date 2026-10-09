# Icon system

The web app draws from three icon families. Each has a territory, so a
screen never mixes a filled glyph next to a line glyph by accident.

| Family | Territory | Package / source | License |
|---|---|---|---|
| **Solar** (Bold Duotone) | The composer area: environment-row chips, the control row and its plus menu, model / permission badges, the effort pill, the question / approval panel, the send arrow | `apps/web/components/solar-icons` — bodies vendored from the Iconify `solar` set into `bodies.ts` by `apps/web/scripts/icons/fetch-solar.mjs` | CC BY 4.0, Solar Icons by 480 Design |
| **pqoqubbw animated line icons** | App chrome outside the composer: left rail, center tabs, sidebar, settings nav, function cards, DAG view | `apps/web/components/animated-icons` | MIT |
| **lucide-react** | Everything else that needs no motion: timeline rows, settings bodies, dialogs | `lucide-react` | ISC |

Provider logos come from LobeHub (`components/settings/lobe-icons.ts`) and
avatars from DiceBear identicons; neither is part of this contract.

Nobody hand-authors icon SVGs. A new Solar icon is added by extending
`ICONS` in `fetch-solar.mjs` and rerunning it; the generated file is
committed so builds stay offline.

## Solar in the composer

Two-tone glyphs read as designed-for-purpose at the composer's 14–16 px
sizes, where the line sets looked generic. Every Solar icon uses the one
Bold Duotone style: a filled glyph plus a 50 % lighter secondary layer.

| Role | Solar icon |
|---|---|
| `+` options trigger | `tuning-2` |
| Add files | `paperclip` |
| Tools | `case-minimalistic` |
| Tool profile | `settings-minimalistic` |
| Web search | `global` |
| Sandbox | `box-minimalistic` |
| While running: Steer / Queue | `forward` / `list-arrow-down` |
| Unattended off / on | `eye` / `eye-closed` |
| Thinking effort | `dumbbell-large-minimalistic` |
| Chat model / execution model badge | `chat-round-dots` / `programming` |
| Permission badge | `shield-check` |
| Local connection chip | `monitor` |
| Web tab chip | `earth` |
| Picture-in-picture chip | `pip-2` |
| Working folder / add folder | `folder-with-files` / `add-folder` |
| Project chip / missing project | `folder-open` / `danger-triangle` |
| Menu check | `check-circle` |
| Close × | `close-circle` |
| Carets | `alt-arrow-right`, `alt-arrow-down` |
| Send | `plain-2` (paper plane) |
| Copy | `copy` |
| Model capabilities (vision / video / tools / reasoning) | `eye` / `videocamera` / `case-minimalistic` / `lightbulb-bolt`; the briefcase renders at 12px rather than 14px because its artwork fills the box while eye and camera leave a margin, so this is the size at which their edges line up |
| Git pill / its menu: new branch or worktree, worktree, PR, view PR | `git-branch` / `add-circle`, `folder-path-connect`, `git-pull-request`, `square-arrow-right-up` |
| File-change card: title / file rows | `pen-new-square` / `file-text` |
| File-change card: undo / Review buttons | Font Awesome `rotate-left` / `eye` (solid), icon + text label |

Solar's undo glyphs are hairline arrows that disappear at button size,
so the file card's two action buttons use solid Font Awesome glyphs
instead, vendored by the same script into the same table (their
viewBox is recorded in `SOLAR_VIEWBOXES`).

Glyphs that reflect a toggle switch with the state rather than relying
on colour alone: Unattended closes the eye once nobody is watching, the
while-running mode shows a forward arrow for Steer and a queue list for
Queue, the project chip turns into the warning triangle when its folder
is gone.

The Fast (speed) toggle is the one composer glyph that is **not** Solar:
it keeps the gauge from the animated set, with its needle rotated by the
`active` prop. See the implementation status below.

## Motion contract

All three families speak the same imperative handle,
`AnimatedNavIconHandle` (`startAnimation` / `stopAnimation`), so the
container — a button, a menu row, a chip — is the hover target and the
glyph never animates on its own 16 px hit area. A parent attaches a ref
and drives the motion. A Solar icon rendered without a ref follows the
hover of its nearest clickable ancestor (button, link, menu item, chip),
so every button animates the same way whether or not it wires a ref;
purely decorative glyphs — menu checks, warning triangles, capability
marks — use `none`.

The pqoqubbw icons redraw themselves (a wrench turns, an arrow bobs). A
filled Solar glyph cannot, so `SolarIcon` offers small, uniform presets
instead: `pop` (scale 1.12, the default), `fly` (the send paper plane
moves 1.5 px up-right), `nudge` (a caret slides 1.5 px right), `pulse` (a one-shot
pop-in, used when a menu item becomes checked) and `none`. Everything
collapses to no motion under `prefers-reduced-motion`.

`SolarIcon` renders a `span.inline-flex` wrapper around the `<svg>`, the
same shape as the animated-icon wrapper, so container CSS that sizes or
hides "the element holding the svg" keeps working.

## Attribution

Solar Icons © 480 Design, released under CC BY 4.0
(<https://github.com/480-Design/Solar-Icon-Set>). The two Font Awesome
glyphs are Font Awesome Free, © Fonticons, CC BY 4.0
(<https://fontawesome.com/license/free>). The notice lives in
the header of `bodies.ts` and here; a user-facing credits
entry is still to be added (see below).

## Implementation status

- Composer area on Solar, including the environment-row chips, the plus
  menu, the question / approval panel and the model / permission badges
  shared through `components/chat/top-bar`: **implemented**.
- Fast toggle as a state-driven gauge (needle idles low when off, sweeps
  to high and turns accent-red when on): **not implemented** — the
  animated-set gauge with a static `active` rotation remains.
- User-facing third-party credits entry for Solar (CC BY): **not
  implemented**.
- Rail, tabs, sidebar and settings stay on the animated line set; no
  migration is planned for them.
