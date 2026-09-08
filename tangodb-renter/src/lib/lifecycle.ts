export type LifecycleMessageKey =
  | "lifecycleAwaiting"
  | "lifecycleActive"
  | "lifecyclePrepaid"
  | "lifecycleSettled"
  | "lifecycleDebt"
  | "lifecycleCancelled"
  | "lifecycleHoldDeleted"
  | "lifecycleAutoDeleted"
  | "lifecycleUnknown";

const TERMINAL_MINIAPP_LIFECYCLES = new Set(["cancelled", "hold_deleted", "auto_deleted"]);

export function occupiesMiniAppGrid(lifecycle: string | null | undefined): boolean {
  if (!lifecycle) return false;
  return !TERMINAL_MINIAPP_LIFECYCLES.has(lifecycle);
}

export function miniAppLifecycleKey(lifecycle: string | null | undefined): LifecycleMessageKey {
  switch (lifecycle) {
    case "awaiting_payment":
      return "lifecycleAwaiting";
    case "active":
      return "lifecycleActive";
    case "prepaid_charged":
      return "lifecyclePrepaid";
    case "settled":
      return "lifecycleSettled";
    case "debt":
      return "lifecycleDebt";
    case "cancelled":
      return "lifecycleCancelled";
    case "hold_deleted":
      return "lifecycleHoldDeleted";
    case "auto_deleted":
      return "lifecycleAutoDeleted";
    default:
      return "lifecycleUnknown";
  }
}

export function isAwaitingPaymentHold(lifecycle: string | null | undefined): boolean {
  return lifecycle === "awaiting_payment";
}
