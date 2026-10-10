# Surface system

The UI splits into two **surface contexts**. Each surface has its
own interaction language so the eye can tell at a glance which
"layer" of the app it is hovering: navigation vs content. These
rules apply in **light and dark** themes. Light-theme tokens are
the ones that usually go wrong (white fill on a pale rail).

## The two surfaces

```
─────────────────────────────────────────────────────────────────
surface        background tone           where it lives
─────────────────────────────────────────────────────────────────
deep           `--bg-secondary`          the page behind the
                                         three columns (`.app`)
─────────────────────────────────────────────────────────────────
panel          raised cards:             the left and right rails
               `--bg-input` (rails),     (`--bg-input`, same
               `--bg-primary` (centre)   material as the input
                                         box) and the centre
                                         column (`--bg-primary`:
                                         chat stream, settings
                                         and every other page)
─────────────────────────────────────────────────────────────────
```

The window is three floating cards on one page — the shadcn
Sidebar `floating` shell for both rails (`components/ui/sidebar.tsx`,
the registry's shell only) and its `inset` idea for the centre
column at once. Each card has 14px corners (`rounded-2xl`) and the
per-theme raised shadow (`--composer-shadow`), no border and no
ring; the rails keep a 7px gutter on every side (`p-2`), the
centre card sits 7px off the top and bottom edges and takes its
side gaps from the rails' gutters. The rails are white
(`--bg-input`) so they share a material with the input box and
the user bubble; the centre card stays `--bg-primary` so those
white raised elements keep their contrast on it.

Collapsed, a rail is `--rail-collapsed-w` (63px: the 49px icon
rail inside the card plus the two gutters);
`components/layout/use-resizable-rail.ts` carries the same number.
Everything inside the cards — rows, section headers, the footer —
is unchanged by the shell and keeps the recipes below.

## Interaction language per surface

Mouse interaction never draws an outer focus ring on buttons. Keyboard focus
on buttons uses a small brightness change without an outline or box-shadow.
The top tab strip is the exception: its `role="tab"` targets use each theme's
own `--focus-ring`, which is lighter in dark themes and darker in light themes.

### Deep surface (sidebars)

Components on the deep surface are **list rows** — conversation
items, branch entries, function favourites, and the same row used
in a content-pane rail (MCP `drawio` / `linear` / `+ Add server`).
They should NOT behave like buttons:

- no border, no outline, no fill in the idle state
- hover / selected → switch background to a **visible grey**
  (``--bg-hover`` / ``--bg-selected``), text stays in
  ``--text-primary`` or ``--text-secondary``
- never fill selected rows with ``--bg-input``. The rail card is
  already that white; a white row on it disappears
- avoid the brand-coloured glyph treatment except for the very
  small status / activity indicators (``.indicator-dot``)

Rationale: the sidebar is dense and frequently scanned. A field
of brand-coloured pills makes it loud and visually competes with
the content column. Greying-on-hover keeps the layer calm and
still gives the click target enough feedback.

### Panel surface (chat content + dialogs)

Components on the panel surface ARE buttons / pills / cards:

- they sit on a lifted background, so a "ghost outline" pattern
  reads cleanly
- idle state — ``--bg-surface`` background, ``--text-primary``
  text or brand-coloured text for primary actions
- hover — fill with the brand colour, swap text to its contrast
  pair (``--text-on-accent``)
- the inverted hover is what makes the chain of "actions" feel
  like one design family — the user knows that the colour
  shift is universally the "this is going to do something"
  affordance

Header **tab pills** on a manage page (Abilities / Programs /
Plugins / Skills) are the one bright exception: the selected tab
uses ``--bg-input`` so it reads like the search box (lighter, not
darker). That fill is **only** for those pills. Do not copy it
onto sidebar rows or MCP server rows.

## One list-row recipe

Sidebar nav (`+ New chat`, Agents, Abilities, History, Scheduler)
and content-pane list rows (MCP `drawio` / `linear` / `+ Add server`)
share **one** box. Do not invent a second height, padding, radius,
or selected fill for the rail on the right.

```
property     token / value
─────────────────────────────────────────────────────────────────
height       `--ui-list-h` → `--ui-button-h` → 30px
padding      6px 8px
gap          12px
radius       `--ui-list-radius` (10px)
idle         transparent, 1px transparent border if needed for
             box-sizing only
hover        `--bg-hover`
selected     `--bg-hover`  (same grey, never white / `--bg-input`)
```

`+ Add server` is the same row as `+ New chat`: a normal list
row, slightly muted text. Not italic, not a different add-style.

Implementation: `.ui-list-item` in `apps/web/app/styles/base.css`
is the source. MCP `.serverItem` must match those metrics (prefer
composing `.ui-list-item` over a parallel recipe).

## Size system — list rows and Buttons

List rows keep one fixed set. CSS variables in
`apps/web/app/styles/base.css`:

```
set         height    radius    css tokens
─────────────────────────────────────────────────────────────────
list        30 px     10 px     --ui-list-h · --ui-list-radius
─────────────────────────────────────────────────────────────────
```

Sidebar rows, MCP tab pills, and MCP server rows all sit on this
30px rhythm. There is no sm / md / lg ladder for list rows: when
one slot may pick from several sizes, every author negotiates with
the design and the sizes drift apart.

Buttons are the shadcn/ui `Button` in the **radix-luma** style.
`apps/web/components/ui/button.tsx` is copied verbatim from the
official registry (`npx shadcn add button`, style `radix-luma`);
the only local changes are its imports and a `forwardRef` wrapper
for React 18. Every size is a pill (`rounded-4xl`); the call site
picks one of the official sizes and never edits the classes.

The sizes are rem-based and this app's root font size is 14px
(`html { font-size: 14px }` in `base.css`, which ~560 existing
utilities are tuned to), so every shadcn size renders at 7/8 of
its nominal value:

```
size        app height  app text   use
─────────────────────────────────────────────────────────────────
xs          21 px       10.5 px    avoid — text is too small here
sm          28 px       12.25 px   chips and compact control rows
default     31.5 px     12.25 px   dialog and settings actions
lg          35 px       12.25 px   hero / empty-state actions
icon-sm/default/lg                 square = circle at those heights
─────────────────────────────────────────────────────────────────
```

Elements that cannot be a `<Button>` (a span that hosts its own
✕, a Radix trigger rendered as a span) take the same look through
`cn(buttonVariants({ variant, size }))` on their `className` — the
`cn()` merge matters: the raw class list carries both
`border-transparent` and the variant's border colour.

A header row (search + tab pills + icon buttons) must share one
vertical center. A 1–2 px height mismatch between those controls
is a bug, not a variant.

## Inputs, selects, and borders

Inputs and dropdowns share **one single-layer 1px** edge
(`border: 1px solid var(--border)`, fill `--bg-input`).

- Do not stack a 2px `:focus-visible` halo on that 1px edge.
  After a native `<select>` closes and focus remains, the stacked
  ring reads as a double frame.
- Hover must **keep** the 1px border. Setting `border-color:
  transparent` on hover makes the box look like it vanished
  (MCP catalog buttons had this).
- Do not invent a second input chrome per page. Settings,
  dialogs, plugins, and MCP editors use the same 1px +
  `--bg-input` treatment.

## Dialogs

Dialogs **fade** in and out only (about 300ms). No slide from
the top, no snap-close. Motion is opacity, not translate.

## Settings rows

Settings pages (General, Memory, System, and the rest) use one
two-column row:

- **left**: name, left-aligned. Description stays in this column
  and does not run into the control
- **right**: the control / value, right-aligned
- left and right are isolated columns. Do not stack the label
  above the input
- status chips (`LIVE`, `NEXT START`, …) sit to the **left** of
  their control, never mixed left/right across rows

## Button variant guidance

The variants are shadcn's, plus one app-owned `elevated`; colours
come from the shadcn tokens (`--primary`, `--secondary`, `--muted`, `--input`, `--ring`,
…), which `apps/web/app/globals.css` bridges onto each theme's
palette — so every theme restyles Buttons without touching them.

```
variant      idle                                 hover
─────────────────────────────────────────────────────────────────
default      bg-primary + primary-foreground      bg-primary/80
outline      1px border-border; transparent        bg-muted (light),
             in dark, bg-background in light       bg-input/30 (dark)
secondary    bg-secondary                         secondary + 5% ink
elevated     --bg-input, no border, shadow-sm      shadow-md, + 5% ink
ghost        transparent                          bg-muted (/50 dark)
destructive  bg-destructive/10 + destructive text bg-destructive/20
link         primary text                         underline
─────────────────────────────────────────────────────────────────
```

All variants press down 1px while active, show a 3px `ring/30`
halo on keyboard focus, and drop to 50% opacity when disabled.

`elevated` is the one variant Luma's registry does not have: Luma
ships no shadowed Button (only its Card carries `shadow-md`), and
the composer's pills want the same borderless raised look as the
input box. It reuses the per-theme composer shadow pair through
the `shadow-raised` / `shadow-raised-hover` utilities declared in
`app/globals.css` `@theme`, so the pills and the box lift together
in every theme.

Pick per surface:

- **Primary action** (Run, Save, Test, Apply, Send) → `default`.
- **Secondary action** (Cancel, Close, Reset, Browse) → `outline`
  or `secondary`.
- **Controls in a dense row** (the composer's model / effort /
  permission triggers, icon toggles, environment chips) →
  `elevated`: no border, lifted off the page by the same shadow as
  the input box, a step deeper on hover.
- **Purely incidental actions** that should vanish until hovered →
  `ghost`.
- **Destructive** (Delete, Remove, Stop) → `destructive`.
- **Deep surface — sidebar rows** → don't use the Button
  primitive. Use `.ui-list-item` / `nav-classes.ts`.

## Composer controls

The chat composer is built from the same parts:

- **Environment chips** above the box (channel, web surface,
  project, working folders, DAG HUD) → `elevated` `sm`; the
  add-folder chip is `elevated` `icon-sm`.
- **Bottom row** (permission, chat / exec model, effort, plus,
  tool toggles, context ring) → `elevated`, `sm` / `icon-sm`. The
  composer CSS hands its older base rules back to the Button with
  `revert-layer` rather than drawing its own chip.
- **Send** → `icon-sm`: `default` when there is something to
  send, `ghost` when empty, `destructive` while it stops a run.
- **Input box** → the shadcn Luma Card look through the per-theme
  `--composer-*` tokens: `--bg-input` surface with no border,
  `shadow-sm` at rest and `shadow-md` on hover or focus (shadow
  alpha 0.1 on light themes, 0.25 on dark), no focus ring; 23px
  corners (a pill at one line).

## Web page preview and browser toolbar

The floating page preview over chat
(`components/center-tabs/web-tab-pip.tsx`) is a popover card:
`bg-popover`, `ring-1 ring-foreground/10` in place of a border,
`shadow-lg`, 10px corners on all four sides, and the stage below the
header clips the page at the same bottom radius. The radius is pinned
to the native page view's corner radius
(`apps/desktop/main/web-views.js`), which the DOM cannot clip: a
larger frame radius would let page pixels show past the bottom
corners, so the two change together or not at all. The 32px header
holds the title (`text-sm font-medium text-foreground`), the status
(`text-xs text-muted-foreground`), and `ghost` `icon-xs` icon buttons
with 14px icons whose hover tips are `HoverTip` + `TipBody`
([hover-tips.md](hover-tips.md)); a resume error is one line of
`text-xs text-destructive`, no box. The CSS module keeps geometry only
(position, size, drag cursor, resize handles), because unlayered
module rules would beat the utilities.

The browser toolbar's icon buttons (back / forward / reload / home /
bookmark / library / open in browser / menu, and the control bar) are
the same `ghost` Button through `webToolbarButton()`
(`components/center-tabs/toolbar-button.ts`): `icon-sm` for its 14px
icon rule, held at the toolbar's 26px by `.webToolbarBtn`, which
carries geometry only, so the 40px row keeps its rhythm.

