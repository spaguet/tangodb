import type { DemoPanel } from "../crm/CrmDemoApp";

export type SettingsSection = "general" | "organization" | "subscriptions" | "disciplines" | "locations" | "data" | "license";

export type DemoDeepLinkTarget = {
  panel: DemoPanel;
  settingsSection?: SettingsSection;
};

const PANEL_ALIASES: Record<string, DemoPanel> = {
  settings: "settings",
  team: "team",
};

const SETTINGS_SECTIONS = new Set<SettingsSection>([
  "general",
  "organization",
  "subscriptions",
  "disciplines",
  "locations",
  "data",
  "license",
]);

/** Parse `#demo`, `#demo/settings`, `#demo/settings/organization`, `#demo/team`. */
export function parseDemoDeepLink(hash: string): DemoDeepLinkTarget | null {
  const normalized = hash.replace(/^#/, "");
  if (normalized === "demo") return { panel: "dashboard" };

  const match = normalized.match(/^demo\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;

  const panel = PANEL_ALIASES[match[1]];
  if (!panel) return null;

  if (panel === "settings" && match[2]) {
    const section = match[2] as SettingsSection;
    if (!SETTINGS_SECTIONS.has(section)) return { panel };
    return { panel, settingsSection: section };
  }

  return { panel };
}

export function demoDeepLinkHref(target: DemoDeepLinkTarget): string {
  if (target.panel === "settings" && target.settingsSection) {
    return `#demo/settings/${target.settingsSection}`;
  }
  if (target.panel === "dashboard") return "#demo";
  return `#demo/${target.panel}`;
}

export function scrollToDemoSection(behavior: ScrollBehavior = "smooth") {
  document.getElementById("demo")?.scrollIntoView({ behavior, block: "start" });
}
