/**
 * Effort slider geometry — the dot matrix that IS the track.
 *
 * Pure functions, no DOM. `components/chat/composer/controls/
 * thinking-effort-pill.tsx` measures the track, hands the width and the
 * current option index here, and draws the result as SVG circles. All the
 * tunables (pitch, rows, dot size ramp, opacity ramps) live in this one
 * file so the picker can be re-tuned without touching the component, and
 * `tests/chat/effort-matrix.test.mjs` pins the geometry without React.
 *
 * The track reads left → right as "faster → smarter": every dot grows and
 * brightens with x, continuously (not per option). Dots the thumb has
 * already passed are grey; dots still ahead of it are lavender. Between
 * two options the matrix simply continues — there are no tick marks.
 */

/** Radix thumb hit-box width, px. Radix keeps the thumb inside the track,
 *  so option i's thumb centre is `i/(n-1) * (trackWidth - THUMB_WIDTH) +
 *  THUMB_WIDTH/2`; the first and last options sit half a thumb in from the
 *  edges. `components/ui/slider.tsx` uses the same constant for its ticks. */
export const THUMB_WIDTH = 16;
/** Track (and thumb) height, px. */
export const TRACK_HEIGHT = 20;

/** Centre-to-centre spacing of the dots, px, on both axes. */
export const DOT_PITCH = 6;
/** Rows of dots stacked across the track height. */
export const DOT_ROWS = 4;
/** Dot radius ramps linearly with x: 1.5px dots at the far left, 4px at the
 *  far right. */
export const DOT_RADIUS = { min: 0.75, max: 2 } as const;
/** Fill opacity ramps with x as well. Dots behind the thumb (passed, grey)
 *  stay dim; dots ahead of it (lavender) climb to fully opaque so the right
 *  end reads as a dense bright field. */
export const DOT_OPACITY = {
  behind: { min: 0.22, max: 0.42 },
  ahead: { min: 0.32, max: 1 },
} as const;

export interface MatrixDot {
  cx: number;
  cy: number;
  r: number;
  opacity: number;
  /** true → still ahead of the thumb (lavender); false → passed (grey). */
  ahead: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** X of the thumb's centre for option `index` of `count` on a track
 *  `trackWidth` px wide — Radix's own thumb placement. */
export function thumbCenterX(index: number, count: number, trackWidth: number): number {
  if (count <= 1) return trackWidth / 2;
  const ratio = Math.min(1, Math.max(0, index / (count - 1)));
  return ratio * (trackWidth - THUMB_WIDTH) + THUMB_WIDTH / 2;
}

/** Lay the dots out for a track `trackWidth` × `height` px with the thumb
 *  centred at `thumbX`. Columns are centred so the leftover width splits
 *  evenly between both ends; rows are centred vertically on the track. */
export function layoutDotMatrix(
  trackWidth: number,
  thumbX: number,
  height: number = TRACK_HEIGHT,
): MatrixDot[] {
  if (!(trackWidth > 0)) return [];
  const cols = Math.max(1, Math.floor(trackWidth / DOT_PITCH));
  const x0 = (trackWidth - (cols - 1) * DOT_PITCH) / 2;
  const y0 = height / 2 - ((DOT_ROWS - 1) * DOT_PITCH) / 2;
  const dots: MatrixDot[] = [];
  for (let c = 0; c < cols; c++) {
    const cx = x0 + c * DOT_PITCH;
    const t = cols > 1 ? c / (cols - 1) : 1;
    const ahead = cx > thumbX;
    const range = ahead ? DOT_OPACITY.ahead : DOT_OPACITY.behind;
    const r = lerp(DOT_RADIUS.min, DOT_RADIUS.max, t);
    const opacity = lerp(range.min, range.max, t);
    for (let row = 0; row < DOT_ROWS; row++) {
      dots.push({ cx, cy: y0 + row * DOT_PITCH, r, opacity, ahead });
    }
  }
  return dots;
}

/** How the "Recommended" caption hangs under its option: the first option
 *  aligns with the track's left edge, the last with its right edge, and
 *  anything between is centred on the thumb position. */
export function captionAlignment(index: number, count: number): "start" | "center" | "end" {
  if (count <= 1) return "center";
  if (index <= 0) return "start";
  if (index >= count - 1) return "end";
  return "center";
}
