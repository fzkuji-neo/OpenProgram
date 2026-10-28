/**
 * Web slots for plugins.
 *
 * A loaded plugin may declare `client` modules (ES modules served by the
 * worker at /api/plugins/<name>/client/...). Each module's `setup(api)`
 * places React components into named slots with `api.slot(...)`; the page
 * renders `<PluginSlot name=…>` at each of those places. Every placement
 * and the module's own cleanup are undone when the plugin is disabled or
 * its file changes, so a reload swaps the UI without a page refresh.
 *
 * The slot names match CLIENT_SLOTS in openprogram/plugins/inspect.py.
 */
import * as React from "react";
import { create } from "zustand";

import { jsonFetch } from "@/lib/net/fetch-client";
import { waitForOwnerAuthBootstrap } from "@/lib/net/auth/owner-auth-bootstrap";
import { navigate } from "@/lib/nav/navigate";
import { translateText, useTranslation } from "@/lib/i18n";

export const PLUGIN_SLOTS = [
  "sidebar.nav",
  "sidebar.footer",
  "tabstrip.actions",
  "tool.result",
  "plugin.settings",
] as const;

export type PluginSlotName = (typeof PLUGIN_SLOTS)[number];

export interface SlotEntry {
  id: number;
  plugin: string;
  order: number;
  Component: React.ComponentType<Record<string, unknown>>;
}

/** A sidebar row a plugin's manifest declares (`sidebar` key). */
export interface PluginSidebarItem {
  id: string;
  plugin: string;
  label: string;
  label_zh?: string;
  href: string;
}

interface SlotState {
  slots: Partial<Record<PluginSlotName, SlotEntry[]>>;
  sidebarItems: PluginSidebarItem[];
  add: (slot: PluginSlotName, entry: SlotEntry) => void;
  remove: (slot: PluginSlotName, id: number) => void;
}

export const usePluginSlots = create<SlotState>((set) => ({
  slots: {},
  sidebarItems: [],
  add: (slot, entry) => set((state) => ({
    slots: {
      ...state.slots,
      [slot]: [...(state.slots[slot] || []), entry].sort((a, b) => a.order - b.order),
    },
  })),
  remove: (slot, id) => set((state) => ({
    slots: { ...state.slots, [slot]: (state.slots[slot] || []).filter((e) => e.id !== id) },
  })),
}));

export interface PluginClientApi {
  React: typeof React;
  plugin: string;
  slot: (
    name: PluginSlotName,
    Component: React.ComponentType<Record<string, unknown>>,
    options?: { order?: number },
  ) => () => void;
  text: (...variants: string[]) => string;
  useTranslation: typeof useTranslation;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  json: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  navigate: (href: string) => void;
}

type Cleanup = () => void;
interface LoadedModule { plugin: string; cleanups: Cleanup[] }

let nextId = 1;
const loaded = new Map<string, LoadedModule>();
let chain: Promise<void> = Promise.resolve();

function makeApi(plugin: string, cleanups: Cleanup[]): PluginClientApi {
  return {
    React,
    plugin,
    slot(name, Component, options) {
      if (!(PLUGIN_SLOTS as readonly string[]).includes(name)) {
        throw new Error(`unknown slot ${JSON.stringify(name)}; slots: ${PLUGIN_SLOTS.join(", ")}`);
      }
      const id = nextId++;
      usePluginSlots.getState().add(name, { id, plugin, order: options?.order ?? 500, Component });
      let removed = false;
      const remove = () => {
        if (removed) return;
        removed = true;
        usePluginSlots.getState().remove(name, id);
      };
      cleanups.push(remove);
      return remove;
    },
    text: (...variants) => translateText(...variants),
    useTranslation,
    async fetch(path, init) {
      await waitForOwnerAuthBootstrap();
      return fetch(path, init);
    },
    json: (path, init) => jsonFetch(path, init),
    navigate,
  };
}

function unloadModule(url: string) {
  const mod = loaded.get(url);
  if (!mod) return;
  loaded.delete(url);
  for (const cleanup of mod.cleanups.reverse()) {
    try { cleanup(); } catch (e) { console.error(`[plugin ${mod.plugin}] cleanup failed`, e); }
  }
}

async function loadModule(plugin: string, url: string) {
  const cleanups: Cleanup[] = [];
  loaded.set(url, { plugin, cleanups });
  try {
    const mod = await import(/* webpackIgnore: true */ url);
    const setup = mod.default ?? mod.setup;
    if (typeof setup !== "function") throw new Error("the module exports no setup(api)");
    const undo = await setup(makeApi(plugin, cleanups));
    if (typeof undo === "function") cleanups.push(undo);
  } catch (e) {
    console.error(`[plugin ${plugin}] client module ${url} failed`, e);
    unloadModule(url);
  }
}

async function syncSidebar() {
  try {
    const d = await jsonFetch<{ items?: PluginSidebarItem[] }>("/api/plugins/sidebar");
    usePluginSlots.setState({ sidebarItems: d.items || [] });
  } catch { /* keep the rows we have */ }
}

async function sync() {
  void syncSidebar();
  let modules: Array<{ plugin: string; url: string }>;
  try {
    modules = (await jsonFetch<{ modules?: typeof modules }>("/api/plugins/client")).modules || [];
  } catch {
    return;
  }
  const wanted = new Map(modules.map((m) => [m.url, m.plugin]));
  for (const url of [...loaded.keys()]) if (!wanted.has(url)) unloadModule(url);
  for (const [url, plugin] of wanted) if (!loaded.has(url)) await loadModule(plugin, url);
}

/** Bring the page's plugin UI in line with the loaded plugins. */
export function loadPluginClients(): Promise<void> {
  chain = chain.then(sync, sync);
  return chain;
}
