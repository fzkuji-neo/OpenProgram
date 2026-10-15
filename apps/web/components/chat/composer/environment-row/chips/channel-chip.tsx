"use client";

import { useEffect, useState } from "react";

import { HoverTip, TipBody } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { useSessionStore } from "@/lib/session-store";
import { channelIcon } from "@/lib/runtime-bridge/conversations";
import { closeAllPopovers } from "@/lib/runtime-bridge/ui";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { channelBrand, useCurrentChannel } from "../../../top-bar/channel-choices";
import { ChannelMenu } from "../../../top-bar/channel-menu";

/** Channel chip — shown only while this conversation is bound to a chat
 *  channel account (its messages are mirrored there). Unbound chats bind
 *  from the "+" menu's Channel submenu. The letter glyph takes the
 *  channel poll's health colour (yellow degraded, red unreachable). */
export function ChannelChip() {
  const { text } = useTranslation();
  const { channel, account_id } = useCurrentChannel();
  const health = useSessionStore((s) => s.channelHealth);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("topbar-close-menus", close);
    return () => window.removeEventListener("topbar-close-menus", close);
  }, []);

  if (!channel) return null;

  function onOpenChange(next: boolean) {
    if (next) {
      window.dispatchEvent(new Event("topbar-close-menus"));
      closeAllPopovers();
    }
    setOpen(next);
  }

  const brand = channelBrand(channel);
  const label = account_id ? `${brand} · ${account_id}` : brand;
  const color =
    health === "err" ? "var(--accent-red)" : health === "warn" ? "var(--accent-yellow)" : undefined;
  const healthText =
    health === "err"
      ? text("The channel is unreachable.", "渠道连接不上。")
      : health === "warn"
        ? text("The channel is degraded.", "渠道状态异常。")
        : "";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <HoverTip
        label={
          <TipBody
            title={text(`Channel: ${label}`, `渠道：${label}`)}
            detail={[
              text("Messages are mirrored to this account. Click to change or disconnect.",
                   "消息会同步到这个账号。点击切换或断开。"),
              healthText,
            ].filter(Boolean).join(" ")}
          />
        }
      >
        <PopoverTrigger asChild>
          <span
            role="button"
            className={cn(buttonVariants({ variant: "elevated", size: "sm" }), "status-badge")}
            data-channel-chip=""
          >
            <span
              className="provider-icon"
              style={{ width: 14, height: 14, color }}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: channelIcon(channel) }}
            />
            <span className="badge-short">{label}</span>
          </span>
        </PopoverTrigger>
      </HoverTip>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        <ChannelMenu onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
