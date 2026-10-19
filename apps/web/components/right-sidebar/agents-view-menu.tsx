"use client";

/**
 * The Agents list's view menu: which agents to show and how to arrange
 * them. Built from the composer options menu's pieces (the same radix
 * wrapper, MENU_PANEL frame, value rows and check rows), so every popup
 * in the app reads alike.
 */
import { useRef, useState } from "react";
import { type AnimatedNavIconHandle, GalleryVerticalEndIcon } from "@/components/animated-icons";
import { SolarIcon, type SolarIconName } from "@/components/solar-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverTip } from "@/components/ui/tooltip";
import { MENU_ITEM_STATES, MENU_PANEL, MENU_SEPARATOR, itemCls } from "@/components/chat/top-bar/menu-styles";
import { PlusMenuRow } from "@/components/chat/composer/controls/menu-pieces";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ACTIVITY_VIEW,
  setActivityView,
  useActivityView,
  type ActivityArrange,
  type ActivityShow,
} from "@/lib/prefs/activity-view";

function ValueSubmenu<T extends string>({ icon, label, value, options, onPick }: {
  icon: SolarIconName; label: string; value: T; options: [T, string][]; onPick: (value: T) => void;
}) {
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger className={cn(itemCls(false), MENU_ITEM_STATES)}>
      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center" aria-hidden="true">
        <SolarIcon name={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-text-muted">{options.find(([key]) => key === value)?.[1]}</span>
      <SolarIcon name="alt-arrow-right" size={14} className="shrink-0 text-text-muted" />
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent className={cn(MENU_PANEL, "z-[201]")}>
      {options.map(([key, name]) => <PlusMenuRow key={key} active={key === value} icon={null} label={name} onSelect={() => onPick(key)} />)}
    </DropdownMenuSubContent>
  </DropdownMenuSub>;
}

export function AgentsViewMenu() {
  const { text } = useTranslation();
  const view = useActivityView();
  const [open, setOpen] = useState(false);
  const iconRef = useRef<AnimatedNavIconHandle>(null);
  // A non-default view keeps the button lit, so a filter is never hidden.
  const changed = view.show !== DEFAULT_ACTIVITY_VIEW.show || view.arrange !== DEFAULT_ACTIVITY_VIEW.arrange;
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <HoverTip label={text("Show and arrange agents", "显示和排列 agent")}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={text("Show and arrange agents", "显示和排列 agent")}
          data-view-changed={changed ? "1" : "0"}
          onClick={event => event.stopPropagation()}
          onMouseEnter={() => iconRef.current?.startAnimation?.()}
          onMouseLeave={() => iconRef.current?.stopAnimation?.()}
          className={"flex size-[24px] items-center justify-center rounded-[6px] outline-none transition-colors hover:bg-[var(--bg-hover)] "
            + (open ? "bg-[var(--bg-hover)] " : "")
            + (open || changed ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]")}
        >
          <GalleryVerticalEndIcon ref={iconRef} size={18} />
        </button>
      </DropdownMenuTrigger>
    </HoverTip>
    <DropdownMenuContent align="end" sideOffset={6} className={cn(MENU_PANEL, "z-[200] min-w-[200px]")}>
      <ValueSubmenu<ActivityShow>
        icon="eye"
        label={text("Show", "显示")}
        value={view.show}
        options={[["all", text("All", "全部")], ["attention", text("Needs you", "需要处理")], ["running", text("Running", "正在运行")]]}
        onPick={show => setActivityView({ show })}
      />
      <DropdownMenuSeparator className={MENU_SEPARATOR} />
      <ValueSubmenu<ActivityArrange>
        icon="structure"
        label={text("Arrange", "排列")}
        value={view.arrange}
        options={[["structure", text("By structure", "按结构")], ["time", text("By time", "按时间")]]}
        onPick={arrange => setActivityView({ arrange })}
      />
    </DropdownMenuContent>
  </DropdownMenu>;
}
