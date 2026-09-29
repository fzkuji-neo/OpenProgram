import { navigate } from "../../navigate";
import { pushPath } from "../../shallow-nav";

function detailHost(path: string): string | null {
  return ["/skills", "/plugin", "/settings/providers"].find(
    (host) => path === host || path.startsWith(`${host}/`),
  ) ?? null;
}

/** A sidebar page needs its route component; changing only pathname cannot load it. */
export function navigateTabRoute(path: string): void {
  const pathname = path.split(/[?#]/, 1)[0];
  const current = typeof window !== "undefined" ? window.location.pathname : "";
  const host = detailHost(pathname);
  if (pathname === "/chat" || pathname.startsWith("/s/")
    || (host !== null && detailHost(current) === host)) {
    pushPath(path);
  } else {
    navigate(path);
  }
}
