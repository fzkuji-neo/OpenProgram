"use client"

// shadcn/ui radix-rhea Select (registry styles/radix-rhea/select), adapted
// to this app:
// - React 18: the parts forward their refs (refs are not props until 19).
// - The popup is the app's menu frame (MENU_PANEL: Rhea geometry on the
//   glass material every menu shares) instead of the registry's solid
//   bg-popover + ring, and it opens below the trigger (`popper`) like the
//   app's other menus rather than over it.
// - The chosen row shows the app's accent check (MenuCheck), and the
//   trigger text takes --text-bright rather than inheriting a muted parent.
// - It stacks above dialogs (z-[130]; DialogContent is z-[120]).
// `SimpleSelect` below is the one-line form for a value + option list,
// which is how the app's former <select> elements read.

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { ChevronDown, ChevronUp } from "lucide-react"

import { MenuCheck } from "@/components/chat/top-bar/menu-check"
import { MENU_PANEL } from "@/components/chat/top-bar/menu-styles"
import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Group>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Group
    ref={ref}
    data-slot="select-group"
    className={cn("scroll-my-1.5", className)}
    {...props}
  />
))
SelectGroup.displayName = SelectPrimitive.Group.displayName

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
    size?: "sm" | "default"
  }
>(({ className, size = "default", children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    data-slot="select-trigger"
    data-size={size}
    className={cn(
      "flex w-fit items-center justify-between gap-1.5 rounded-2xl border border-transparent bg-input/50 px-3 py-2 text-sm whitespace-nowrap text-[var(--text-bright)] transition-[color,box-shadow] duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="pointer-events-none size-4 text-muted-foreground" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", align = "start", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      data-slot="select-content"
      data-align-trigger={position === "item-aligned"}
      className={cn(
        MENU_PANEL,
        "relative z-[130] max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto text-popover-foreground duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      align={align}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        data-position={position}
        className="data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)"
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    data-slot="select-label"
    className={cn("px-2 py-1 text-xs text-muted-foreground", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    data-slot="select-item"
    className={cn(
      "relative flex min-h-7 w-full cursor-default items-center gap-2 rounded-xl py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className
    )}
    {...props}
  >
    <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <MenuCheck />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    data-slot="select-separator"
    className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    data-slot="select-scroll-up-button"
    className={cn("z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4", className)}
    {...props}
  >
    <ChevronUp />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    data-slot="select-scroll-down-button"
    className={cn("z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4", className)}
    {...props}
  >
    <ChevronDown />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

// Radix reserves "" for "no selection" (the placeholder shows), so an
// option whose value is "" travels under this sentinel and comes back
// out as "". Without such an option, "" is the placeholder state.
const EMPTY = "__empty__"

export interface SimpleSelectOption<T extends string = string> {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

export interface SimpleSelectGroup<T extends string = string> {
  label: React.ReactNode
  options: SimpleSelectOption<T>[]
}

/**
 * A value + option list as one Select. Options may be grouped
 * (`{label, options}` entries render a SelectLabel heading).
 */
function SimpleSelect<T extends string = string>({
  value,
  onValueChange,
  options,
  placeholder,
  size = "default",
  disabled,
  className,
  contentClassName,
  align,
  id,
  name,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  value: T
  onValueChange: (value: T) => void
  options: (SimpleSelectOption<T> | SimpleSelectGroup<T>)[]
  placeholder?: React.ReactNode
  size?: "sm" | "default"
  disabled?: boolean
  className?: string
  contentClassName?: string
  align?: "start" | "center" | "end"
  id?: string
  name?: string
  "aria-label"?: string
  "aria-describedby"?: string
}) {
  const flat = options.flatMap((entry) => ("options" in entry ? entry.options : [entry]))
  const hasEmpty = flat.some((o) => o.value === "")
  const toRadix = (v: string) => (v === "" && hasEmpty ? EMPTY : v)
  const item = (o: SimpleSelectOption<T>) => (
    <SelectItem key={toRadix(o.value)} value={toRadix(o.value)} disabled={o.disabled}>
      {o.label}
    </SelectItem>
  )
  return (
    <Select
      value={toRadix(value)}
      onValueChange={(v) => onValueChange((v === EMPTY ? "" : v) as T)}
      disabled={disabled}
      name={name}
    >
      <SelectTrigger id={id} size={size} className={className} aria-label={ariaLabel} aria-describedby={ariaDescribedBy}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName} align={align}>
        {options.map((entry, index) =>
          "options" in entry ? (
            <SelectGroup key={`group-${index}`}>
              <SelectLabel>{entry.label}</SelectLabel>
              {entry.options.map(item)}
            </SelectGroup>
          ) : (
            item(entry)
          )
        )}
      </SelectContent>
    </Select>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SimpleSelect,
}
