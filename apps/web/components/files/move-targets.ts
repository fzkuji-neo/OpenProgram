/** Where "Move to…" can send entries: typed paths and recent folders. */

const RECENT_LIMIT = 5;
const recentTargets = new Map<string, string[]>();

/** Remember a folder entries were moved into, newest first, per project. */
export function rememberMoveTarget(projectId: string, dir: string): void {
  const list = (recentTargets.get(projectId) ?? []).filter(path => path !== dir);
  recentTargets.set(projectId, [dir, ...list].slice(0, RECENT_LIMIT));
}

export function recentMoveTargets(projectId: string): string[] {
  return recentTargets.get(projectId) ?? [];
}

/** A clean project-relative folder path typed by the user, or null. */
export function typedFolder(value: string): string | null {
  const parts = value.trim().replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.some(part => part === "." || part === "..")) return null;
  return parts.join("/");
}

/** Whether ``dir`` can take every one of ``paths``: a folder cannot go
 *  inside itself, and the folder they all already sit in changes nothing. */
export function canMoveInto(paths: string[], dir: string): boolean {
  if (paths.some(path => dir === path || dir.startsWith(path + "/"))) return false;
  return !paths.length || !paths.every(path => parentOf(path) === dir);
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
