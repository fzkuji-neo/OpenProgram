"use client";

import { useEffect, useMemo, useRef } from "react";
import { marked as npmMarked, Marked, type Tokens } from "marked";
import { typesetMath } from "@/lib/runtime-bridge/markdown-render";
import { cjkEmphasis } from "@/lib/markdown/cjk-emphasis";

// Markdown + KaTeX rendering. Mirrors `renderMd()` and
// `renderMathInChat()` from apps/web/public/js/shared/helpers.js.
// Both libraries are build-time imports so offline and strict-CSP behavior
// matches the normal online path.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Dedicated marked instance for untrusted sources (repo files): raw HTML
// tokens — block and inline both surface as `html` tokens — are escaped
// instead of passed through. Separate instance so the override can never
// leak into the shared npmMarked instance and change chat rendering.
const escapingMarked = new Marked(cjkEmphasis, {
  renderer: {
    html(token) {
      return escapeHtml(token.text);
    },
  },
});

/** Maps an image's markdown src to the URL the browser loads, or null to
 *  keep it unchanged. Documents use it to load `figures/a.png` from the
 *  document's own folder instead of the page URL. */
export type MarkdownImageResolver = (src: string) => string | null;

function imageResolvingMarked(resolveImage: MarkdownImageResolver, escapeRawHtml?: boolean): Marked {
  return new Marked(cjkEmphasis, {
    ...(escapeRawHtml ? { renderer: { html(token: Tokens.HTML | Tokens.Tag) { return escapeHtml(token.text); } } } : {}),
    walkTokens(token) {
      if (token.type !== "image") return;
      const image = token as Tokens.Image;
      image.href = resolveImage(image.href) ?? image.href;
    },
  });
}

/** Replace LaTeX blocks with placeholder tokens so marked doesn't mangle
 * them, then restore the originals after parsing. */
function markdownToHtml(src: string, escapeRawHtml?: boolean, parser?: Marked): string {
  let s = typeof src === "string" ? src : String(src ?? "");

  const mathBlocks: string[] = [];
  const stash = (m: string) => {
    mathBlocks.push(m);
    return "%%MATH" + (mathBlocks.length - 1) + "%%";
  };
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (m) => stash(m));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (m) => stash(m));
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (m) => stash(m));
  s = s.replace(/\$([^$\n]+?)\$/g, (m) => stash(m));

  let html: string;
  if (parser) {
    html = parser.parse(s, { breaks: true, async: false });
  } else if (escapeRawHtml) {
    html = escapingMarked.parse(s, { breaks: true, async: false });
  } else {
    html = npmMarked.parse(s, { breaks: true }) as string;
  }
  for (let i = 0; i < mathBlocks.length; i++) {
    html = html.replace("%%MATH" + i + "%%", mathBlocks[i]);
  }
  return '<span class="md-rendered">' + html + "</span>";
}

/** Run KaTeX auto-render against a specific container. Memoizes via a
 * `data-math-rendered` attribute so streaming updates don't re-render
 * already-typeset spans. */
export function renderMathIn(el: HTMLElement): void {
  typesetMath(el);
}

/** Render a markdown + LaTeX string. Produces the same DOM shape
 * (`<span class="md-rendered">...</span>`) the legacy CSS targets.
 *
 * `escapeRawHtml` is for untrusted sources (e.g. arbitrary repo .md files
 * in the files panel): raw HTML in the markdown is escaped and shown as
 * text instead of injected into the DOM. Leave it unset for trusted
 * chat/doc content — that path is byte-identical to the original. */
export function Markdown({
  source,
  escapeRawHtml,
  resolveImage,
}: {
  source: string;
  escapeRawHtml?: boolean;
  resolveImage?: MarkdownImageResolver;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const parser = useMemo(() => resolveImage ? imageResolvingMarked(resolveImage, escapeRawHtml) : undefined,
    [resolveImage, escapeRawHtml]);
  const html = markdownToHtml(source, escapeRawHtml, parser);

  // KaTeX auto-render mutates the DOM after marked has produced HTML.
  // Run it after every render of the host node so streaming text gets
  // typeset as it arrives.
  useEffect(() => {
    if (ref.current) renderMathIn(ref.current);
  });

  // `dangerouslySetInnerHTML` is intentional — the HTML comes from our
  // own marked invocation. Note marked does NOT sanitize: raw HTML in
  // the markdown body passes straight through to the DOM. Callers with
  // untrusted input must set `escapeRawHtml`, which escapes raw HTML
  // tokens at parse time; no sanitization happens anywhere else.
  return (
    <div
      ref={ref}
      style={{ display: "contents" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
