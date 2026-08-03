import type { OrgModules } from "../types/organization";
import type { PriceTariffRef } from "./utils";

export const DEFAULT_ORG_MODULES: OrgModules = {
  group_subscriptions: true,
  personal_lessons: true,
  pair_subscriptions: true,
  trio_lessons: true,
  multi_discipline: true,
  locations: true,
  finance_basic: true,
};

export function normalizeOrgModules(raw: Partial<OrgModules> | null | undefined): OrgModules {
  const merged = { ...DEFAULT_ORG_MODULES, ...(raw ?? {}) };
  return {
    ...merged,
    finance_basic: raw?.finance_basic ?? true,
  };
}

export function isModuleEnabled(modules: OrgModules, key: keyof OrgModules): boolean {
  return modules[key];
}

export type OrgModuleGroupId = "crm_sections" | "lesson_formats" | "infrastructure";

export interface OrgModuleGroup {
  id: OrgModuleGroupId;
  keys: (keyof OrgModules)[];
}

/** Grouped module toggles for settings / onboarding (Этап 3). */
export const ORG_MODULE_GROUPS: OrgModuleGroup[] = [
  {
    id: "crm_sections",
    keys: ["group_subscriptions", "personal_lessons", "finance_basic"],
  },
  {
    id: "lesson_formats",
    keys: ["pair_subscriptions", "trio_lessons"],
  },
  {
    id: "infrastructure",
    keys: ["multi_discipline", "locations"],
  },
];

/** Show location picker in forms when module is on and org has more than one location. */
export function shouldShowLocationPicker(modules: OrgModules, locationCount: number): boolean {
  return isModuleEnabled(modules, "locations") && locationCount > 1;
}

/** Show discipline picker in forms when module is on and org has more than one discipline. */
export function shouldShowDisciplinePicker(modules: OrgModules, disciplineCount: number): boolean {
  return isModuleEnabled(modules, "multi_discipline") && disciplineCount > 1;
}

export type ModuleGatedPanel =
  | "finance"
  | "subscriptions"
  | "subscriptions_sell"
  | "personal"
  | "personal_sell";

export function moduleKeyFromPanel(panel: string): keyof OrgModules | null {
  switch (panel) {
    case "finance":
      return "finance_basic";
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

export type ModuleGatedSettingsSection = "disciplines" | "locations";

export function moduleKeyFromSettingsSection(section: string): keyof OrgModules | null {
  switch (section) {
    case "disciplines":
      return "multi_discipline";
    case "locations":
      return "locations";
    default:
      return null;
  }
}

export type GroupParticipantFormat = "solo" | "pair" | "monthly_unlimited";
export type PrivatePackageFormat = "solo" | "pair" | "trio";

export function isGroupPairPriceType(type: string): boolean {
  const t = type.trim();
  return t === "pair_hm" || t.startsWith("pair_m");
}

export function isLegacyPairCycleTariff(type: string): boolean {
  const t = type.trim();
  return t === "pair_m2" || t === "pair_m3";
}

export function filterGroupTariffsByModules<T extends PriceTariffRef>(
  tariffs: T[],
  modules: OrgModules = DEFAULT_ORG_MODULES
): T[] {
  return tariffs.filter((p) => {
    if (isLegacyPairCycleTariff(p.type)) return false;
    if (!modules.pair_subscriptions && isGroupPairPriceType(p.type)) return false;
    return true;
  });
}

export function filterPrivatePackageTariffsByModules<T extends PriceTariffRef>(
  tariffs: T[],
  modules: OrgModules = DEFAULT_ORG_MODULES
): T[] {
  return tariffs.filter((p) => {
    const t = p.type.trim();
    if (!modules.pair_subscriptions && t === "personal_pair") return false;
    if (!modules.trio_lessons && t === "personal_trio") return false;
    return true;
  });
}

export function resolveGroupPriceType(
  participant: GroupParticipantFormat,
  lessons: number
): { ok: true; type: string; billingModel: "lesson_count" | "monthly_unlimited" } | { ok: false; error: string } {
  if (participant === "monthly_unlimited") {
    return { ok: true, type: "monthly_unlimited", billingModel: "monthly_unlimited" };
  }
  if (participant === "solo") return { ok: true, type: "solo", billingModel: "lesson_count" };
  if (participant === "pair") {
    if (lessons === 8) return { ok: true, type: "pair_m1", billingModel: "lesson_count" };
    if (lessons >= 1) return { ok: true, type: "pair_hm", billingModel: "lesson_count" };
    return { ok: false, error: "Парный абонемент: укажите количество уроков." };
  }
  return { ok: false, error: "Неизвестный формат тарифа." };
}

export function resolvePrivatePackagePriceType(format: PrivatePackageFormat): string {
  return `personal_${format}`;
}
