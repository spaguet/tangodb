import type { OrgModules } from "../types/organization";
import { isModuleEnabled, normalizeOrgModules } from "./orgModules";
import type { PanelId, SettingsSectionId } from "./permissions";

export type ProductEdition = "lite" | "studio" | "pro";

export type EditionCapability =
  | "schedule"
  | "attendance"
  | "clients"
  | "group_subscriptions"
  | "personal_lessons"
  | "prices"
  | "single_visits"
  | "multi_location"
  | "multi_discipline"
  | "finance"
  | "payroll"
  | "hall_rent"
  | "google_calendar"
  | "calendar_events"
  | "export_operational"
  | "export_financial"
  | "offline_attendance";

export const EDITION_RANK: Record<ProductEdition, number> = {
  lite: 1,
  studio: 2,
  pro: 3,
};

const PRO_ONLY_CAPABILITIES = new Set<EditionCapability>([
  "finance",
  "payroll",
  "hall_rent",
  "google_calendar",
  "calendar_events",
  "export_financial",
  "offline_attendance",
]);

const STUDIO_PLUS_CAPABILITIES = new Set<EditionCapability>([
  "group_subscriptions",
  "personal_lessons",
  "prices",
  "single_visits",
  "export_operational",
]);

export interface OrgEditionLiveInstrument {
  instrument: string;
  edition: string;
  status: string;
  phase: string;
  period_end: string | null;
}

export interface OrgEditionCaps {
  locations: number;
  disciplines: number;
  clients_active: number;
  members: number;
  pending_invites: number;
}

export interface OrgEditionSnapshot {
  organizationId: string;
  activeEdition: ProductEdition;
  effectiveCeiling: ProductEdition;
  persistedActiveEdition: ProductEdition;
  liveMonthPhase: string | null;
  liveInstruments: OrgEditionLiveInstrument[];
  caps: OrgEditionCaps;
  lifecycleEnabled: boolean;
}

export function parseProductEdition(raw: string | null | undefined): ProductEdition {
  if (raw === "studio" || raw === "pro") return raw;
  return "lite";
}

export function catalogEditionAllows(
  edition: ProductEdition,
  capability: EditionCapability
): boolean {
  switch (capability) {
    case "schedule":
    case "attendance":
    case "clients":
    case "multi_location":
    case "multi_discipline":
      return true;
    default:
      break;
  }
  if (PRO_ONLY_CAPABILITIES.has(capability)) return edition === "pro";
  if (STUDIO_PLUS_CAPABILITIES.has(capability)) {
    return edition === "studio" || edition === "pro";
  }
  return false;
}

/** Mirrors SQL `edition_allows` when `editions_lifecycle` is on. */
export function editionAllows(
  snapshot: OrgEditionSnapshot | null | undefined,
  capability: EditionCapability
): boolean {
  if (!snapshot?.lifecycleEnabled) return true;
  return catalogEditionAllows(snapshot.activeEdition, capability);
}

export function requiredEditionForCapability(
  capability: EditionCapability
): ProductEdition {
  if (PRO_ONLY_CAPABILITIES.has(capability)) return "pro";
  if (STUDIO_PLUS_CAPABILITIES.has(capability)) return "studio";
  return "lite";
}

export function capabilityForPanel(panel: PanelId): EditionCapability | null {
  switch (panel) {
    case "finance":
      return "finance";
    case "renters":
      return "hall_rent";
    case "prices":
      return "prices";
    case "subscriptions":
    case "subscriptions_sell":
      return "group_subscriptions";
    case "personal":
    case "personal_sell":
      return "personal_lessons";
    default:
      return null;
  }
}

export function capabilityForSettingsSection(section: SettingsSectionId): EditionCapability | null {
  switch (section) {
    case "hall-rent":
      return "hall_rent";
    case "integrations":
      return "google_calendar";
    case "subscriptions":
      return "group_subscriptions";
    case "data":
      return "export_operational";
    default:
      return null;
  }
}

export function capabilityForPath(pathname: string, search = ""): EditionCapability | null {
  if (pathname.startsWith("/finance/payroll")) return "payroll";
  if (
    pathname.startsWith("/finance/rental-inbox") ||
    pathname.startsWith("/finance/rental-accruals")
  ) {
    return "hall_rent";
  }
  if (pathname.startsWith("/finance")) return "finance";
  if (pathname.startsWith("/renters")) return "hall_rent";
  if (pathname.startsWith("/subscriptions")) return "group_subscriptions";
  if (pathname.startsWith("/personal")) return "personal_lessons";
  if (pathname === "/prices" || pathname.startsWith("/prices/")) {
    const section = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
      "section"
    );
    if (section === "hall-rent") return "hall_rent";
    return "prices";
  }
  const settingsMatch = pathname.match(/^\/settings\/([^/]+)/);
  if (settingsMatch) {
    return capabilityForSettingsSection(settingsMatch[1] as SettingsSectionId);
  }
  return null;
}

