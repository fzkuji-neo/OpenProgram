/**
 * Effort pill — the trigger IS the picker.
 *
 * Collapsed: a 32px round chip showing just the dumbbell icon, tinted by
 * the current effort level. Hovering slides out a right-caret (the same
 * gesture as the neighbouring tool chips' ×). CLICK to expand — hover
 * alone never opens the card.
 *
 * Expanded: a floating card ABOVE the trigger wearing the same frame as
 * every other popup (lib/glass.ts GLASS_SURFACE: glass surface, 10px
 * radius, hairline, glass shadow) with 10px padding. Top to bottom:
 *   1. header — muted "Effort", the current level in `--accent-purple`,
 *      then right-aligned the Fast gauge toggle and a (?) HoverTip that
 *      explains what effort does;
 *   2. "Faster" / "Smarter" end labels;
 *   3. the track — a 4-row dot matrix (`lib/effort-matrix.ts`, drawn by
 *      <EffortDotMatrix/>) in which every dot grows and brightens towards
 *      the right, grey behind the thumb and lavender ahead of it. It sits
 *      under the Radix slider, whose own track / range / ticks
 *      effort-pill.css paints transparent, so clicking, dragging and the
 *      arrow keys still move between options exactly as before. The thumb
 *      is a 16×20 rounded chip; resting the pointer on it, dragging it or
 *      keyboard-focusing it shows the level name in a small tip above it.
 *      At `max` the UltraRain canvas still floods the passed side of the
 *      track (the Ultracode form);
 *   4. a muted "Recommended" caption under the option the backend marks
 *      as the model's default (`ThinkingOption.recommended`).
 * Stays open until the user clicks OUTSIDE the card (same dwell behaviour
 * as every other popover) — mouse-leave never collapses it; that
 * outside-click close is owned by composer/index.
 *
 * Layout: the pill is wrapped in a ``position: relative`` host. The
 * shell is absolute so neither state resizes the row. Collapsed widths
 * (32 / 48 hover) and the expanded card geometry live in effort-pill.css
 * on `.effort-pill-shell`.
 *
 * Extracted from composer/index.tsx to keep that file under the
 * project's no-1000-line-files rule.
 */
"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

import { Slider } from "@/components/ui/slider";
import { UltraRain } from "./ultra-rain";
import { EffortDotMatrix } from "./effort-dot-matrix";
import type { ThinkingOption } from "./use-thinking-effort";
import { HoverTip, TipBody } from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n";
import { effortLevelColor, formatEffortLabel } from "@/lib/effort-color";
import { GLASS_SURFACE } from "@/lib/glass";
import { captionAlignment, THUMB_WIDTH, thumbCenterX } from "@/lib/effort-matrix";
import { type AnimatedNavIconHandle, GaugeIcon } from "@/components/animated-icons";
import { SolarIcon } from "@/components/solar-icons";

// Extends div attributes so a tooltip trigger (HoverTip / Radix
// `asChild`) can inject its hover/focus handlers — they must reach the
// host DOM node or the tip never opens.
interface ThinkingEffortPillProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "onToggle"> {
  expanded: boolean;
  onToggle: () => void;
  options: ThinkingOption[];
  value: string;
  onChange: (v: string) => void;
  fastEnabled: boolean;
  fastSupported: boolean;
  fastHint: string;
  toggleFast: () => void;
}

export const ThinkingEffortPill = React.forwardRef<
  HTMLDivElement,
  ThinkingEffortPillProps
>(function ThinkingEffortPill(
  { expanded, onToggle, options, value, onChange, ...rest },
  ref,
) {
  return (
    <ThinkingEffortSliderPill
      ref={ref}
      expanded={expanded}
      onToggle={onToggle}
      options={options}
      value={value}
      onChange={onChange}
      {...rest}
    />
  );
});

const ThinkingEffortSliderPill = React.forwardRef<
  HTMLDivElement,
  ThinkingEffortPillProps
