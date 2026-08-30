import { useMutation, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import { rentalsQueryKey } from "./useRentals";
import { scheduleQueryKey } from "./useSchedule";
import { rentersQueryKey } from "./useRenters";

function rpcResult(data: unknown, fallback: string) {
  const result = data as { success?: boolean; error?: string } | null;
  if (!result?.success) {
    return { success: false as const, error: result?.error ?? fallback };
  }
  return { success: true as const, data: result };
}

function invalidateMiniAppBooking(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentalsQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentersQueryKey, refetchType: "active" });
}

export function useRenterQuoteBooking() {
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc("renter_quote_booking", {
        p_payload: asJson(payload),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renter.booking.quoteFailed" };
      }
      return { success: true as const, data: result };
    },
  });
}

export function useRenterCreateBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc("renter_create_booking", {
        p_payload: asJson(payload),
      });
      if (error) return { success: false as const, error: error.message };
      return rpcResult(data, "renter.booking.createFailed");
    },
    onSuccess: (result) => {
      if (result.success) invalidateMiniAppBooking(queryClient);
    },
  });
}

export function useRenterCreateRecurringPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc("renter_create_recurring_pack", {
        p_payload: asJson(payload),
      });
      if (error) return { success: false as const, error: error.message };
      return rpcResult(data, "renter.booking.packFailed");
    },
    onSuccess: (result) => {
      if (result.success) invalidateMiniAppBooking(queryClient);
    },
  });
}

export function useRenterCancelOccurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rentalId: string) => {
      const { data, error } = await supabase.rpc("renter_cancel_occurrence", {
        p_rental_id: rentalId,
      });
      if (error) return { success: false as const, error: error.message };
      return rpcResult(data, "renter.cancel.failed");
    },
    onSuccess: (result) => {
      if (result.success) invalidateMiniAppBooking(queryClient);
    },
  });
}

export function useRenterCancelPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (seriesId: string) => {
      const { data, error } = await supabase.rpc("renter_cancel_pack", { p_series_id: seriesId });
      if (error) return { success: false as const, error: error.message };
      return rpcResult(data, "renter.cancel.packFailed");
    },
    onSuccess: (result) => {
      if (result.success) invalidateMiniAppBooking(queryClient);
    },
  });
}

export function useRenterDeleteHold() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rentalId: string) => {
      const { data, error } = await supabase.rpc("renter_delete_hold", { p_rental_id: rentalId });
      if (error) return { success: false as const, error: error.message };
      return rpcResult(data, "renter.cancel.holdFailed");
    },
    onSuccess: (result) => {
      if (result.success) invalidateMiniAppBooking(queryClient);
    },
  });
}
