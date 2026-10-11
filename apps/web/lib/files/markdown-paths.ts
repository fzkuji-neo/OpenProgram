/** Where a relative reference inside a markdown document points.
 *
 *  `figures/a.png` in `docs/post.md` names `docs/figures/a.png`. A
 *  reference with a scheme (`https:`, `data:`, `mailto:`), a protocol-
 *  relative `//host` or a bare `#anchor` is not a file and returns null.
 *  A leading `/` is the root of the document's tree: the filesystem for
 *  an absolute document path, the project for a project path. A `..`
 *  that would climb above that root returns null. */
export function resolveMarkdownReference(documentPath: string, reference: string): string | null {
  const raw = reference.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  let target = raw.replace(/[?#].*$/, "");
  try { target = decodeURIComponent(target); } catch { /* keep the literal text */ }
  if (!target) return null;
  const doc = documentPath.replace(/\\/g, "/");
  const absolute = doc.startsWith("/");
  const base = target.startsWith("/") ? [] : doc.split("/").slice(0, -1);
  const parts = base.filter(Boolean);
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(segment);
  }
  if (!parts.length) return null;
  return (absolute ? "/" : "") + parts.join("/");
}
