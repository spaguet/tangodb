export type BillingInstrumentRow = {
  instrument: string;
  edition: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
};

export type BillingSubscriptionMirror = {
  plan: string;
  billing_period: string;
  status: string;
  provider: string;
  current_period_start: string | null;
  current_period_end: string | null;
  provider_subscription_id: string | null;
};

export type BillingRow = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  effective_ceiling: string;
  active_edition: string;
  live_instruments: BillingInstrumentRow[];
  license_type: string | null;
  license_activated_at: string | null;
  subscription: BillingSubscriptionMirror | null;
  over_cap: boolean;
};

export type ManualBillingPlan = "studio_month" | "pro_month" | "pro_lifetime";

export type TenantRow = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  demo_expires_at: string | null;
  demo_days_left: number | null;
  created_at: string;
  crm_version_code: string | null;
  schema_version_locked: boolean;
  payment_ref: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  last_sign_in_at: string | null;
  telegram_masked: string | null;
  license_badge: string;
  active_edition: string | null;
  has_pro_lifetime: boolean;
  over_cap: boolean;
  needs_review: boolean;
  can_purge: boolean;
  purge_requires_anti_abuse: boolean;
  storage_rows: number;
  storage_display: string;
  key_metadata: {
    key_type: string;
    status: string;
    activated_at: string | null;
    recipient_email: string | null;
  } | null;
};
