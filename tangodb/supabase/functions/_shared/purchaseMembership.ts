import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface LicensePurchaseOrg {
  id: string;
  name: string;
  status: string;
  data_purge_at: string | null;
}

export async function loadLicensePurchaseOrg(
  admin: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<
  | { ok: true; org: LicensePurchaseOrg }
  | { ok: false; httpStatus: number; code: string }
> {
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role, is_active, organization:organizations(id, name, status, data_purge_at)")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  const orgRaw = membership?.organization;
  const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw;

  if (
    membershipError ||
    !membership ||
    !membership.is_active ||
    !["owner", "director"].includes(membership.role) ||
    !org
  ) {
    return { ok: false, httpStatus: 403, code: "license_permission_required" };
  }

  return {
    ok: true,
    org: {
      id: org.id,
      name: org.name,
      status: org.status,
      data_purge_at: org.data_purge_at,
    },
  };
}
