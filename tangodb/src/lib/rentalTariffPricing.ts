import type { RentalTariff, RentalTariffStatus } from "../types";

export type RentalTariffStatusFilter = "active" | "archived" | "all";

export function resolveTariffStatusQueryFilter(filter: RentalTariffStatusFilter): RentalTariffStatus | null {
  return filter === "all" ? null : filter;
}

export interface TariffLocationGroup {
  locationKey: string | null;
  tariffs: RentalTariff[];
}

/** Group tariffs for settings list: org-wide first, then by location name. */
export function groupTariffsByLocation(
  tariffs: RentalTariff[],
  locationNameById: Map<string, string>
): TariffLocationGroup[] {
  const buckets = new Map<string | null, RentalTariff[]>();
  for (const tariff of tariffs) {
    const key = tariff.locationId ?? null;
    const list = buckets.get(key) ?? [];
    list.push(tariff);
    buckets.set(key, list);
  }

  const keys = [...buckets.keys()].sort((a, b) => {
    if (a == null) return -1;
    if (b == null) return 1;
    return (locationNameById.get(a) ?? a).localeCompare(locationNameById.get(b) ?? b, undefined, {
      sensitivity: "base",
    });
  });

  return keys.map((key) => ({
    locationKey: key,
    tariffs: (buckets.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
  }));
}

/** Fixed tariff list price for one-off booking (server recalculates on save with tariff_id). */
export function fixedTariffListPrice(tariff: RentalTariff): number | null {
  if (tariff.tariffType !== "fixed" || tariff.price == null) return null;
  return tariff.price;
}

export function tariffMatchesLocation(tariff: RentalTariff, locationId: string): boolean {
  return !tariff.locationId || tariff.locationId === locationId;
}

export function filterFixedTariffsForLocation(tariffs: RentalTariff[], locationId: string): RentalTariff[] {
  return tariffs.filter(
    (tariff) => tariff.tariffType === "fixed" && tariffMatchesLocation(tariff, locationId)
  );
}

export function hasHourlyTariffsForLocation(tariffs: RentalTariff[], locationId: string): boolean {
  return tariffs.some(
    (tariff) => tariff.tariffType === "hourly" && tariffMatchesLocation(tariff, locationId)
  );
}

/** Manual amount differs from tariff list price — override reason required on create. */
export function needsRentalAmountOverrideReason(
  tariffId: string | null | undefined,
  tariffPrice: number | null | undefined,
  enteredAmount: number
): boolean {
  if (!tariffId || tariffPrice == null) return false;
  return enteredAmount !== tariffPrice;
}

export function formatTariffSelectLabel(
  tariff: RentalTariff,
  formatAmount: (amount: number) => string
): string {
  if (tariff.price == null) return tariff.name;
  return `${tariff.name} — ${formatAmount(tariff.price)}`;
}
