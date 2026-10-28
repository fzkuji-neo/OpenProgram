import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";

const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.window = window;
globalThis.document = window.document;

const { renderMd } = await import("../../lib/runtime-bridge/dom/markdown-render.ts");
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("a reply's footnotes render as notes, not a dead link", () => {
  const html = renderMd("脚注测试[^1]。\n\n[^1]: 脚注内容");
  assert.match(html, /<sup><a id="footnote-ref-1" href="#footnote-1" data-footnote-ref[^>]*>1<\/a><\/sup>/);
  assert.match(html, /<section class="footnotes" data-footnotes="?"?>/);
  assert.match(html, /<li id="footnote-1">\s*<p>脚注内容 <a href="#footnote-ref-1" data-footnote-backref/);
});

test("a footnote link moves within its own reply and leaves the URL alone", () => {
  const md = read("components/chat/messages/bubbles/markdown.ts");
  assert.match(md, /closest<HTMLAnchorElement>\("a\[data-footnote-ref\], a\[data-footnote-backref\]"\)/);
  assert.match(md, /event\.preventDefault\(\);\n\s+const id = note\.getAttribute\("href"\)\?\.slice\(1\)/);
  assert.match(md, /note\.closest\("\.md-rendered"\)/, "only notes of the same reply");
});

test("task items, squeezed CJK headings and footnotes read as in the Claude app", () => {
  const css = read("app/styles/chat/messages/bubbles.css");
  assert.match(css, /\.message-content li:has\(> input\[type="checkbox"\]:first-child, > p:first-child > input\[type="checkbox"\]:first-child\) \{ list-style: none; \}/);
  assert.match(css, /\.message-content th \{[^}]*word-break: keep-all;/);
  assert.match(css, /\.message-content sup \{ position: relative; top: -0\.5em;[^}]*line-height: 0;/);
  assert.match(css, /\.message-content \.footnotes \{[^}]*border-top: 0\.5px solid var\(--border\);/);
  assert.match(css, /\.message-content \.footnotes \.sr-only \{ position: absolute;/, "the hidden heading stays hidden without Tailwind's sr-only");
});
