/** Primary settings sections on narrow viewports (rest under «Ещё»). */
export const SETTINGS_PRIMARY_SECTION_IDS = [
  "general",
  "organization",
  "subscriptions",
  "disciplines",
  "locations",
] as const;

export function isSettingsPrimarySection(id: string): boolean {
  return (SETTINGS_PRIMARY_SECTION_IDS as readonly string[]).includes(id);
}

export function activeSettingsNavPath(pathname: string): string {
  if (!pathname.startsWith("/settings")) return "/settings/general";
  const segment = pathname.replace(/^\/settings\/?/, "").split("/")[0];
  if (!segment || segment === "team") return "/settings/general";
  return `/settings/${segment}`;
}
