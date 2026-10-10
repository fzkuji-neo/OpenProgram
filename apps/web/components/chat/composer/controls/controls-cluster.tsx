"use client";

/**
 * Composer controls cluster — permission / plus menu / active tool chips on
 * the left; chat+exec model chips, thinking-effort pill and context ring on
 * the right.
 *
 * Always rendered in the detached `.controlsRow` below the wrapper —
 * every composer mode shares the same row, this component only knows
 * the cluster's contents.
 */
import React, { useRef, useState } from "react";

import {
  type AnimatedNavIconHandle,
  GaugeIcon,
} from "@/components/animated-icons";
import { SolarIcon } from "@/components/solar-icons";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverTip, TipBody } from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n";
import { effortLevelColor, formatEffortLabel } from "@/lib/effort-color";
import { GROUP_LABEL, MENU_PANEL, MENU_SEPARATOR } from "../../top-bar/menu-styles";
import { AgentBadge, PermissionBadge } from "../../top-bar";
import { ContextBadge } from "../../context-badge";
import {
  AttachIcon,
  OptionsIcon,
  ToolProfileIcon,
  ToolsIcon,
  SandboxIcon,
  UnattendedIcon,
  WebSearchIcon,
} from "../icons";
import { PlusMenuRow, ToolChip } from "./menu-pieces";
import { ThinkingEffortPill } from "./thinking-effort-pill";
import type { ThinkingOption } from "./use-thinking-effort";
import styles from "../composer.module.css";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The Tools row is a split row: the row itself toggles tools, and a
// 22×22 gear button laid over its right end opens the tool-profile
// submenu. The gear sits immediately before the 14px check column that
// every row reserves (CHECK_SLOT_PAD), so it never moves when Tools
// toggles: 10px row inset + 14px check + 8px gap = 32px from the edge.
// Hover / keyboard / open tints are a notch of ink over the row's own
// hover fill, since the row underneath is already tinted. (Written out
// in full: Tailwind only generates classes it can read literally.)
const GEAR_CLS =
  "absolute right-[32px] top-1/2 flex h-[22px] w-[22px] -translate-y-1/2 cursor-pointer " +
  "items-center justify-center rounded-[6px] text-text-muted outline-none " +
  "hover:bg-[color-mix(in_srgb,var(--text-bright)_10%,transparent)] hover:text-text-bright " +
  "data-[highlighted]:bg-[color-mix(in_srgb,var(--text-bright)_10%,transparent)] " +
  "data-[highlighted]:text-text-bright " +
  "data-[state=open]:bg-[color-mix(in_srgb,var(--text-bright)_10%,transparent)] " +
  "data-[state=open]:text-text-bright";

export interface ControlsClusterProps {
  /** Split-pane composers pass their bound session id so the agent badges
   *  get unique DOM ids; unbound keeps the legacy singleton ids. */
  bound: string | null;
  plusMenuOpen: boolean;
  setPlusMenuOpen(open: boolean): void;
  onPickImages(): void;
  pendingImagesCount: number;
  pendingDocsCount: number;
  toolsEnabled: boolean;
  toggleTools(): void;
  webSearchEnabled: boolean;
  toggleWebSearch(): void;
  fastEnabled: boolean;
  fastSupported: boolean;
  fastHint: string;
  toggleFast(): void;
  unattended: boolean;
  toggleUnattended(): void;
  sandboxEnabled: boolean;
  sandboxAvailable: boolean;
  sandboxReason: string | null;
  toggleSandbox(): void;
  toolProfiles: Record<string, string[]>;
  activeProfile: string;
  switchProfile(name: string): void;
  chatAgent: { locked?: boolean; provider?: string; model?: string };
  execAgent: { provider?: string; model?: string };
  chatModel: string | undefined;
  noEnabledModels: boolean;
  thinking: string;
  thinkingOptions: ThinkingOption[];
  setThinking(value: string): void;
  thinkingMenuOpen: boolean;
  setThinkingMenuOpen(next: boolean | ((v: boolean) => boolean)): void;
  thinkingTriggerRef: React.RefObject<HTMLDivElement>;
}

