import { supabase } from "./supabase";

const DEFAULT_LOCATION_NAME = "Зал 1";
const DEFAULT_DISCIPLINE_NAME = "Общее направление";

function demoTrialWritesOpen(
  status: string | null | undefined,
  demoExpiresAt: string | null | undefined
): boolean {
  if (status !== "demo_active") return false;
  if (!demoExpiresAt) return true;
  return new Date(demoExpiresAt).getTime() > Date.now();
}

/** Creates a starter hall and discipline when the org has none (post-wizard). */
export async function seedOnboardingStarterData(organizationId: string): Promise<void> {
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("status, demo_expires_at")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) throw orgError;
  if (!demoTrialWritesOpen(org?.status, org?.demo_expires_at)) {
    return;
  }

  const { data: locations, error: locListError } = await supabase
    .from("locations")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1);

  if (locListError) throw locListError;

  if (!locations?.length) {
    const { error: locInsertError } = await supabase.from("locations").insert({
      organization_id: organizationId,
      name: DEFAULT_LOCATION_NAME,
      address: "",
    });
    if (locInsertError) throw locInsertError;
  }

  const { data: disciplines, error: discListError } = await supabase
    .from("disciplines")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1);

  if (discListError) throw discListError;

  if (!disciplines?.length) {
    const { error: discInsertError } = await supabase.from("disciplines").insert({
      organization_id: organizationId,
      name: DEFAULT_DISCIPLINE_NAME,
      description: "",
    });
    if (discInsertError) throw discInsertError;
  }
}
