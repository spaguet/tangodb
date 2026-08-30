import type { User } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "./http.ts";

/** CRM team principal only — rejects Mini App renter JWT (app_metadata.actor = renter). */
export function isRenterActor(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.app_metadata?.actor === "renter";
}

export function renterActorForbidden(req: Request): Response {
  return jsonResponse({ error: "Forbidden" }, 403, req);
}
