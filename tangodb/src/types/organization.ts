export type MemberRole = "owner" | "director" | "admin" | "teacher" | "accountant";

export type OrgStatus = "demo_active" | "demo_retention" | "licensed" | "suspended" | "purged";

export type LicenseType = "lifetime" | "subscription";

export type SubscriptionStatus = "active" | "past_due" | "canceled";

export type BillingPeriod = "monthly" | "yearly";

export interface OrganizationLicense {
  license_type: LicenseType;
  activated_at: string;
  expires_at: string | null;
}

export interface OrganizationSubscription {
  plan: string;
  billing_period: BillingPeriod;
  status: SubscriptionStatus;
  provider: string;
  current_period_start: string | null;
  current_period_end: string | null;
}

export type OrgPreset = "dance_school" | "solo_teacher" | "sport_section" | "gymnastics_club" | "custom";

export interface TeacherScope {
  discipline_ids: string[];
  location_ids: string[];
  all_disciplines: boolean;
  all_locations: boolean;
  can_view_all_clients: boolean;
}

/** R6: reception preset — admin role with restricted_admin flag in meta */
export interface MemberMeta {
  restricted_admin?: boolean;
}

export interface MemberProfile {
  first_name: string | null;
  last_name: string | null;
  patronymic: string | null;
  contact_email: string | null;
  phone: string | null;
  telegram: string | null;
  profile_notes: string | null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string | null;
  status: OrgStatus;
  demo_expires_at: string | null;
  data_purge_at: string | null;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  scope: TeacherScope;
  meta: MemberMeta;
  display_name: string | null;
  is_active: boolean;
  joined_at: string | null;
  organization?: OrganizationSummary | null;
}

export interface OrgModules {
  group_subscriptions: boolean;
  personal_lessons: boolean;
  pair_subscriptions: boolean;
  trio_lessons: boolean;
  multi_discipline: boolean;
  locations: boolean;
  finance_basic: boolean;
}

export interface OrganizationSettings {
  organization_id: string;
  locale: string;
  currency_code: string;
  currency_display: "symbol" | "code";
  timezone: string;
  week_starts_on: number;
  org_preset: OrgPreset;
  terminology: Record<string, string>;
  modules: OrgModules;
  freeze_max_count: number;
  freeze_min_lessons: number;
  freeze_deducts_lesson: boolean;
  low_balance_threshold: number;
  teachers_can_manage_disciplines: boolean;
  teachers_can_sell_subscriptions: boolean;
  teachers_can_edit_clients: boolean;
  teachers_can_export: boolean;
  teachers_can_view_full_schedule: boolean;
  admin_can_export: boolean;
  admin_can_manage_team: boolean;
  pair_cycle_enabled: boolean;
  branding_name: string | null;
  branding_logo_url: string | null;
  updated_at: string;
}

export const EMPTY_TEACHER_SCOPE: TeacherScope = {
  discipline_ids: [],
  location_ids: [],
  all_disciplines: false,
  all_locations: false,
  can_view_all_clients: false,
};

export const PLACEHOLDER_ORG_NAMES = ["Demo Organization", "Organization"] as const;

export const PRESET_MODULES: Record<OrgPreset, OrgModules> = {
  dance_school: {
    group_subscriptions: true,
    personal_lessons: true,
    pair_subscriptions: true,
    trio_lessons: true,
    multi_discipline: true,
    locations: true,
    finance_basic: true,
  },
  solo_teacher: {
    group_subscriptions: false,
    personal_lessons: true,
    pair_subscriptions: false,
    trio_lessons: false,
    multi_discipline: false,
    locations: false,
    finance_basic: true,
  },
  sport_section: {
    group_subscriptions: true,
    personal_lessons: false,
    pair_subscriptions: false,
    trio_lessons: false,
    multi_discipline: true,
    locations: true,
    finance_basic: true,
  },
  gymnastics_club: {
    group_subscriptions: true,
    personal_lessons: false,
    pair_subscriptions: false,
    trio_lessons: false,
    multi_discipline: true,
    locations: true,
    finance_basic: true,
  },
  custom: {
    group_subscriptions: true,
    personal_lessons: true,
    pair_subscriptions: true,
    trio_lessons: true,
    multi_discipline: true,
    locations: true,
    finance_basic: true,
  },
};
