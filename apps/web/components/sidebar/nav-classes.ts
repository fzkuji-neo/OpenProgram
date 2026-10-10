/**
 * Shared class strings for the rails' nav rows and header toggle. Used
 * by the left `<Sidebar />`, the right `<RightSidebar />`, the memory
 * page tabs and the settings header so they stay visually identical.
 *
 * Every row is the official shadcn radix-luma `SidebarMenuButton`
 * recipe (components/ui/sidebar.tsx); the toggle is the official
 * `SidebarTrigger` (a ghost icon-sm Button). This file only adds the
 * app's hooks on top: the stable `sidebar-*` class names the collapsed
 * cascade in app/styles/base.css targets, the named `group/row` the
 * icon hover effects read, and the 16px icon size.
 *
 * The row group is NAMED (`group/row`) on purpose: the rail shell
 * carries the official unnamed `group`, so an unnamed `group-hover:`
 * on a row would fire for the whole rail.
 */
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { sidebarMenuButtonVariants } from "@/components/ui/sidebar";

/** Header button — toggle / collapse the rail. Official SidebarTrigger. */
export const sidebarToggleClass = cn(
  // Legacy global class — used by .sidebar.collapsed CSS selectors
  // in app/styles/base.css. Without it those rules silently miss
  // the React-rendered DOM.
  "sidebar-toggle",
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "text-nav-color hover:text-nav-color-hover [&_svg:not([class*='size-'])]:size-[20px]",
);

/**
 * Main nav row — `<New chat />`, `<Agents />`, `<Abilities />` … on the
 * left; `<Files />`, `<Activity />`, `<Resources />` on the right.
 */
export const sidebarNavItemClass = cn(
  sidebarMenuButtonVariants(),
  // `sidebar-nav-item` stays for the `.sidebar.collapsed` rules in
  // base.css; `group/row` lets the inner icon react to the row hover.
  "sidebar-nav-item group/row shrink-0",
  "font-normal no-underline cursor-pointer",
  // 16px icons (official size-4 is 14px at this app's 14px root); the
  // collapsed 28px square keeps 6px of padding so they are not clipped.
  "[&_svg]:size-[16px] group-data-[collapsible=icon]:p-[6px]!",
);

/** Active variant — appended to `sidebarNavItemClass` when current route matches. */
export const sidebarNavItemActiveClass =
  "bg-sidebar-accent font-medium text-sidebar-accent-foreground";

/** 16-wide icon container, 20-tall. Every icon's visual centre lands
 *  on the same x regardless of SVG size. */
export const sidebarNavIconClass = [
  "sidebar-nav-icon",
  "flex w-[16px] h-[20px] shrink-0 items-center justify-center",
  "overflow-visible",
  "transition-colors duration-75",
].join(" ");

/**
 * Class applied to the `<svg>` *inside* `sidebarNavIconClass` so
 * Heroicons-style icons get a uniform spring-out scale on hover.
 */
export const sidebarNavIconSvgClass = [
  "shrink-0",
  "transition-transform duration-[220ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
  "group-hover/row:scale-[1.12]",
].join(" ");

/** Text label inside a nav row. */
export const sidebarNavLabelClass = [
  "sidebar-nav-label",
  "flex-1 truncate leading-[20px]",
].join(" ");

/**
 * Trailing action icon (e.g. the refresh button on the Abilities row).
 * Hidden at rest, fades in on parent hover.
 */
export const sidebarNavActionClass = [
  "sidebar-nav-action",
  "ml-auto opacity-0",
  "transition-opacity duration-150 ease-out",
  "group-hover/row:opacity-60",
  "hover:!opacity-100",
].join(" ");

/** Consistent hover surfaces for the pin, new-chat and project-options actions. */
export const sidebarProjectActionClass = [
  "inline-flex size-[20px] shrink-0 items-center justify-center",
  "rounded-xl border-0 p-0 leading-none",
  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
].join(" ");
