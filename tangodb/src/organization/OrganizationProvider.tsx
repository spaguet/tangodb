import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import {
  getMemberIdFromSession,
  getMemberRoleFromSession,
  getOrganizationIdFromSession,
} from "../lib/authClaims";
import { supabase } from "../lib/supabase";
import { resetUIStore } from "../store/ui";
import type {
  MemberRole,
  OrganizationMember,
  OrganizationSettings,
  OrganizationSummary,
  OrgStatus,
  TeacherScope,
} from "../types/organization";
import { EMPTY_TEACHER_SCOPE, PLACEHOLDER_ORG_NAMES } from "../types/organization";

export const membershipsQueryKey = ["organization-memberships"] as const;

interface OrganizationContextValue {
  memberships: OrganizationMember[];
  membershipsLoading: boolean;
  organizationId: string | null;
  memberId: string | null;
  role: MemberRole | null;
  membership: OrganizationMember | null;
  scope: TeacherScope;
  organization: OrganizationSummary | null;
  settings: OrganizationSettings | null;
  orgLoading: boolean;
  needsOnboarding: boolean;
  isReadOnly: boolean;
  setActiveOrganization: (organizationId: string) => Promise<void>;
  refreshOrganization: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

function mapMembership(row: Record<string, unknown>): OrganizationMember {
  const orgRaw = row.organizations as Record<string, unknown> | null | undefined;
  const organization = orgRaw
    ? {
        id: orgRaw.id as string,
        name: orgRaw.name as string,
        slug: (orgRaw.slug as string | null) ?? null,
        status: orgRaw.status as OrgStatus,
        demo_expires_at: (orgRaw.demo_expires_at as string | null) ?? null,
        data_purge_at: (orgRaw.data_purge_at as string | null) ?? null,
      }
    : null;

  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    user_id: row.user_id as string,
    role: row.role as MemberRole,
    scope: row.scope as TeacherScope,
    display_name: (row.display_name as string | null) ?? null,
    is_active: row.is_active as boolean,
    joined_at: (row.joined_at as string | null) ?? null,
    organization,
  };
}

