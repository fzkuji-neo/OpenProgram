"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/lib/i18n";

// Static export has no dynamic segments: /plugin/<name>/<slug...> is
// served by the worker's SPA fallback with this page's HTML; name and
// slug are resolved client-side from the pathname.
export default function PluginWebPage() {
  const pathname = usePathname() || "";
  const { name, slugArr } = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean); // ["plugin", name, ...slug]
    return {
      name: parts[1] ? decodeURIComponent(parts[1]) : undefined,
      slugArr: parts.slice(2).map(decodeURIComponent),
    };
  }, [pathname]);
  const [hasWeb, setHasWeb] = useState<boolean | null>(null);
  const [err, setErr] = useState<string>("");
  const { text } = useTranslation();

  useEffect(() => {
    if (!name) return;
    fetch(`/api/plugins/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setErr(d.error);
          setHasWeb(false);
          return;
        }
        const ep = d.entrypoints || {};
        setHasWeb(Boolean(ep.web));
      })
      .catch((e) => {
        setErr(String(e));
        setHasWeb(false);
      });
  }, [name]);

  const src = useMemo(() => {
    if (!name) return "";
    const slugPath = slugArr.join("/");
    return `/api/plugins/${encodeURIComponent(name)}/web/${slugPath}`;
  }, [name, slugArr]);

  const notice = (body: ReactNode, tone: "muted" | "error" = "muted") => (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className={"max-w-md rounded-lg border border-border bg-muted px-5 py-4 text-sm "
          + (tone === "error" ? "text-destructive" : "text-muted-foreground")}
      >
        {body}
      </div>
    </div>
  );
  if (!name) return notice(text("No plugin named in the address.", "地址里没有插件名。"), "error");
  if (err) return notice(err, "error");
  if (hasWeb === null) return notice(text("Loading…", "加载中…"));
  if (!hasWeb) {
    return notice(
      <>
        {text("Plugin ", "插件 ")}<strong className="text-foreground">{name}</strong>
        {text(" has no web page (manifest key web).", " 没有声明 web 页面（manifest 键 web）。")}
      </>,
    );
  }

  return (
    <iframe
      src={src}
      style={{ width: "100%", height: "100%", border: 0, background: "var(--bg-primary)" }}
      title={`plugin:${name}`}
    />
  );
}
