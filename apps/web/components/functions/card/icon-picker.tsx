"use client";

import { useRef } from "react";
import styles from "./icon-picker.module.css";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type AnimatedNavIconHandle,
  AtomIcon,
  BotIcon,
  BoxIcon,
  ChartColumnIncreasingIcon,
  CompassIcon,
  CpuIcon,
  EarthIcon,
  EyeIcon,
  FeatherIcon,
  FingerprintIcon,
  FlameIcon,
  GaugeIcon,
  HammerIcon,
  KeyIcon,
  LanguagesIcon,
  MicIcon,
  PenToolIcon,
  RocketIcon,
  RouteIcon,
  SatelliteDishIcon,
  ScanTextIcon,
  ShieldCheckIcon,
  TelescopeIcon,
  TimerIcon,
} from "@/components/animated-icons";

/** The flat animated line icons (pqoqubbw set) a function card can
 *  use. programs-meta stores the slug key. Deliberately DISJOINT from
 *  the glyphs the UI chrome already uses (sidebar nav, composer,
 *  cards) so a function icon never doubles as an interface control. */
export const FUNCTION_ICONS = {
  box: BoxIcon,
  bot: BotIcon,
  cpu: CpuIcon,
  atom: AtomIcon,
  compass: CompassIcon,
  telescope: TelescopeIcon,
  earth: EarthIcon,
  "satellite-dish": SatelliteDishIcon,
  eye: EyeIcon,
  "scan-text": ScanTextIcon,
  languages: LanguagesIcon,
  feather: FeatherIcon,
  "pen-tool": PenToolIcon,
  hammer: HammerIcon,
  key: KeyIcon,
  fingerprint: FingerprintIcon,
  "shield-check": ShieldCheckIcon,
  gauge: GaugeIcon,
  timer: TimerIcon,
  route: RouteIcon,
  mic: MicIcon,
  "chart-column": ChartColumnIncreasingIcon,
  flame: FlameIcon,
  rocket: RocketIcon,
} as const;

export type FunctionIconSlug = keyof typeof FUNCTION_ICONS;

export const DEFAULT_ICON: FunctionIconSlug = "box";

/** Resolve whatever programs-meta holds to a valid slug. The backend
 *  rewrites pre-flat-icon emoji values to slugs on read, so anything
 *  unrecognised here is genuinely unset. */
export function normalizeIcon(value: string | undefined | null): FunctionIconSlug {
  if (!value) return DEFAULT_ICON;
  if (value in FUNCTION_ICONS) return value as FunctionIconSlug;
  return DEFAULT_ICON;
}

export function IconPicker({
  name,
  current,
  onPick,
  onClose,
}: {
  name: string;
  current: string;
  onPick: (icon: string | null) => void;
  onClose: () => void;
}) {
  const { text } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className={styles.title}>
            {text("Pick an icon for", "为以下函数选择图标")} <code>{name}</code>
          </DialogTitle>
        </DialogHeader>
        <div className={styles.grid}>
          {(Object.keys(FUNCTION_ICONS) as FunctionIconSlug[]).map((slug) => (
            <IconCell
              key={slug}
              slug={slug}
              active={slug === current}
              onPick={() => onPick(slug)}
            />
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onPick(null)}>
            {text("Reset to default", "恢复默认")}
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="outline">{text("Close", "关闭")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One picker cell — the button's hover drives the icon animation
 *  (controlled-ref pattern, same as everywhere else in the app). */
function IconCell({
  slug,
  active,
  onPick,
}: {
  slug: FunctionIconSlug;
  active: boolean;
  onPick: () => void;
}) {
  const iconRef = useRef<AnimatedNavIconHandle>(null);
  const Icon = FUNCTION_ICONS[slug];
  return (
    <button
      type="button"
      className={active ? `${styles.btn} ${styles.btnActive}` : styles.btn}
      onClick={onPick}
      onMouseEnter={() => iconRef.current?.startAnimation?.()}
      onMouseLeave={() => iconRef.current?.stopAnimation?.()}
    >
      <Icon ref={iconRef} size={20} />
    </button>
  );
}