function mapSettings(row: Record<string, unknown>): OrganizationSettings {
  return {
    organization_id: row.organization_id as string,
    locale: row.locale as string,
    currency_code: row.currency_code as string,
    currency_display: row.currency_display as "symbol" | "code",
    timezone: row.timezone as string,
    week_starts_on: row.week_starts_on as number,
    org_preset: row.org_preset as OrganizationSettings["org_preset"],
    terminology: (row.terminology as Record<string, string>) ?? {},
    modules: row.modules as OrganizationSettings["modules"],
    freeze_max_count: row.freeze_max_count as number,
    freeze_min_lessons: row.freeze_min_lessons as number,
    freeze_deducts_lesson: row.freeze_deducts_lesson as boolean,
    low_balance_threshold: row.low_balance_threshold as number,
    teachers_can_manage_disciplines: row.teachers_can_manage_disciplines as boolean,
    pair_cycle_enabled: row.pair_cycle_enabled as boolean,
    branding_name: (row.branding_name as string | null) ?? null,
    branding_logo_url: (row.branding_logo_url as string | null) ?? null,
    updated_at: row.updated_at as string,
  };
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const autoSelectAttempted = useRef<string | null>(null);

  const organizationId = getOrganizationIdFromSession(session);
  const memberId = getMemberIdFromSession(session);
  const role = getMemberRoleFromSession(session);

  const {
    data: memberships = [],
    isLoading: membershipsLoading,
    refetch: refetchMemberships,
  } = useQuery({
    queryKey: [...membershipsQueryKey, session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select(
          `
          id,
          organization_id,
          user_id,
          role,
          scope,
          display_name,
          is_active,
          joined_at,
          organizations:organization_id (
            id,
            name,
            slug,
            status,
            demo_expires_at,
            data_purge_at
          )
        `
        )
        .eq("user_id", session!.user.id)
        .eq("is_active", true)
        .order("joined_at", { ascending: true });

      if (error) throw error;
      return (data ?? []).map((row) => mapMembership(row as Record<string, unknown>));
    },
  });

  const {
    data: orgBundle,
    isLoading: orgLoading,
    refetch: refetchOrgBundle,
  } = useQuery({
    queryKey: ["organization-context", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const [orgRes, settingsRes] = await Promise.all([
        supabase
          .from("organizations")
          .select("id, name, slug, status, demo_expires_at, data_purge_at")
          .eq("id", organizationId!)
          .maybeSingle(),
        supabase.from("organization_settings").select("*").eq("organization_id", organizationId!).maybeSingle(),
      ]);

      if (orgRes.error) throw orgRes.error;
      if (settingsRes.error) throw settingsRes.error;

      const organization = orgRes.data
        ? ({
            id: orgRes.data.id as string,
            name: orgRes.data.name as string,
            slug: (orgRes.data.slug as string | null) ?? null,
            status: orgRes.data.status as OrgStatus,
            demo_expires_at: (orgRes.data.demo_expires_at as string | null) ?? null,
            data_purge_at: (orgRes.data.data_purge_at as string | null) ?? null,
          } satisfies OrganizationSummary)
        : null;

      const settings = settingsRes.data
        ? mapSettings(settingsRes.data as Record<string, unknown>)
        : null;

      return { organization, settings };
    },
  });

  const setActiveOrganization = useCallback(
    async (nextOrganizationId: string) => {
      const { error } = await supabase.rpc("set_active_organization", {
        p_organization_id: nextOrganizationId,
      });
      if (error) throw error;

      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      queryClient.clear();
      resetUIStore();
      await refetchMemberships();
    },
    [queryClient, refetchMemberships]
  );

  const refreshOrganization = useCallback(async () => {
    await refetchMemberships();
    await refetchOrgBundle();
  }, [refetchMemberships, refetchOrgBundle]);

  useEffect(() => {
    if (!session?.user.id || membershipsLoading || memberships.length !== 1) return;
    if (organizationId) return;
    if (autoSelectAttempted.current === session.user.id) return;

    autoSelectAttempted.current = session.user.id;
    void setActiveOrganization(memberships[0].organization_id).catch(() => {
      autoSelectAttempted.current = null;
    });
  }, [session?.user.id, membershipsLoading, memberships, organizationId, setActiveOrganization]);

  useEffect(() => {
    if (!session?.user.id) {
      autoSelectAttempted.current = null;
    }
  }, [session?.user.id]);

  const organization = orgBundle?.organization ?? null;
  const settings = orgBundle?.settings ?? null;

  const membership = useMemo(
    () => memberships.find((m) => m.organization_id === organizationId) ?? null,
    [memberships, organizationId]
  );
  const scope = membership?.scope ?? EMPTY_TEACHER_SCOPE;

  const needsOnboarding =
    !!organization &&
    role === "owner" &&
    PLACEHOLDER_ORG_NAMES.includes(organization.name as (typeof PLACEHOLDER_ORG_NAMES)[number]);

  const isReadOnly = organization?.status === "demo_retention";

  const value = useMemo(
    () => ({
      memberships,
      membershipsLoading,
      organizationId,
      memberId,
      role,
      membership,
      scope,
      organization,
      settings,
      orgLoading,
      needsOnboarding,
      isReadOnly,
      setActiveOrganization,
      refreshOrganization,
    }),
    [
      memberships,
      membershipsLoading,
      organizationId,
      memberId,
      role,
      membership,
      scope,
      organization,
      settings,
      orgLoading,
      needsOnboarding,
      isReadOnly,
      setActiveOrganization,
      refreshOrganization,
    ]
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error("useOrganization must be used within OrganizationProvider");
  return ctx;
}
