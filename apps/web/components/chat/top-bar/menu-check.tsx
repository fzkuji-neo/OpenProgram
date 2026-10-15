import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { CHECK_SLOT } from "./menu-styles";

/** The selected row's check in every menu: Claude's bold 16px check in
 *  accent blue, in the CHECK_SLOT column (CHECK_SLOT_PAD on other rows). */
export function MenuCheck({ className }: { className?: string }) {
  return <Check size={16} strokeWidth={2.5} className={cn(CHECK_SLOT, className)} aria-hidden="true" />;
}
