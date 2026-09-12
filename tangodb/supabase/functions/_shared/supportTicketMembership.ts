import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface StaffMemberOrg {
  id: string;
  name: string;
}

export async function loadActiveStaffMember(
  admin: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<
  | { ok: true; org: StaffMemberOrg }
  | { ok: false; httpStatus: number; code: string }
> {
  const { data: membership, error } = await admin
    .from("organization_members")
    .select("is_active, organization:organizations(id, name)")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  const orgRaw = membership?.organization;
  const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;

  if (error || !membership?.is_active || !org) {
    return { ok: false, httpStatus: 403, code: "organization_access_required" };
  }

  return {
    ok: true,
    org: { id: org.id, name: org.name },
  };
}