>(function ThinkingEffortSliderPill(
  {
    options,
    value,
    onChange,
    onMouseEnter,
    onMouseLeave,
    expanded,
    onToggle,
    fastEnabled,
    fastSupported,
    fastHint,
    toggleFast,
    ...rest
  },
  ref,
) {
  const { text } = useTranslation();
  const valueIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const maxIndex = Math.max(0, options.length - 1);
  const recommendedIndex = options.findIndex((o) => o.recommended);
  // Warm hue per effort level, interpolated continuously so EVERY level
  // gets its own colour: hsl hue runs 48° (yellow, lowest) → 0° (red,
  // highest) across the non-off stops, with saturation/lightness easing
  // up alongside. Endpoints match the old fixed palette (#fbbf24 …
  // #ff5c5c). NOT the project `--accent-*` tokens — those are muted /
  // earthy and looked drab in the slider. `off` keeps neutral
  // bright-white. Everything below derives from this single hue so the
  // collapsed tint / range / glyph all agree.
  const warmHue = effortLevelColor(options, value);

  // Effort-level tint for the COLLAPSED pill — `warmHue` at low
  // opacity so it sits softly on the panel surface. `off` is special:
  // a neutral grey chip with no hue. It uses the solid theme-aware
  // `--effort-off-bg` token (dark #535350 / light #e8e6dc) — a flat
  // colour, no transparency.
  const collapsedTint =
    value === "off"
      ? "var(--effort-off-bg)"
      : `color-mix(in srgb, ${warmHue} 16%, transparent)`;

  // Active hue for the slider's focus ring — `warmHue` at ~70% so it
  // still reads as a soft fill. Passed down via the `--slider-active`
  // CSS custom property (the track itself is the dot matrix now).
  const activeColor = `color-mix(in srgb, ${warmHue} 72%, transparent)`;

  // Fully-opaque variant for the effort icon. It stays visually
  // distinct from the half-alpha `--slider-active` track color.
  const activeColorSolid = warmHue;

  // The collapsed chip's icons are pqoqubbw animated icons, driven from
  // the pill host's hover — same controlled-ref pattern as the sidebar
  // nav rows.
  const effortIconChipRef = useRef<AnimatedNavIconHandle>(null);
  const caretRef = useRef<AnimatedNavIconHandle>(null);

  // Level-name tip over the thumb. Visible while the pointer rests on the
  // thumb or a drag is in flight — the drag flag is what keeps it steady
  // when the thumb snaps between options under a moving pointer. Keyboard
  // focus shows it through CSS (`:focus-visible`) instead, so no state is
  // needed for that path. Hover is computed from the Radix root's pointer
  // events against the thumb's box: the thumb child itself stays
  // pointer-events:none so Radix keeps focusing its thumb on press.
  const thumbRef = useRef<HTMLSpanElement>(null);
  const thumbHoverRef = useRef(false);
  const [thumbHover, setThumbHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragEndRef = useRef<(() => void) | null>(null);

  // The dot matrix is laid out from the track's measured width. The card
  // can be clamped by the composer-row container query, so a
  // ResizeObserver keeps the measurement current while the card is open.
  // Closing the card also drops any hover state the pointer left behind.
  const hasTrack = expanded && options.length > 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) {
      thumbHoverRef.current = false;
      setThumbHover(false);
      return;
    }
    const measure = () => setTrackWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasTrack]);

  const updateThumbHover = (clientX: number) => {
    const rect = thumbRef.current?.getBoundingClientRect();
    const inside = !!rect && clientX >= rect.left && clientX <= rect.right;
    if (inside !== thumbHoverRef.current) {
      thumbHoverRef.current = inside;
      setThumbHover(inside);
    }
  };
  const startDrag = () => {
    dragEndRef.current?.();
    const end = () => {
      dragEndRef.current = null;
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setDragging(false);
    };
    dragEndRef.current = end;
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    setDragging(true);
  };
  useEffect(() => () => dragEndRef.current?.(), []);

  return (
    <div
      ref={ref}
      {...rest}
      className="effort-pill-host relative inline-flex h-[32px] items-center"
      data-effort-expanded={expanded ? "true" : undefined}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        effortIconChipRef.current?.startAnimation?.();
        caretRef.current?.startAnimation?.();
      }}
      onMouseLeave={(e) => {
        onMouseLeave?.(e);
        // 鼠标移开不再收起卡片——和其它弹层一致，只有点击卡片外部才关
        // （outside-click 由 composer 的 pointerdown 侦听负责）。这里只
        // 停掉折叠 chip 的图标 / caret 悬停动画。
        effortIconChipRef.current?.stopAnimation?.();
        caretRef.current?.stopAnimation?.();
      }}
    >
      {/* Shell. Collapsed = the 32px round chip (48px on hover — widths
          in chat.css). Expanded = repositioned by chat.css into a
          floating layer above the trigger; the visible surface is the
          .effort-card inside. */}
      <div
        data-expanded={expanded ? "true" : undefined}
        className={[
          "effort-pill-shell absolute select-none",
          expanded
            ? "" // floating-card geometry comes from chat.css
            : "left-0 top-0 h-[32px] overflow-hidden rounded-full text-[14px] text-text-primary transition-[width,background-color] duration-[220ms] ease-out",
        ].join(" ")}
        style={{
          // Tint the collapsed pill by current effort level (neutral
          // white-grey at `off`, ramps to soft red at `xhigh`). The
          // expanded card paints its own popover surface instead.
          ...(expanded ? {} : { backgroundColor: collapsedTint }),
          // CSS variables inherited by the slider inside:
          //   --slider-active        →  focus ring (soft, ~70% alpha)
          //   --slider-active-solid  →  collapsed chip glyph
          //                              (opaque, full-strength hue)
          ["--slider-active" as string]: activeColor,
          ["--slider-active-solid" as string]: activeColorSolid,
        } as React.CSSProperties}
      >
        <div
          className={[
            "effort-pill-collapsed h-full flex items-center px-[7px] cursor-pointer",
            expanded ? "hidden" : "",
          ].join(" ")}
          onClick={onToggle}
        >
          <SolarIcon
            name="dumbbell-large-minimalistic"
            ref={effortIconChipRef}
            size={18}
            className="effort-pill-compact-icon text-[var(--slider-active-solid)]"
            aria-hidden="true"
          />
          <span className="effort-pill-caret text-[var(--slider-active-solid)]">
            <SolarIcon ref={caretRef} name="alt-arrow-right" size={12} motionPreset="nudge" />
          </span>
        </div>
        {expanded && (
          /* 卡片内容自上而下：标题行（muted 维度 + 紫色当前档 + Fast 仪表
             + ? 帮助）、Faster/Smarter 两端标签、点阵滑轨、"推荐"标注。
             画框 = GLASS_SURFACE，与所有弹层同一画框。
             标题 13px；标题→标签 10、标签→轨 10、轨→标注 6。 */
          <div
            className={`effort-card ${value === "max" ? "effort-ultra" : ""} ${GLASS_SURFACE} p-[10px]`}
          >
            <div className="flex items-center gap-[6px] text-[13px] leading-[18px]">
              <span className="text-text-muted">{text("Effort", "思考力度")}</span>
              <span className="font-medium text-[var(--accent-purple)]">
                {formatEffortLabel(value)}
              </span>
              <HoverTip label={fastHint}>
                <button type="button"
                  className="effort-fast-toggle ml-auto"
                  style={{ background: "transparent", border: "none", color: fastEnabled ? "var(--accent-red)" : undefined }}
                  aria-label={text("Fast mode", "高速模式")}
                  title={fastHint} aria-description={fastHint}
                  aria-pressed={fastEnabled} aria-disabled={!fastSupported}
                  onClick={(e) => { e.stopPropagation(); if (fastSupported) toggleFast(); }}>
                  <GaugeIcon size={16} active={fastEnabled} />
                </button>
              </HoverTip>
              <HoverTip
                label={
                  <TipBody
                    title={text("Thinking effort", "思考力度")}
                    detail={text(
                      "How long the model reasons before it answers. Higher levels think longer and use more tokens; lower levels answer faster. Recommended marks this model's default.",
                      "模型回答前推理多久。档位越高思考越久、消耗越多 token；越低回答越快。“推荐”标出该模型的默认档位。",
                    )}
                  />
                }
              >
                <button
                  type="button"
                  className="effort-help"
                  aria-label={text("About thinking effort", "关于思考力度")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <CircleHelp size={14} aria-hidden="true" />
                </button>
              </HoverTip>
            </div>
            {options.length > 1 && <>
            <div className="mt-[10px] flex items-center justify-between text-[12px] leading-[15px] text-text-muted">
              <span>{text("Faster", "更快")}</span>
              <span>{text("Smarter", "更强")}</span>
            </div>
            <div ref={trackRef} className="effort-track relative mt-[10px] h-[20px]">
              <EffortDotMatrix
                width={trackWidth}
                thumbX={thumbCenterX(valueIndex, options.length, trackWidth)}
              />
              <Slider
                min={0}
                max={maxIndex}
                step={1}
                stops={options.length}
                value={[valueIndex]}
                data-thumb-tip={thumbHover || dragging ? "true" : undefined}
                // 最高档：滑过区叠紫色像素矩阵动画（入场辐射 + 逐格随机
                // 闪烁）。canvas 每次进入 max 时重新挂载 → 重播入场。
                rangeChildren={value === "max" ? <UltraRain key="ultra" /> : null}
                onValueChange={(v) => {
                  const idx = v[0] ?? 0;
                  const next = options[idx];
                  if (next) onChange(next.value);
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerMove={(e) => updateThumbHover(e.clientX)}
                onPointerLeave={() => updateThumbHover(Number.NaN)}
                onPointerDown={(e) => {
                  updateThumbHover(e.clientX);
                  startDrag();
                }}
                thumb={
                  // Theme-aware chip, same height as the track. White on
                  // light, raised paper on dark — not a raw #fff block. The
                  // tip inside names the level; effort-pill.css shows it on
                  // hover / drag / keyboard focus.
                  <span
                    ref={thumbRef}
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 h-[20px] w-[16px] -translate-x-1/2 -translate-y-1/2 rounded-[6px] bg-[var(--effort-thumb)] pointer-events-none shadow-[var(--shadow-sm)]"
                  >
                    <span className="effort-thumb-tip">{formatEffortLabel(value)}</span>
                  </span>
                }
              />
            </div>
            {recommendedIndex >= 0 && (
              <div className="relative mt-[6px] h-[15px] text-[12px] leading-[15px] text-text-muted">
                <span
                  className="effort-recommended"
                  data-align={captionAlignment(recommendedIndex, options.length)}
                  style={
                    captionAlignment(recommendedIndex, options.length) === "center"
                      ? { left: `calc(${recommendedIndex / maxIndex} * (100% - ${THUMB_WIDTH}px) + ${THUMB_WIDTH / 2}px)` }
                      : undefined
                  }
                >
                  {text("Recommended", "推荐")}
                </span>
              </div>
            )}
            </>}
          </div>
        )}
      </div>
    </div>
  );
});