export function ControlsCluster({
  bound,
  plusMenuOpen,
  setPlusMenuOpen,
  onPickImages,
  pendingImagesCount,
  pendingDocsCount,
  toolsEnabled,
  toggleTools,
  webSearchEnabled,
  toggleWebSearch,
  fastEnabled,
  fastSupported,
  fastHint,
  toggleFast,
  unattended,
  toggleUnattended,
  sandboxEnabled,
  sandboxAvailable,
  sandboxReason,
  toggleSandbox,
  toolProfiles,
  activeProfile,
  switchProfile,
  chatAgent,
  execAgent,
  chatModel,
  noEnabledModels,
  thinking,
  thinkingOptions,
  setThinking,
  thinkingMenuOpen,
  setThinkingMenuOpen,
  thinkingTriggerRef,
}: ControlsClusterProps) {
  const { text } = useTranslation();
  const plusIconRef = useRef<AnimatedNavIconHandle>(null);
  const effortIconRef = useRef<AnimatedNavIconHandle>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const anyToolActive =
    toolsEnabled || webSearchEnabled || unattended
    || (sandboxEnabled && sandboxAvailable);
  const effortColor = effortLevelColor(thinkingOptions, thinking);

  return (
    <>
          <div className={styles.inputOptions}>
            {/* Permission control leads the left cluster, restyled by
                the wrapper CSS into Claude's borderless "Accept edits ⌄"
                text form (no border / bg; popover + id untouched). */}
            <PermissionBadge />
            <DropdownMenu
              open={plusMenuOpen}
              onOpenChange={(o) => {
                setPlusMenuOpen(o);
                if (!o) setProfileMenuOpen(false);
                // Opening the plus menu collapses the effort pill (they
                // shared the bottom row and shouldn't be open at once).
                if (o) setThinkingMenuOpen(false);
              }}
            >
              <HoverTip
                label={
                  <TipBody
                    title={text("Options", "选项")}
                    detail={text("Attach files, and turn tools, web search or sandbox on and off", "添加文件，开关工具、网页搜索或沙箱")}
                  />
                }
              >
                <DropdownMenuTrigger asChild>
                  <button
                    className={`${cn(buttonVariants({ variant: "elevated", size: "icon-sm" }))} ${styles.plusBtn} ${anyToolActive ? styles.hasActive : ""}`}
                    onMouseEnter={() => plusIconRef.current?.startAnimation?.()}
                    onMouseLeave={() => plusIconRef.current?.stopAnimation?.()}
                    aria-label={text("More options", "更多选项")}
                    type="button"
                  >
                    <OptionsIcon ref={plusIconRef} />
                  </button>
                </DropdownMenuTrigger>
              </HoverTip>

              {/* The same radix wrapper and MENU_PANEL frame as every other
                  dropdown; radix owns placement, flip, roving focus and
                  dismissal. 9 = 10px band gap − 1px 输入框外扩 ring（底部
                  弹层统一）。z-[200] keeps the stacking the menu always had
                  (above the composer's own layers); the submenu sits one
                  above it. */}
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={9}
                className={cn(MENU_PANEL, "z-[200] max-w-[320px]")}
              >
                {/* Attach file — a plain action; selecting it closes the
                    menu. No shortcut hint — the app registers none. */}
                <PlusMenuRow
                  active={pendingImagesCount > 0 || pendingDocsCount > 0}
                  icon={<AttachIcon size={16} />}
                  label={text("Add files or photos", "添加文件或照片")}
                  onSelect={() => onPickImages()}
                />

                <DropdownMenuSeparator className={MENU_SEPARATOR} />

                {/* Tools — a split row. The row toggles tools; the gear laid
                    over its right end is a sibling menuitem (never nested)
                    that opens the click-only tool-profile submenu. `group`
                    lets the gear's hover / focus tint the whole row, as a
                    single row would. */}
                <div role="none" className="group relative">
                  <PlusMenuRow
                    active={toolsEnabled}
                    keepOpen
                    icon={<ToolsIcon size={16} />}
                    label={text("Tools", "工具")}
                    // Reserves the gear's 22px before the check column.
                    trailing={<span className="w-[22px] shrink-0" aria-hidden="true" />}
                    className={
                      "group-hover:bg-bg-hover group-hover:text-text-bright " +
                      "group-focus-within:bg-bg-hover group-focus-within:text-text-bright " +
                      "group-has-[[data-state=open]]:bg-bg-hover group-has-[[data-state=open]]:text-text-bright"
                    }
                    onSelect={() => {
                      toggleTools();
                      setProfileMenuOpen(false);
                    }}
                  />
                  <DropdownMenuSub open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
                    <DropdownMenuSubTrigger
                      className={GEAR_CLS}
                      aria-label={text("Tool profile", "工具配置")}
                      data-tool-profile-trigger=""
                      // Click-only: radix opens sub-menus on pointer rest;
                      // preventing the move skips that, keyboard still opens.
                      onPointerMove={(e) => e.preventDefault()}
                      // A second click closes (radix only ever opens on click).
                      onClick={(e) => {
                        if (profileMenuOpen) {
                          e.preventDefault();
                          setProfileMenuOpen(false);
                        }
                      }}
                    >
                      <ToolProfileIcon size={14} />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      align="end"
                      sideOffset={6}
                      className={cn(MENU_PANEL, "z-[201]")}
                      // Pointer travel over sibling rows moves radix focus
                      // out of the submenu; that is not a dismissal here.
                      onFocusOutside={(e) => e.preventDefault()}
                      // A press anywhere but the gear closes it (the gear
                      // toggles). Outside the menu the whole menu closes.
                      onPointerDownOutside={(e) => {
                        const target = e.detail.originalEvent.target as Element | null;
                        if (!target?.closest?.("[data-tool-profile-trigger]")) {
                          setProfileMenuOpen(false);
                        }
                      }}
                    >
                      <div className={GROUP_LABEL}>
                        {text("Access preset", "Access preset")}
                      </div>
                      <PlusMenuRow
                        active={activeProfile === "__agent__"}
                        icon={null}
                        label={text("Use Agent configuration", "使用 Agent 配置")}
                        onSelect={() => switchProfile("__agent__")}
                      />
                      {Object.keys(toolProfiles).sort().map((pName) => (
                        <PlusMenuRow
                          key={pName}
                          active={activeProfile === pName}
                          icon={null}
                          label={pName === "full" ? text("All Tools", "全部工具") : pName}
                          onSelect={() => switchProfile(pName)}
                        />
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </div>

                {/* Toggles keep the menu open (keepOpen). */}
                <PlusMenuRow
                  active={webSearchEnabled}
                  keepOpen
                  icon={<WebSearchIcon size={16} />}
                  label={text("Web Search", "网页搜索")}
                  onSelect={() => toggleWebSearch()}
                />

                <PlusMenuRow
                  active={sandboxEnabled && sandboxAvailable}
                  keepOpen
                  disabled={!sandboxAvailable}
                  title={sandboxReason || undefined}
                  icon={<SandboxIcon size={16} />}
                  label={
                    sandboxAvailable
                      ? text("Sandbox", "沙箱")
                      : text("Sandbox · Unavailable", "Sandbox · Unavailable")
                  }
                  onSelect={() => toggleSandbox()}
                />

                <DropdownMenuSeparator className={MENU_SEPARATOR} />

                <PlusMenuRow
                  active={unattended}
                  keepOpen
                  icon={<UnattendedIcon size={16} on={unattended} />}
                  label={text("Unattended", "无人值守")}
                  onSelect={() => toggleUnattended()}
                />
              </DropdownMenuContent>
            </DropdownMenu>

            <div className={styles.activeToolChips}>
              {/* Only ENABLED tools show as a chip here. The off ones are
                  not rendered at all — they live in the + menu and are
                  turned on from there. An active chip shows its × on hover
                  to switch it back off. (The container is :empty →
                  display:none, so all-off shows nothing.) HoverTip is a
                  real top-layer tooltip; a CSS ::after would be cropped by
                  the chip's overflow:hidden. */}
              {toolsEnabled && (
                <HoverTip label={<TipBody title={text("Tools on", "工具已开启")} detail={text("The agent can run tools. Click to turn off.", "agent 可以调用工具。点击关闭。")} />}>
                  <ToolChip
                    icon={<ToolsIcon size={16} />}
                    label={text("Tools", "工具")}
                    on
                    onToggle={toggleTools}
                  />
                </HoverTip>
              )}
              {webSearchEnabled && (
                <HoverTip label={<TipBody title={text("Web search on", "网页搜索已开启")} detail={text("The agent can search the web. Click to turn off.", "agent 可以上网搜索。点击关闭。")} />}>
                  <ToolChip
                    icon={<WebSearchIcon size={16} />}
                    label={text("Web Search", "网页搜索")}
                    on
                    onToggle={toggleWebSearch}
                  />
                </HoverTip>
              )}
              {sandboxEnabled && sandboxAvailable && (
                <HoverTip label={<TipBody title={text("Sandbox on", "沙箱已开启")} detail={text("Commands run in an isolated sandbox. Click to turn off.", "命令在隔离的沙箱里运行。点击关闭。")} />}>
                  <ToolChip
                    icon={<SandboxIcon size={16} />}
                    label={text("Sandbox", "沙箱")}
                    on
                    onToggle={toggleSandbox}
                  />
                </HoverTip>
              )}
              {unattended && (
                <HoverTip label={<TipBody title={text("Unattended on", "无人值守已开启")} detail={text("The agent won't stop to ask you questions. Click to turn off.", "agent 不会停下来向你提问。点击关闭。")} />}>
                  <ToolChip
                    icon={<UnattendedIcon size={16} on />}
                    label={text("Unattended", "无人值守")}
                    on
                    onToggle={toggleUnattended}
                  />
                </HoverTip>
              )}
            </div>

          </div>
          <div className={styles.inputBottomRight}>
            {/* Claude-style right cluster before the send affordance:
                chat + exec models as quiet borderless text ("Opus 4.8"
                form, restyled via .agentChips overrides — components
                and their popovers untouched), effort pill, context
                ring last. */}
            <div className={styles.agentChips}>
              <AgentBadge
                id={bound ? `chatAgentBadge-${bound}` : "chatAgentBadge"}
                kind="chat"
                locked={!!chatAgent.locked}
                provider={chatAgent.provider}
                model={chatAgent.model}
              />
              <AgentBadge
                id={bound ? `execAgentBadge-${bound}` : "execAgentBadge"}
                kind="exec"
                locked={false}
                provider={execAgent.provider}
                model={execAgent.model}
              />
            </div>
            {/* Effort picker only when a chat model is selected. No
                persistent "no model" indicator here by design — a
                blocked send/run fires a transient top toast instead
                (see ``promptNeedModel``). The `thinking` value still
                flows to submit (uses the model default) when hidden. */}
            {chatModel && !noEnabledModels ? (
              <HoverTip
                label={
                  <TipBody
                    title={thinking
                      ? text(`Thinking effort: ${formatEffortLabel(thinking)}`, `思考力度：${formatEffortLabel(thinking)}`)
                      : text("Thinking effort", "思考力度")}
                    detail={text("How long the model thinks before answering. Click to adjust.", "模型回答前思考多久。点击调整。")}
                  />
                }
              >
                {/* Wrapper is the outside-click boundary AND the anchor
                    for the pill's floating slider (detached row). The
                    text trigger only shows in the detached row (CSS);
                    the morphed internal band keeps the icon pill.
                    aria-expanded 挂在这个 div（HoverTip 的真正 trigger
                    元素）上，卡开着时 tooltip.tsx 的拦截才生效——之前标
                    到里层按钮，HoverTip 看的是这个 div，所以拦不住。 */}
                <div
                  ref={thinkingTriggerRef}
                  className={styles.effortControl}
                  aria-expanded={thinkingMenuOpen}
                >
                  {(
                    <button
                      type="button"
                      className={`${cn(buttonVariants({ variant: "elevated", size: "sm" }))} ${styles.effortText}`}
                      aria-expanded={thinkingMenuOpen}
                      onMouseEnter={() => effortIconRef.current?.startAnimation?.()}
                      onMouseLeave={() => effortIconRef.current?.stopAnimation?.()}
                      onClick={() => {
                        setPlusMenuOpen(false);
                        setThinkingMenuOpen((v) => !v);
                      }}
                      // 常规宽度保持原有文字配色；最高档仍用紫色标识。
                      style={thinking === "max" ? { color: "#8E6BD9" } : undefined}
                    >
                      <SolarIcon
                        name="dumbbell-large-minimalistic"
                        ref={effortIconRef}
                        size={14}
                        className={styles.compactEffortIcon}
                        // 图标只在窄态显示，因此逐级颜色不会改变常规宽度文字。
                        style={{ color: thinking === "max" ? "#8E6BD9" : effortColor }}
                        aria-hidden="true"
                      />
                      <span className={styles.fastIndicator} data-active={fastEnabled && fastSupported} aria-hidden="true">
                        <GaugeIcon size={14} active className="shrink-0" />
                      </span>
                      <span className={styles.effortValue}>
                        {thinking ? formatEffortLabel(thinking) : text("Model settings", "模型设置")}
                      </span>
                    </button>
                  )}
                  <ThinkingEffortPill
                    expanded={thinkingMenuOpen}
                    onToggle={() => {
                      setThinkingMenuOpen((v) => !v);
                      setPlusMenuOpen(false);
                    }}
                    options={thinkingOptions}
                    value={thinking}
                    onChange={setThinking}
                    fastEnabled={fastEnabled && fastSupported}
                    fastSupported={fastSupported}
                    fastHint={fastHint}
                    toggleFast={toggleFast}
                  />
                </div>
              </HoverTip>
            ) : null}
            <ContextBadge sessionId={bound ?? undefined} />
          </div>

    </>
  );
}