## Don'ts

- Don't invent a new hover / selected / border treatment per
  page. One recipe, then reuse it. A new look needs a line in
  this file first.
- Don't introduce a new pill background colour without listing it
  here first. Flavours in budget: deep grey hover, panel, brand
  fill, and the header-tab `--bg-input` exception above.
- Don't put brand-coloured fills on the deep surface — the
  contrast against the rail makes a brand pill look like an
  alert, not a click target.
- Don't use white / `--bg-input` as the selected fill on sidebar
  or content-pane **list rows**. Light theme washes out.
- Don't give MCP server rows (or any other content-pane list) a
  different height, padding, or selected fill than sidebar nav.
- Don't add hover motion (translate-y, scale-105) on either
  surface. Hover swaps the background; the only motion is the
  Button's own 1px press while active.
- Don't edit the official classes in `components/ui/button.tsx`
  (`elevated` is the one app-owned variant) or restate a Button
  lookalike in CSS. Pick a `variant` / `size`; if a legacy rule still overrides a Button, remove it or
  hand it back with `revert-layer`.
- Don't stack a 2px focus glow on a 1px input/select edge.
- Don't drop a control's 1px border on hover.
- Don't slide dialogs. Fade only.
- Don't let a settings description overflow into the right-hand
  control column, or stack label above control.

## Implementation status

- Done: `Button` (radix-luma), the composer environment chips,
  bottom-row controls, send button, input box, the web page preview
  (frame, header, icon buttons), and the browser toolbar's icon
  buttons.
- Not yet migrated: popover / menu panels (`MENU_PANEL`,
  `components/ui/popover.tsx`, `dropdown-menu.tsx`), tooltips,
  badges, and the hand-styled CSS-module popups — they still use
  the glass surface tokens (`--glass-*`). Form inputs and selects
  keep the 1px-edge rule above until they move to the shadcn input.
  Sidebar list rows stay on the list set above.
