import assert from "node:assert/strict";
import test from "node:test";

const { resolveMarkdownReference } = await import("../../lib/files/markdown-paths.ts");

test("markdown references resolve against the document's folder", () => {
  assert.equal(resolveMarkdownReference("A4_Promo/post.md", "figures/a.png"), "A4_Promo/figures/a.png");
  assert.equal(resolveMarkdownReference("A4_Promo/post.md", "./figures/a%20b.png?raw=1#x"), "A4_Promo/figures/a b.png");
  assert.equal(resolveMarkdownReference("A4_Promo/post.md", "../shared/b.png"), "shared/b.png");
  assert.equal(resolveMarkdownReference("/Users/me/work/post.md", "figures/a.png"), "/Users/me/work/figures/a.png");
  assert.equal(resolveMarkdownReference("/Users/me/work/post.md", "/tmp/a.png"), "/tmp/a.png");
  assert.equal(resolveMarkdownReference("docs/post.md", "/assets/a.png"), "assets/a.png");
});

test("markdown references that are not files stay untouched", () => {
  for (const reference of ["https://example.com/a.png", "data:image/png;base64,AAAA", "mailto:a@b.c", "//cdn/a.png", "#section", ""]) {
    assert.equal(resolveMarkdownReference("docs/post.md", reference), null, reference);
  }
  assert.equal(resolveMarkdownReference("post.md", "../../etc/passwd"), null);
});
