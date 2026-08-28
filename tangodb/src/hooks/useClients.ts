import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAllPostgrestRows } from "../lib/postgrestRange";
import { reportClientError } from "../lib/reportClientError";
import { supabase } from "../lib/supabase";
import { normalizeTelegramForStorage } from "../lib/telegram";
import { useOrganization } from "../organization/OrganizationProvider";
import type { Client } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const clientsQueryKey = ["clients"] as const;

export function clientsListQueryKey(includeArchived: boolean, maskPii = false) {
  return [...clientsQueryKey, { includeArchived, maskPii }] as const;
}

export type GuardianFields = {
  guardian1Name?: string;
  guardian1Phone?: string;
  guardian1Telegram?: string;
  guardian1Address?: string;
  guardian2Name?: string;
  guardian2Phone?: string;
  guardian2Telegram?: string;
  guardian2Address?: string;
};

export type ClientFormInput = {
  firstName: string;
  lastName: string;
  telegram: string;
  phone?: string;
  email?: string;
  isMinor?: boolean;
} & GuardianFields;

const CONTACT_PII_COLUMNS = [
  "telegram",
  "phone",
  "email",
  "guardian1_name",
  "guardian1_phone",
  "guardian1_telegram",
  "guardian1_address",
  "guardian2_name",
  "guardian2_phone",
  "guardian2_telegram",
  "guardian2_address",
] as const;

const mapClient = (row: Record<string, unknown>): Client => ({
  id: row.id as string,
  firstName: row.first_name as string,
  lastName: row.last_name as string,
  telegram: (row.telegram as string) || "",
  phone: (row.phone as string) || "",
  email: (row.email as string) || "",
  isMinor: Boolean(row.is_minor),
  guardian1Name: (row.guardian1_name as string) || "",
  guardian1Phone: (row.guardian1_phone as string) || "",
  guardian1Telegram: (row.guardian1_telegram as string) || "",
  guardian1Address: (row.guardian1_address as string) || "",
  guardian2Name: (row.guardian2_name as string) || "",
  guardian2Phone: (row.guardian2_phone as string) || "",
  guardian2Telegram: (row.guardian2_telegram as string) || "",
  guardian2Address: (row.guardian2_address as string) || "",
  createdAt: row.created_at as string | undefined,
  archivedAt: (row.archived_at as string | null) ?? null,
});

function clientRowFromInput(input: ClientFormInput) {
  const isMinor = Boolean(input.isMinor);
  return {
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    telegram: normalizeTelegramForStorage(input.telegram),
    phone: (input.phone ?? "").trim(),
    email: (input.email ?? "").trim(),
    is_minor: isMinor,
    guardian1_name: isMinor ? (input.guardian1Name ?? "").trim() : "",
    guardian1_phone: isMinor ? (input.guardian1Phone ?? "").trim() : "",
    guardian1_telegram: isMinor ? normalizeTelegramForStorage(input.guardian1Telegram ?? "") : "",
    guardian1_address: isMinor ? (input.guardian1Address ?? "").trim() : "",
    guardian2_name: isMinor ? (input.guardian2Name ?? "").trim() : "",
    guardian2_phone: isMinor ? (input.guardian2Phone ?? "").trim() : "",
    guardian2_telegram: isMinor ? normalizeTelegramForStorage(input.guardian2Telegram ?? "") : "",
    guardian2_address: isMinor ? (input.guardian2Address ?? "").trim() : "",
  };
}

type ClientWritableRow = ReturnType<typeof clientRowFromInput>;

function clientUpdatePayload(input: ClientFormInput, omitEmptyContactPii: boolean): Partial<ClientWritableRow> {
  const row = clientRowFromInput(input);
  if (!omitEmptyContactPii) return row;
  const payload: Partial<ClientWritableRow> = {
    first_name: row.first_name,
    last_name: row.last_name,
    is_minor: row.is_minor,
  };
  for (const key of CONTACT_PII_COLUMNS) {
    if (row[key]) payload[key] = row[key];
  }
  return payload;
}

export function useClients(options?: { includeArchived?: boolean; enabled?: boolean }) {
  const includeArchived = options?.includeArchived ?? false;
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role } = useOrganization();
  const maskPii = role === "teacher";
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(clientsListQueryKey(includeArchived, maskPii)),
    enabled: queryEnabled,
    queryFn: async () => {
      const data = maskPii
        ? await fetchAllPostgrestRows((from, to) => {
            let query = supabase.from("clients_teacher_v").select("*").order("last_name");
            if (!includeArchived) query = query.is("archived_at", null);
            return query.range(from, to);
          })
        : await fetchAllPostgrestRows((from, to) => {
            let query = supabase.from("clients").select("*").order("last_name");
            if (!includeArchived) query = query.is("archived_at", null);
            return query.range(from, to);
          });
      return data.map((row) => mapClient(row as unknown as Record<string, unknown>));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export const useActiveClients = () => useClients();
export const useClientDirectory = (options?: { enabled?: boolean }) =>
  useClients({ includeArchived: true, enabled: options?.enabled });

export function useAddClient() {
  const queryClient = useQueryClient();
  const { organizationId, withOrgId } = useOrgQueryScope();
  const { role } = useOrganization();
  const maskPii = role === "teacher";

  return useMutation({
    mutationFn: async (input: ClientFormInput) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const fTrim = input.firstName.trim();
      const lTrim = input.lastName.trim();
      const cached =
        queryClient.getQueryData<Client[]>(withOrgId(clientsListQueryKey(false, maskPii))) ?? [];
      const exists = cached.some(
        (c) =>
          !c.archivedAt &&
          c.firstName.toLowerCase() === fTrim.toLowerCase() &&
          c.lastName.toLowerCase() === lTrim.toLowerCase()
      );
      if (exists) {
        return { success: false as const, error: "clients.error.duplicate" };
      }

      const id = crypto.randomUUID();
      const { error } = await supabase.from("clients").insert({
        id,
        organization_id: organizationId,
        ...clientRowFromInput(input),
      });
      if (error) {
        if (error.code === "23505") {
          return {
            success: false as const,
            error: "clients.error.duplicate",
          };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const, id };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
    onError: (error) => {
      reportClientError(error, { area: "mutation", action: "useAddClient" });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  const { role } = useOrganization();
  const maskPii = role === "teacher";

  return useMutation({
    mutationFn: async ({ clientId, ...input }: ClientFormInput & { clientId: string }) => {
      const { error } = await supabase
        .from("clients")
        .update(clientUpdatePayload(input, maskPii))
        .eq("id", clientId);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
  });
}

export function useArchiveClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", clientId)
        .is("archived_at", null);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
    onError: (error) => {
      reportClientError(error, { area: "mutation", action: "useArchiveClient" });
    },
  });
}

export function useRestoreClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ archived_at: null })
        .eq("id", clientId)
        .not("archived_at", "is", null);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
  });
}
