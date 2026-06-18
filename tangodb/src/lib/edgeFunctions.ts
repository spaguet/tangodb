import { supabase } from "./supabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";

export async function invokeEdgeFunction<T>(
  name: string,
  body?: Record<string, unknown>
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });

  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${res.status})`);
  }
  return payload;
}

export interface InviteMemberResponse {
  ok: boolean;
  invite_id?: string;
  invite_url?: string;
  email_sent?: boolean;
  expires_at?: string;
}

export interface AcceptInviteResponse {
  ok: boolean;
  organization_id?: string;
  member_id?: string;
  role?: string;
  already_member?: boolean;
}

export async function inviteMember(params: {
  email: string;
  role: string;
  scope?: Record<string, unknown>;
}): Promise<InviteMemberResponse> {
  return invokeEdgeFunction<InviteMemberResponse>("invite-member", params);
}

export async function acceptInvite(token: string): Promise<AcceptInviteResponse> {
  return invokeEdgeFunction<AcceptInviteResponse>("accept-invite", { token });
}
