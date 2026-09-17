export const FINANCE_PRIMARY_PATHS = ["/finance/payments", "/finance/debtors"] as const;

export const FINANCE_RENTAL_PATHS = [
  "/finance/rental-accruals",
  "/finance/rental-inbox",
  "/finance/renter-topup",
] as const;

export function isFinancePrimaryPath(path: string): boolean {
  return (FINANCE_PRIMARY_PATHS as readonly string[]).includes(path);
}

export function isFinanceRentalPath(path: string): boolean {
  return (FINANCE_RENTAL_PATHS as readonly string[]).includes(path);
}
