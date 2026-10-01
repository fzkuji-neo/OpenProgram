import { navigate } from "../../navigate";
import { pushPath } from "../../shallow-nav";

function detailHost(path: string): string | null {
  return ["/skills", "/plugin", "/settings/providers"].find(
    (host) => path === host || path.startsWith(`${host}/`),
  ) ?? null;
}

let pendingDetail: { host: string; path: string } | null = null;

/** Finish after the exported route commits, before recording tab history. */
export function completeTabRouteNavigation(pathname: string): boolean {
  if (!pendingDetail) return false;
  if (pathname !== pendingDetail.host) { pendingDetail = null; return false; }
  const { path } = pendingDetail;
  pendingDetail = null;
  window.history.replaceState(window.history.state, "", path);
  return true;
}

/** A sidebar page needs its route component; changing only pathname cannot load it. */
export function navigateTabRoute(path: string): void {
  const pathname = path.split(/[?#]/, 1)[0];
  const current = typeof window !== "undefined" ? window.location.pathname : "";
  const host = detailHost(pathname);
  if (pendingDetail?.path === path) return;
  pendingDetail = null;
  if (pathname === current) return;
  if (host !== null && detailHost(current) !== host && pathname !== host) {
    pendingDetail = { host, path };
    navigate(host);
    return;
  }
  if (pathname === "/chat" || pathname.startsWith("/s/")
    || (host !== null && detailHost(current) === host)) {
    pushPath(path);
  } else {
    navigate(path);
  }
}
