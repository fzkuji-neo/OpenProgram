"use client";

import { useEffect, useState } from "react";
import { ChromeIcon } from "@/components/animated-icons";
import { cachedFavicon, loadFavicon } from "@/lib/browser/favicon-cache";
import styles from "./center-tabs.module.css";

export function TabFavicon({ url, fallbackUrl }: { url?: string; fallbackUrl?: string }) {
  return <FaviconImage key={`${url || ""}\n${fallbackUrl || ""}`} url={url} fallbackUrl={fallbackUrl} />;
}

function FaviconImage({ url, fallbackUrl }: { url?: string; fallbackUrl?: string }) {
  const [icon, setIcon] = useState(() => cachedFavicon(url, fallbackUrl));
  useEffect(() => {
    let current = true;
    void loadFavicon(url, fallbackUrl).then(value => { if (current) setIcon(value); });
    return () => { current = false; };
  }, [url, fallbackUrl]);
  // The callback paints before the browser's first frame, including cache hits.
  const paint = (node: HTMLCanvasElement | null) => {
    if (node && icon) node.getContext('2d')?.drawImage(icon, 0, 0);
  };
  return (
    <span className={styles.tabFaviconSlot} aria-hidden="true">
      {icon
        ? <canvas ref={paint} className={styles.tabFavicon} width={32} height={32} />
        : <ChromeIcon size={14} />}
    </span>
  );
}
