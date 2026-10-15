"use client";

import { useEffect, useState } from "react";

import { SolarIcon } from "@/components/solar-icons";
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

/** Channel chip — which chat channel account this conversation's
 *  messages are mirrored to, beside the environment chip. Always shown:
 *  unbound reads "Not connected", bound shows the platform letter and
 *  account, tinted by the channel poll's health (yellow degraded, red
 *  unreachable). The popover binds, switches or disconnects. */
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

  function onOpenChange(next: boolean) {
    if (next) {
      window.dispatchEvent(new Event("topbar-close-menus"));
      closeAllPopovers();
    }
    setOpen(next);
  }

  const brand = channel ? channelBrand(channel) : "";
  const label = !channel
    ? text("Not connected", "未连接")
    : account_id ? `${brand} · ${account_id}` : brand;
  const color =
    !channel ? undefined
    : health === "err" ? "var(--accent-red)" : health === "warn" ? "var(--accent-yellow)" : undefined;
  const healthText =
    !channel ? ""
    : health === "err"
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
              channel
                ? text("Messages are mirrored to this account. Click to change or disconnect.",
                       "消息会同步到这个账号。点击切换或断开。")
                : text("Not mirrored to any chat app. Click to connect WeChat, Telegram, Discord or Slack.",
                       "没有同步到聊天软件。点击绑定微信、Telegram、Discord 或 Slack。"),
              healthText,
            ].filter(Boolean).join(" ")}
          />
        }
      >
        <PopoverTrigger asChild>
          <span
            role="button"
            className={cn(buttonVariants({ variant: "elevated", size: "sm" }), "status-badge cursor-pointer")}
            data-channel-chip=""
          >
            {channel ? (
              <span
                className="provider-icon"
                style={{ width: 14, height: 14, color }}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: channelIcon(channel) }}
              />
            ) : (
              <SolarIcon name="chat-round-dots" size={14} aria-hidden="true" />
            )}
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
