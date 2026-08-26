import type { User } from "https://esm.sh/@supabase/supabase-js@2";
import { createServiceClient } from "./supabase.ts";

export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const admin = createServiceClient();
  const normalized = email.trim().toLowerCase();
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const existing = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (existing) return existing;
    if (data.users.length < perPage) return null;
  }
}
