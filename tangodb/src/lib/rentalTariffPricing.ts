import type { RentalTariff } from "../types";

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
