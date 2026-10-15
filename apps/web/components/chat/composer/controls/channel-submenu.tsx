"use client";

/**
 * "+" menu → Channel: bind this conversation to a chat channel account
 * (or unbind). The channel chip above the input only appears once a
 * channel is bound, so this submenu is where an unbound conversation
 * binds one.
 */
import { SolarIcon } from "@/components/solar-icons";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { channelBrand, useChannelChoices } from "../../top-bar/channel-choices";
import {
  CHECK_SLOT_PAD,
  GROUP_LABEL,
  MENU_ITEM_STATES,
  MENU_PANEL,
  MENU_SEPARATOR,
  itemCls,
} from "../../top-bar/menu-styles";
import { PlusMenuRow } from "./menu-pieces";

export function ChannelSubmenu() {
  const { text } = useTranslation();
  const { groups, current, pick } = useChannelChoices();
  const currentLabel = current.channel
    ? channelBrand(current.channel)
    : text("Not connected", "不连接");

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={cn(itemCls(false), MENU_ITEM_STATES)}>
        <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center" aria-hidden="true">
          <SolarIcon name="chat-round-dots" size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate">{text("Channel", "渠道")}</span>
        <span className="shrink-0 text-text-muted">{currentLabel}</span>
        <SolarIcon name="alt-arrow-right" size={14} className="shrink-0 text-text-muted" />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent sideOffset={6} className={cn(MENU_PANEL, "z-[201]")}>
        <PlusMenuRow
          active={!current.channel}
          icon={null}
          label={text("Not connected", "不连接")}
          onSelect={() => pick("", "")}
        />
        {groups.map((g) => (
          <div key={g.plat} role="none">
            <div className={GROUP_LABEL}>{channelBrand(g.plat)}</div>
            {g.accounts.map((r) => (
              <PlusMenuRow
                key={r.channel + ":" + r.account_id}
                active={r.channel === current.channel && r.account_id === current.account_id}
                icon={null}
                label={r.name && r.name !== r.account_id ? `${r.account_id} · ${r.name}` : r.account_id}
                onSelect={() => pick(r.channel, r.account_id)}
              />
            ))}
          </div>
        ))}
        <DropdownMenuSeparator className={MENU_SEPARATOR} />
        <DropdownMenuItem asChild className={cn(itemCls(false), MENU_ITEM_STATES, "no-underline")}>
          <a href="/settings/channels">
            <SolarIcon name="settings-minimalistic" size={16} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{text("Add channels", "添加渠道")}</span>
            <span className={CHECK_SLOT_PAD} />
          </a>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
