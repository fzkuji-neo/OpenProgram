import { Check } from "lucide-react";

/** Checkbox options share their title/description layout in Web and desktop overlays. */
export function MenuOptionContent({ label, description, checked }: {
  label: string;
  description?: string;
  checked?: boolean;
}) {
  // Same type as every two-line menu row (top-bar/menu-styles.ts):
  // 13/19 title, 12/15 muted description, the checkbox on the title line.
  // pb 1.5px: with the row's 2.5px that is the two-line row's 4px bottom.
  return <span className={`flex w-full min-w-0 items-start gap-[6px] ${description ? "pb-[1.5px]" : ""}`}>
    {typeof checked === "boolean" ? <span aria-hidden="true"
      className="mt-[1.5px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-text-muted">
      {checked ? <Check size={12} /> : null}
    </span> : null}
    <span className="min-w-0 flex-1 text-left">
      <span className="block whitespace-normal text-[13px] leading-[19px]">{label}</span>
      {description ? <span className="block whitespace-normal text-[12px] leading-[15px] text-text-muted">{description}</span> : null}
    </span>
  </span>;
}
