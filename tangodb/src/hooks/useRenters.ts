import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import type { Renter } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { rentalsQueryKey } from "./useRentals";

export const rentersQueryKey = ["renters"] as const;

const mapRenter = (row: Record<string, unknown>): Renter => ({
  id: String(row.id),
  displayName: String(row.display_name ?? ""),
  contactPhone: row.contact_phone != null ? String(row.contact_phone) : null,
  contactEmail: row.contact_email != null ? String(row.contact_email) : null,
});

/** Active renters for rental picker (uses list_renters RPC, active-only default). */
export function useRenters(options?: { enabled?: boolean; activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? true;
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...rentersQueryKey, "picker", { activeOnly }]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renters", {
        p_search: null,
        p_type: null,
        p_status: activeOnly ? "active" : null,
        p_has_debt: null,
        p_upcoming: null,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string; renters?: unknown[] } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "renters.error.loadFailed");
      }

      return (result.renters ?? []).map((row) => mapRenter(row as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateRenter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      displayName: string;
      contactPhone?: string;
      contactEmail?: string;
      duplicateCreateReason?: string;
    }) => {
      const payload: Record<string, unknown> = {
        display_name: input.displayName,
        counterparty_type: "individual",
        status: "active",
      };
      if (input.contactPhone) payload.contact_phone = input.contactPhone;
      if (input.contactEmail) payload.contact_email = input.contactEmail;
      if (input.duplicateCreateReason) {
        payload.duplicate_create_reason = input.duplicateCreateReason;
      }

      const { data, error } = await supabase.rpc("upsert_renter", { p_payload: asJson(payload) });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; renter_id?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.rental.renterCreateFailed" };
      }

      return { success: true as const, renterId: result.renter_id ?? "" };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rentersQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: rentalsQueryKey, refetchType: "active" });
    },
  });
}
