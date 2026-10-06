"use client";

import { useState } from "react";
import { ChromeIcon } from "@/components/animated-icons";
import styles from "./center-tabs.module.css";

/** A successful image load can still decode to entirely transparent pixels. */
function hasVisiblePixels(image: HTMLImageElement): boolean {
  if (!image.naturalWidth || !image.naturalHeight) return false;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return true;
  try {
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) return true;
    return false;
  } catch {
    // Persisted remote URLs may taint the canvas. Desktop state replaces them
    // with image data; ordinary Web still displays successfully loaded icons.
    return true;
  }
}

export function TabFavicon({ url }: { url?: string }) {
  return <FaviconImage key={url || ""} url={url} />;
}

function FaviconImage({ url }: { url?: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  return (
    <span className={styles.tabFaviconSlot}>
      {status !== "ready" && <ChromeIcon size={14} />}
      {url && status !== "failed" && (
        <img
          className={styles.tabFavicon}
          src={url}
          alt=""
          style={{ visibility: status === "ready" ? "visible" : "hidden" }}
          onLoad={(event) => setStatus(hasVisiblePixels(event.currentTarget) ? "ready" : "failed")}
          onError={() => setStatus("failed")}
        />
      )}
    </span>
  );
}
