export type PurchaseRequestKind =
  | "crm_license"
  | "crm_subscription"
  | "crm_studio_subscription"
  | "renter_miniapp_addon";

export type InboxKindFilter = "all" | "lifetime" | "monthly" | "studio" | "addon";

export type RowKind = PurchaseRequestKind | "unknown";

export function rowKind(requestKind: string | null | undefined): RowKind {
  switch (requestKind) {
    case "crm_license":
      return "crm_license";
    case "crm_subscription":
      return "crm_subscription";
    case "crm_studio_subscription":
      return "crm_studio_subscription";
    case "renter_miniapp_addon":
      return "renter_miniapp_addon";
    default:
      return "unknown";
  }
}

export function isMonthlyRequestKind(kind: RowKind): kind is "crm_subscription" | "crm_studio_subscription" {
  return kind === "crm_subscription" || kind === "crm_studio_subscription";
}

export function kindLabel(kind: RowKind): string {
  if (kind === "renter_miniapp_addon") return "Mini App add-on";
  if (kind === "crm_studio_subscription") return "Studio / месяц";
  if (kind === "crm_subscription") return "Pro / месяц";
  if (kind === "crm_license") return "Pro / пожизненно";
  return "Unknown request kind";
}

/** Mirrors Edge `kindToRequestKind` — monthly must not include Studio (F93). */
export function kindToRequestKind(kind: Exclude<InboxKindFilter, "all">): string | null {
  if (kind === "lifetime") return "crm_license";
  if (kind === "monthly") return "crm_subscription";
  if (kind === "studio") return "crm_studio_subscription";
  if (kind === "addon") return "renter_miniapp_addon";
  return null;
}
