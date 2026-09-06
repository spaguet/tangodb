import type { User } from "https://esm.sh/@supabase/supabase-js@2";
import { createServiceClient } from "./supabase.ts";

/** Reliable email lookup via SQL RPC — admin.listUsers can fail on hosted projects. */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const admin = createServiceClient();
  const normalized = email.trim().toLowerCase();
  const { data: userId, error: lookupError } = await admin.rpc(
    "dev_console_user_id_by_email_exact",
    { p_email: normalized }
  );
  if (lookupError) throw lookupError;
  if (!userId || typeof userId !== "string") return null;

  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw error;
  return data.user ?? null;
}
