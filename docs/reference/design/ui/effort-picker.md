# Effort picker card

The card that opens from the effort trigger in the composer's control row.
It is the one place a user picks how long the chat model reasons for the
next turn. Component: `apps/web/components/chat/composer/controls/
thinking-effort-pill.tsx`; geometry: `apps/web/lib/effort-matrix.ts`;
styles: `apps/web/app/styles/chat/effort-pill.css`. The Fast toggle that
shares the header is specified in
[composer-fast-control.html](composer-fast-control.html); where the levels
come from and how they reach the provider is in
[thinking-effort.md](../providers/models/thinking-effort.md).

## Anatomy, top to bottom

| Row | Content | Type and colour |
|---|---|---|
| Header | "Effort", then the current level's name, then (right-aligned) the Fast gauge toggle and a circled `?` help button | 13px; "Effort" `--text-muted`; level name medium weight in `--accent-purple`; both buttons 24px, `--text-muted` until hovered |
| End labels | "Faster" at the left, "Smarter" at the right | 12px `--text-muted` |
| Track | the dot matrix with the thumb over it (20px tall) | see below |
| Caption | "Recommended" under the model's default option | 12px `--text-muted` |

Gaps: header → labels 10px, labels → track 10px, track → caption 6px. The
card keeps the frame it had — `--surface-popover`, radius 12, 10px padding,
`--border-popover`, `--shadow-popover` — and the 220px width set on
`.effort-pill-shell[data-expanded="true"]`, which the composer-row
container query clamps on narrow rows. The matrix adapts to whatever width
the card gets.

The `?` button carries a `HoverTip` with a `TipBody` (title "Thinking
effort", detail: how long the model reasons; higher levels think longer and
use more tokens, lower levels answer faster; Recommended marks the model's
default). The Fast toggle is unchanged: same class, same hint, same
behaviour; it simply has the help button after it.

## The track is a dot matrix

There is no bar. The Radix slider's own track, range and option ticks are
painted transparent inside `.effort-card`, and an SVG of small circles
underneath it (`<EffortDotMatrix/>`, `effort-dot-matrix.tsx`) reads as the
track. The slider root still fills the 20px row, so clicking anywhere on
it, dragging, and the arrow keys move between options exactly as before.

`layoutDotMatrix(trackWidth, thumbX)` in `lib/effort-matrix.ts` produces
the dots; every tunable is a named constant there:

| Constant | Value | Meaning |
|---|---|---|
| `DOT_PITCH` | 6px | centre-to-centre spacing, both axes |
| `DOT_ROWS` | 4 | rows stacked across the 20px track, centred vertically (y = 1, 7, 13, 19) |
| `DOT_RADIUS` | 0.75 → 2 | radius ramps with x: 1.5px dots at the far left, 4px at the far right |
| `DOT_OPACITY.behind` | 0.22 → 0.42 | opacity ramp for dots the thumb has passed |
| `DOT_OPACITY.ahead` | 0.32 → 1 | opacity ramp for dots still ahead of the thumb |
| `THUMB_WIDTH` / `TRACK_HEIGHT` | 16 / 20 | Radix thumb hit box; track height |

Generation: `cols = floor(trackWidth / DOT_PITCH)`, with the leftover width
split evenly so the grid is centred; column `c` sits at
`x0 + c * DOT_PITCH` and has progress `t = c / (cols - 1)`. Radius and
opacity are linear interpolations in `t`, so both ramps are continuous along
x and do not step per option. A dot is "ahead" when its centre is right of
the thumb's centre; ahead dots use the ahead opacity range and fill
`--accent-purple`, passed dots use the behind range and `currentColor`,
which the svg sets to `--text-muted`. Colours are never literal, so light
themes get grey specks and a lavender field just as the dark theme does.
A 200px track draws 33 × 4 = 132 circles.

The thumb centre for option `i` of `n` is
`i / (n - 1) * (trackWidth - THUMB_WIDTH) + THUMB_WIDTH / 2` — the same
placement Radix computes, so the first and last options sit half a thumb
in from each edge. The pill measures the track with a `ResizeObserver` and
re-lays the matrix out on every width change.

The matrix is static. The only motion is a 160ms crossfade on `fill` and
`fill-opacity` when dots cross from ahead to behind as the thumb moves;
`prefers-reduced-motion: reduce` removes it. At `max` the existing
`<UltraRain/>` canvas inside the slider's range still paints the passed side
of the track as the purple Ultracode matrix; the dots show through only on
its unfilled left margin.

## Thumb and its tip

The thumb is a 16 × 20 chip, radius 6, `--effort-thumb` (white on light
themes, raised paper on dark), `--shadow-sm`. Resting the pointer on it,
dragging it, or focusing it from the keyboard shows the level name
("Max", "XHigh", …) in a small badge 6px above it, styled like `.hover-tip`
(`--surface-tooltip` / `--text-on-tooltip`).

The tip is a plain positioned element, not a Radix tooltip. The pill marks
the slider root with `data-thumb-tip="true"` while either of two flags
holds: *hover*, computed on the root's pointer events by testing the
pointer's x against the thumb's bounding box (the thumb child itself stays
`pointer-events: none`, so Radix keeps focusing its thumb on press); and
*dragging*, set on the root's pointerdown and cleared by a window
`pointerup` / `pointercancel`. The drag flag is what keeps the tip steady
when the thumb snaps between options under a moving pointer. Keyboard focus
shows the same badge through `[role="slider"]:focus-visible`. The badge has
no transition, so it never flickers.

## Recommended

`ThinkingOption` (`use-thinking-effort.ts`) carries `recommended?: boolean`.
The hook marks the option the model falls back to when the user has not
picked one: the backend's `default` (the server sends it with every
non-empty option list — the model's declared default level, else the middle
option), an agent invocation's `defaultThinking`, or `medium` for the
pre-hydration fallback list. The card prints "Recommended" under that
option's thumb position. The caption is centred on the position, except
that the first option aligns with the track's left edge and the last with
its right edge (`captionAlignment`), so the word never overhangs the card.

## Interaction and state

Unchanged: the card opens on click of the trigger and closes on an outside
click owned by `composer/index.tsx`; selection goes through
`onValueChange → setThinking` without closing the card; the Radix slider
keeps its keyboard handling and aria (`aria-valuenow` is the option index).
Every string goes through `useTranslation().text(en, zh)`.

## Files

- `apps/web/components/chat/composer/controls/thinking-effort-pill.tsx` — the card
- `apps/web/components/chat/composer/controls/effort-dot-matrix.tsx` — the svg
- `apps/web/components/chat/composer/controls/use-thinking-effort.ts` — options and the `recommended` flag
- `apps/web/lib/effort-matrix.ts` — geometry and tunables
- `apps/web/app/styles/chat/effort-pill.css` — card, matrix, help button, thumb tip, caption
- `apps/web/tests/chat/effort-matrix.test.mjs` — pins the geometry

## Implementation status

- Header, dot-matrix track, thumb tip, Recommended caption, reduced-motion
  handling, theme-derived colours: **implemented**.
- The `?` glyph is lucide `CircleHelp`; a Solar `question-circle` is not
  vendored yet (see [icons.md](icons.md)).
- `aria-valuetext` naming the level on the thumb: **not implemented** —
  `components/ui/slider.tsx` does not expose thumb props, so the thumb
  reports the option index.
