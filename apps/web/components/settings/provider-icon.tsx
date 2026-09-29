"use client";

import icons from "./provider-icons.json";
import styles from "./settings-page.module.css";

/** Brand assets ship with the App; unknown/custom providers keep an initial. */
export function ProviderIcon({ id, size = 24 }: { id: string; size?: number }) {
  const icon = (icons as Record<string, { file: string; mono: boolean }>)[id];
  const dimensions = { width: size, height: size };
  if (icon) {
    const url = `/images/providers/${icon.file}`;
    return (
      <span className={styles.providerIcon} style={dimensions} title={id} aria-hidden="true">
        {icon.mono ? (
          <span style={{
            width: "100%", height: "100%", backgroundColor: "var(--text-primary)",
            mask: `url("${url}") center / contain no-repeat`,
            WebkitMask: `url("${url}") center / contain no-repeat`,
          }} />
        ) : (
          // Static local SVGs need no image optimizer or remote connection.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" width={size} height={size} loading="lazy" />
        )}
      </span>
    );
  }
  return (
    <span className={styles.providerIconLetter} style={dimensions} title={id}>
      {(id[0] || "?").toUpperCase()}
    </span>
  );
}
