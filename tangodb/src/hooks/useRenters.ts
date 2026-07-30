import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useRenters(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(rentersQueryKey),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renters")
        .select("id, display_name, contact_phone, contact_email")
        .order("display_name");

      if (error) throw error;
      return (data ?? []).map((row) => mapRenter(row as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateRenter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { displayName: string; contactPhone?: string; contactEmail?: string }) => {
      const { data, error } = await supabase.rpc("create_renter", {
        p_display_name: input.displayName,
        p_contact_phone: input.contactPhone ?? null,
        p_contact_email: input.contactEmail ?? null,
      });

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
