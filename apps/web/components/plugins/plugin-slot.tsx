"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { usePluginSlots, type PluginSlotName, type SlotEntry } from "@/lib/plugins/slots";

/** One plugin component that throws hides itself, not the page around it. */
class SlotBoundary extends Component<{ plugin: string; slot: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[plugin ${this.props.plugin}] ${this.props.slot} component failed`, error, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const EMPTY: SlotEntry[] = [];

export function usePluginSlotEntries(name: PluginSlotName, plugin?: string): SlotEntry[] {
  const entries = usePluginSlots((state) => state.slots[name] ?? EMPTY);
  return plugin ? entries.filter((entry) => entry.plugin === plugin) : entries;
}

/**
 * Where plugins' client components render. Nothing is drawn while no
 * plugin uses the slot. `plugin` limits it to one plugin's components
 * (the plugin.settings slot inside that plugin's detail).
 */
export function PluginSlot({
  name,
  props,
  plugin,
  wrap,
}: {
  name: PluginSlotName;
  props?: Record<string, unknown>;
  plugin?: string;
  wrap?: (children: ReactNode) => ReactNode;
}) {
  const entries = usePluginSlotEntries(name, plugin);
  if (entries.length === 0) return null;
  const children = entries.map(({ id, plugin: owner, Component: Entry }) => (
    <SlotBoundary key={id} plugin={owner} slot={name}>
      <Entry {...(props || {})} />
    </SlotBoundary>
  ));
  return <>{wrap ? wrap(children) : children}</>;
}
