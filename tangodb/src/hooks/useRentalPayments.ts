import { useRentalMoneyRegister, rentalMoneyRegisterQueryKey } from "./useRentalMoneyRegister";

/** @deprecated Prefer useRentalMoneyRegister — reads unified rental money register (stage 5). */
export const rentalPaymentsQueryKey = rentalMoneyRegisterQueryKey;

export type RentalPaymentFilter = import("./useRentalMoneyRegister").RentalMoneyRegisterFilter;

/** @deprecated Prefer useRentalMoneyRegister */
export function useRentalPayments(filter?: RentalPaymentFilter) {
  return useRentalMoneyRegister(filter);
}

export { useRentalMoneyRegister };
