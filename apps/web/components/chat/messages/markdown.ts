/**
 * Markdown → HTML for chat bubbles.
 *
 * Delegates to the shared `renderMd` (runtime-bridge/helpers) so React
 * bubbles render byte-for-byte identically to every other renderer —
 * no second markdown engine. Falls back to escaped plain text on SSR,
 * where `renderMd` would touch `window`.
 */
import { copyText } from "@/lib/clipboard";
import { highlightEscapedCode } from "@/lib/chat/code-highlight";
import { renderMd } from "@/lib/runtime-bridge/helpers";

export function renderMarkdown(src: string): string {
  if (typeof window === "undefined") return escapeHtml(src);
  try {
    return withCodeChrome(renderMd(src));
  } catch {
    return escapeHtml(src);
  }
}

const COPY_ICON =
  '<svg class="md-code-icon-copy" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  + '<svg class="md-code-icon-done" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const chromeCache = new Map<string, string>();
const CHROME_CACHE_MAX = 200;

/** Wrap fenced code blocks in a header with the language and a copy
 *  button, and
 *  syntax-highlight bodies in known languages (highlight.js only emits
 *  escaped text plus `hljs-*` spans). Runs on already-sanitized HTML; code bodies are escaped by
 *  marked, so `</code></pre>` only ever closes a real block. */
function withCodeChrome(html: string): string {
  if (!html.includes("<pre><code")) return html;
  // Streaming re-renders the same finished blocks every delta; cache the
  // highlighted result per rendered HTML string.
  const hit = chromeCache.get(html);
  if (hit !== undefined) return hit;
  const out = html
    .replace(
      /<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
      (_m, lang: string, body: string) =>
        `<pre><code class="language-${lang}">${highlightEscapedCode(body, lang)}</code></pre>`,
    )
    .replace(/<pre><code(?: class="language-([^"]*)")?>/g, (_m, lang?: string) => {
      const label = escapeHtml((lang || "").trim());
      return '<div class="md-code"><div class="md-code-head">'
        + `<span class="md-code-lang">${label || "text"}</span>`
        + `<button type="button" class="md-code-copy" aria-label="Copy code" title="Copy code">${COPY_ICON}</button>`
        + "</div><pre><code" + (lang ? ` class="language-${label}"` : "") + ">";
    })
    .replace(/<\/code><\/pre>/g, "</code></pre></div>");
  if (chromeCache.size >= CHROME_CACHE_MAX) chromeCache.delete(chromeCache.keys().next().value!);
  chromeCache.set(html, out);
  return out;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const btn = typeof target?.closest === "function" ? target.closest(".md-code-copy") : null;
    if (!btn) return;
    const code = btn.closest(".md-code")?.querySelector("pre")?.textContent ?? "";
    void copyText(code).then((ok) => {
      if (!ok) return;
      btn.classList.add("copied");
      window.setTimeout(() => btn.classList.remove("copied"), 1500);
    });
  });
}

/** Compatibility hook retained for callers that used to wait for CDN marked. */
export function useMarkdownReady(): boolean {
  return true;
}

/** SSR/no-`marked` fallback escape. Deliberately NOT
 *  `runtime-bridge/helpers.escHtml` — that one escapes via
 *  `document.createElement`, and the only callers here are the two
 *  branches where the DOM is unavailable or `renderMd` just threw. */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}
