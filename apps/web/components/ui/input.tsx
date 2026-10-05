import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Height + radius come from the button set so Input + Button
          // align horizontally when they sit next to each other in a
          // form row (e.g. settings api-key, mcp edit dialog). The old
          // shadcn defaults (h-10 + rounded-md = 6px) were taller than
          // the Button after the size-token unification, which left a
          // ~2px stair-step on every "input + submit" row.
          //
          // Focus changes the existing border color. base.css suppresses
          // additional outlines and shadows for all text-entry controls.
          "ui-text-input flex h-[var(--ui-button-h)] w-full rounded-[var(--ui-button-radius)] border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[color:var(--accent-blue)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
