import { Check } from "lucide-react";

/** Checkbox options share their title/description layout in Web and desktop overlays. */
export function MenuOptionContent({ label, description, checked }: {
  label: string;
  description?: string;
  checked?: boolean;
}) {
  return <span className="flex w-full min-w-0 items-start gap-3 py-2">
    {typeof checked === "boolean" ? <span aria-hidden="true"
      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-text-muted">
      {checked ? <Check size={12} /> : null}
    </span> : null}
    <span className="min-w-0 flex-1 text-left">
      <span className="block whitespace-normal font-medium leading-5">{label}</span>
      {description ? <span className="mt-2 block whitespace-normal text-xs leading-5 text-text-muted">{description}</span> : null}
    </span>
  </span>;
}
