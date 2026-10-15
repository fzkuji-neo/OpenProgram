"use client";

/**
 * Channel menu — the content of the channel chip's popover.
 *
 * Lists the enabled channel accounts (WeChat / Discord / Telegram /
 * Slack) grouped by platform, plus a "Not connected" row that unbinds.
 * Picking one mirrors the conversation's messages to that account; it
 * never changes where the conversation runs (that is the environment
 * chip beside it).
 *
 * Positioning / click-outside / portal are handled by the shadcn
 * <Popover> that hosts it; this component just renders the rows.
 */
import { channelIcon } from "@/lib/runtime-bridge/conversations";
import { useTranslation } from "@/lib/i18n";
import { SolarIcon } from "@/components/solar-icons";
import { channelBrand, useChannelChoices } from "./channel-choices";
import {
  CHECK_SLOT_PAD,
  GROUP_LABEL,
  MENU_PANEL,
  MENU_SEPARATOR,
  MENU_TAG,
  itemCls,
} from "./menu-styles";
import { MenuCheck } from "./menu-check";

export function ChannelMenu({ onClose }: { onClose: () => void }) {
  const { text } = useTranslation();
  const { groups, current: cur, pick } = useChannelChoices();

  function choose(ch: string, acct: string) {
    onClose();
    pick(ch, acct);
  }

  return (
    <div className={MENU_PANEL}>
      <div className={GROUP_LABEL}>{text("Channel", "渠道")}</div>

      {/* 选中不铺底色（hover 是唯一底色），选中态只靠右侧勾。 */}
      <div className={itemCls(false)} onClick={() => choose("", "")}>
        <span className="flex-1 truncate">{text("Not connected", "不连接")}</span>
        {!cur.channel ? (
          <MenuCheck />
        ) : (
          <span className={CHECK_SLOT_PAD} />
        )}
      </div>

      {groups.map((g) => (
        <div key={g.plat}>
          <div className={GROUP_LABEL}>
            <span
              className="provider-icon"
              style={{ width: 14, height: 14 }}
              dangerouslySetInnerHTML={{ __html: channelIcon(g.plat) }}
            />
            <span>{channelBrand(g.plat)}</span>
          </div>
          {g.accounts.map((r) => {
            const active = r.channel === cur.channel && r.account_id === cur.account_id;
            const meta = r.name && r.name !== r.account_id ? r.name : "";
            return (
              <div
                key={r.channel + ":" + r.account_id}
                className={itemCls(false)}
                onClick={() => choose(r.channel, r.account_id)}
              >
                {/* Claude 实测：别名 tag 紧贴账号名左侧成簇，右缘只留勾位。 */}
                <span className="flex min-w-0 flex-1 items-center gap-[6px]">
                  <span className="truncate">{r.account_id}</span>
                  {meta ? <span className={MENU_TAG}>{meta}</span> : null}
                </span>
                {active ? (
                  <MenuCheck />
                ) : (
                  <span className={CHECK_SLOT_PAD} />
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Grammar-B action row：设置图标 + 文案 + 右箭头，常驻菜单底部。 */}
      <div className={MENU_SEPARATOR} />
      <a
        href="/settings/channels"
        onClick={onClose}
        className={`${itemCls(false)} no-underline`}
      >
        <SolarIcon name="settings-minimalistic" size={16} aria-hidden="true" />
        <span className="flex-1 truncate">{text("Add channels", "添加渠道")}</span>
        <SolarIcon name="alt-arrow-right" size={14} className="text-text-muted" />
      </a>
    </div>
  );
}