export function panelAllowedByEdition(
  panel: PanelId,
  snapshot: OrgEditionSnapshot | null | undefined
): boolean {
  const cap = capabilityForPanel(panel);
  if (!cap) return true;
  return editionAllows(snapshot, cap);
}

export function pathAllowedByEdition(
  pathname: string,
  search: string,
  snapshot: OrgEditionSnapshot | null | undefined
): boolean {
  const cap = capabilityForPath(pathname, search);
  if (!cap) return true;
  return editionAllows(snapshot, cap);
}

export function financeSubpathAllowedByEdition(
  pathname: string,
  snapshot: OrgEditionSnapshot | null | undefined
): boolean {
  if (pathname.startsWith("/finance/payroll")) {
    return editionAllows(snapshot, "payroll");
  }
  if (
    pathname.startsWith("/finance/rental-inbox") ||
    pathname.startsWith("/finance/rental-accruals")
  ) {
    return editionAllows(snapshot, "hall_rent");
  }
  if (pathname.startsWith("/finance")) {
    return editionAllows(snapshot, "finance");
  }
  return true;
}

/** Nav visibility: edition ∩ JSONB module (owner toggle). */
export function editionAndModuleAllow(
  snapshot: OrgEditionSnapshot | null | undefined,
  modules: OrgModules,
  capability: EditionCapability | null,
  moduleKey: keyof OrgModules | null
): boolean {
  if (moduleKey && !isModuleEnabled(modules, moduleKey)) return false;
  if (!capability) return true;
  return editionAllows(snapshot, capability);
}

export function mergeEditionModules(
  snapshot: OrgEditionSnapshot | null | undefined,
  rawModules: Partial<OrgModules> | null | undefined
): OrgModules {
  return normalizeOrgModules(rawModules);
}

export function parseOrgEditionRpc(
  payload: unknown,
  lifecycleEnabled: boolean
): OrgEditionSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const orgId = row.organization_id;
  if (typeof orgId !== "string") return null;

  const capsRaw = (row.caps as Record<string, unknown> | undefined) ?? {};
  const instrumentsRaw = Array.isArray(row.live_instruments) ? row.live_instruments : [];

  return {
    organizationId: orgId,
    activeEdition: parseProductEdition(row.active_edition as string),
    effectiveCeiling: parseProductEdition(row.effective_ceiling as string),
    persistedActiveEdition: parseProductEdition(row.persisted_active_edition as string),
    liveMonthPhase: (row.live_month_phase as string | null) ?? null,
    liveInstruments: instrumentsRaw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        instrument: String(item.instrument ?? ""),
        edition: String(item.edition ?? ""),
        status: String(item.status ?? ""),
        phase: String(item.phase ?? ""),
        period_end: (item.period_end as string | null) ?? null,
      })),
    caps: {
      locations: Number(capsRaw.locations ?? 0),
      disciplines: Number(capsRaw.disciplines ?? 0),
      clients_active: Number(capsRaw.clients_active ?? 0),
      members: Number(capsRaw.members ?? 0),
      pending_invites: Number(capsRaw.pending_invites ?? 0),
    },
    lifecycleEnabled,
  };
}

export function liveProMonthlyInstrument(
  snapshot: OrgEditionSnapshot | null | undefined
): OrgEditionLiveInstrument | null {
  if (!snapshot) return null;
  return (
    snapshot.liveInstruments.find(
      (row) =>
        row.instrument === "pro_monthly" &&
        (row.phase === "active" || row.phase === "past_due")
    ) ?? null
  );
}

export function liveStudioMonthlyInstrument(
  snapshot: OrgEditionSnapshot | null | undefined
): OrgEditionLiveInstrument | null {
  if (!snapshot) return null;
  return (
    snapshot.liveInstruments.find(
      (row) =>
        row.instrument === "studio_monthly" &&
        (row.phase === "active" || row.phase === "past_due")
    ) ?? null
  );
}

export function renewalPurchasePath(snapshot: OrgEditionSnapshot | null | undefined): string {
  const studio = liveStudioMonthlyInstrument(snapshot);
  const pro = liveProMonthlyInstrument(snapshot);
  if (studio && !pro) {
    return "/settings/license?purchase=1&plan=studio";
  }
  return "/settings/license?purchase=1&plan=monthly";
}

export function purchaseSkuLockForEdition(
  snapshot: OrgEditionSnapshot | null | undefined
): "choice" | "studio_month" | "pro_month" | null {
  if (!snapshot?.lifecycleEnabled) return null;
  const pro = liveProMonthlyInstrument(snapshot);
  const studio = liveStudioMonthlyInstrument(snapshot);
  if (pro) return "pro_month";
  if (studio) return "studio_month";
  return "choice";
}
