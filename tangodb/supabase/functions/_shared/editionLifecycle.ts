/**
 * E8: pause Pro-only worker paths when editions_lifecycle is on and org lacks capability.
 * When lifecycle flag is off (F91), callers must behave like 2.11 — no pauses here.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { logEvent } from "./supabase.ts";

type LifecycleCache = { value: boolean; fetchedAt: number };
let lifecycleFlagCache: LifecycleCache | null = null;
const LIFECYCLE_CACHE_MS = 5_000;

export async function isEditionsLifecycleEnabled(admin: SupabaseClient): Promise<boolean> {
  const now = Date.now();
  if (lifecycleFlagCache && now - lifecycleFlagCache.fetchedAt < LIFECYCLE_CACHE_MS) {
    return lifecycleFlagCache.value;
  }

  const { data, error } = await admin.rpc("editions_lifecycle_enabled");
  if (error) {
    logEvent("edition_lifecycle_flag_error", { message: error.message });
    lifecycleFlagCache = { value: false, fetchedAt: now };
    return false;
  }

  const value = data === true;
  lifecycleFlagCache = { value, fetchedAt: now };
  return value;
}

async function editionAllows(
  admin: SupabaseClient,
  organizationId: string,
  capability: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("edition_allows", {
    p_org_id: organizationId,
    p_capability: capability,
  });
  if (error) {
    logEvent("edition_allows_error", {
      organization_id: organizationId,
      capability,
      message: error.message,
    });
    return false;
  }
  return data === true;
}

/** Skip GCal worker/webhook/cron side-effects for this org (fail-closed on RPC error). */
export async function shouldPauseGoogleCalendarForOrg(
  admin: SupabaseClient,
  organizationId: string
): Promise<boolean> {
  if (!(await isEditionsLifecycleEnabled(admin))) {
    return false;
  }
  return !(await editionAllows(admin, organizationId, "google_calendar"));
}

/** Skip new Mini App worker enqueue paths (existing slot maintenance stays in SQL). */
export async function shouldPauseRenterMiniappForOrg(
  admin: SupabaseClient,
  organizationId: string
): Promise<boolean> {
  if (!(await isEditionsLifecycleEnabled(admin))) {
    return false;
  }
  return !(await editionAllows(admin, organizationId, "renter_miniapp"));
}
