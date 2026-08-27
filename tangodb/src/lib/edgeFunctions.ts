import { supabase } from "./supabase";
import type { MemberMeta, TeacherScope } from "../types/organization";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

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
  firstName: string;
  lastName: string;
  role: string;
  scope?: TeacherScope;
  meta?: MemberMeta;
}): Promise<InviteMemberResponse> {
  return invokeEdgeFunction<InviteMemberResponse>("invite-member", params);
}

export async function acceptInvite(token: string): Promise<AcceptInviteResponse> {
  return invokeEdgeFunction<AcceptInviteResponse>("accept-invite", { token });
}

export interface PreviewInviteResponse {
  ok: boolean;
  account_exists?: boolean;
  organization_name?: string | null;
  expires_at?: string;
}

export interface CompleteInviteResponse {
  ok: boolean;
  needs_login?: boolean;
  account_created?: boolean;
}

export async function invokePublicEdgeFunction<T>(
  name: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseAnonKey}`,
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

export async function previewInvite(token: string): Promise<PreviewInviteResponse> {
  return invokePublicEdgeFunction<PreviewInviteResponse>("preview-invite", { token });
}

export async function completeInvite(
  token: string,
  password: string,
  email: string
): Promise<CompleteInviteResponse> {
  return invokePublicEdgeFunction<CompleteInviteResponse>("complete-invite", {
    token,
    password,
    email,
  });
}
