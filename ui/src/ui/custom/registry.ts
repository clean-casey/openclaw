import type { TemplateResult } from "lit";
import type { IconName } from "../icons.js";
import type { AppViewState } from "../app-view-state.ts";

// Custom tabs use a stable prefix so upstream can keep strict types
// while still allowing arbitrary overlay pages without editing unions.
export type CustomTabId = `custom:${string}`;

export type CustomTabSpec = {
  id: CustomTabId;
  title: string;
  subtitle?: string;
  icon?: IconName;
  render: (state: AppViewState) => TemplateResult;
};

const registry = new Map<CustomTabId, CustomTabSpec>();

export function registerCustomTab(spec: CustomTabSpec) {
  registry.set(spec.id, spec);
}

export function getCustomTab(id: string): CustomTabSpec | null {
  if (!isCustomTabId(id)) {
    return null;
  }
  return registry.get(id) ?? null;
}

export function listCustomTabs(): CustomTabSpec[] {
  return Array.from(registry.values());
}

export function isCustomTabId(value: string): value is CustomTabId {
  return value.startsWith("custom:");
}

export function customSlugFromTabId(tab: CustomTabId): string {
  return tab.slice("custom:".length);
}

export function customTabIdFromSlug(slug: string): CustomTabId {
  return `custom:${slug}`;
}

