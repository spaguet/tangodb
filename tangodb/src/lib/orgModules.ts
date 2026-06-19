import type { OrgModules } from "../types/organization";
import { PRESET_MODULES } from "../types/organization";
import type { PriceTariffRef } from "./utils";

export const DEFAULT_ORG_MODULES: OrgModules = PRESET_MODULES.dance_school;

export type GroupParticipantFormat = "solo" | "pair";
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
): { ok: true; type: string } | { ok: false; error: string } {
  if (participant === "solo") return { ok: true, type: "solo" };
  if (lessons === 4) return { ok: true, type: "pair_hm" };
  if (lessons === 8) return { ok: true, type: "pair_m1" };
  return { ok: false, error: "Парный абонемент: укажите 4 или 8 уроков." };
}

export function resolvePrivatePackagePriceType(format: PrivatePackageFormat): string {
  return `personal_${format}`;
}
