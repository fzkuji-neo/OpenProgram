"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./custom-select.module.css";
import { MenuCheck } from "@/components/chat/top-bar/menu-check";
import { CHECK_SLOT_PAD } from "@/components/chat/top-bar/menu-styles";

export function CustomSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={styles.selectWrap}>
      <button
        type="button"
        className={styles.select}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label}</span>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className={styles.selectMenu} role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={
                o.value === value
                  ? `${styles.selectOption} ${styles.selectOptionActive}`
                  : styles.selectOption
              }
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.value === value ? <MenuCheck /> : <span className={CHECK_SLOT_PAD} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
