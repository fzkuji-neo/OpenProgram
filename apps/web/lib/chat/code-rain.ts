/**
 * What the code rain is drawn with, shared by the empty-chat backdrop
 * (components/chat/welcome-backdrop.tsx) and the rain that brings in new
 * messages (components/chat/code-rain-arrivals.tsx).
 */

/** Katakana, Latin capitals, digits and symbols; always drawn mirrored. */
export const CODE_RAIN_GLYPHS =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.=*+-<>|\"_";

export const CODE_RAIN_FONT = `ui-monospace, "SF Mono", Menlo, monospace`;

export function randomGlyph(): string {
  return CODE_RAIN_GLYPHS[Math.floor(Math.random() * CODE_RAIN_GLYPHS.length)];
}

export type CodeRainPalette = { dark: boolean; tail: string; head: string };

/** The resolved light/dark mode the theme bootstrap writes on <html>.
 *  Reading the ink colour instead broke on oklch() tokens (Vivid), which
 *  drew the dark-mode rain on a light page. Always green. */
export function codeRainPalette(): CodeRainPalette {
  const dark = document.documentElement.dataset.themeMode === "dark";
  return dark
    ? { dark, tail: "#22e35b", head: "#eafff0" }
    : { dark, tail: "#118a3a", head: "#063d18" };
}

/** Draws one glyph mirrored, centred on (x, y). */
export function drawMirrored(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}
