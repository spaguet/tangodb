import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { normalizeTime } from "../lib/scheduleWeek";
import type { PaymentMethod, RentalDisplayLesson, RentalPayment, RentalPaymentStatus } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { scheduleQueryKey } from "./useSchedule";
import { rentalPaymentsQueryKey } from "./useRentalPayments";

export const rentalsQueryKey = ["rentals"] as const;

export interface RentalConflictGroup {
  kind: "group";
  slotId: string;
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  groupName: string;
}

export interface RentalConflictPersonal {
  kind: "personal";
  lessonId: string;
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  clientDisplay: string;
}

export interface RentalConflictEvent {
  kind: "event";
  eventId: string;
  sessionId: string;
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  title: string;
}

export interface RentalConflictRental {
  kind: "rental";
  rentalId: string;
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  purpose: string;
}

export type RentalConflict =
  | RentalConflictGroup
  | RentalConflictPersonal
  | RentalConflictEvent
  | RentalConflictRental;

function mapConflict(row: Record<string, unknown>): RentalConflict {
  const kind = row.kind as string;
  if (kind === "personal") {
    return {
      kind: "personal",
      lessonId: String(row.lesson_id),
      occurrenceDate: String(row.occurrence_date).slice(0, 10),
      timeStart: normalizeTime(String(row.time_start)),
      timeEnd: normalizeTime(String(row.time_end)),
      clientDisplay: String(row.client_display ?? ""),
    };
  }
  if (kind === "event") {
    return {
      kind: "event",
      eventId: String(row.event_id),
      sessionId: String(row.session_id),
      occurrenceDate: String(row.occurrence_date).slice(0, 10),
      timeStart: normalizeTime(String(row.time_start)),
      timeEnd: normalizeTime(String(row.time_end)),
      title: String(row.title ?? ""),
    };
  }
  if (kind === "rental") {
    return {
      kind: "rental",
      rentalId: String(row.rental_id),
      occurrenceDate: String(row.occurrence_date).slice(0, 10),
      timeStart: normalizeTime(String(row.time_start)),
      timeEnd: normalizeTime(String(row.time_end)),
      purpose: String(row.purpose ?? ""),
    };
  }
  return {
    kind: "group",
    slotId: String(row.slot_id),
    occurrenceDate: String(row.occurrence_date).slice(0, 10),
    timeStart: normalizeTime(String(row.time_start)),
    timeEnd: normalizeTime(String(row.time_end)),
    groupName: String(row.group_name ?? ""),
  };
}

function mapScheduleRow(row: Record<string, unknown>): RentalDisplayLesson {
  return {
    kind: "rental",
    rentalId: String(row.rental_id),
    date: String(row.rental_date).slice(0, 10),
    timeStart: normalizeTime(String(row.time_start)),
    timeEnd: normalizeTime(String(row.time_end)),
    locationId: row.location_id != null ? String(row.location_id) : null,
    rentalSeriesId: row.rental_series_id != null ? String(row.rental_series_id) : null,
    bookingStatus: (row.booking_status as "confirmed" | "cancelled") ?? "confirmed",
    purpose: row.purpose != null ? String(row.purpose) : null,
    renterName: row.renter_name != null ? String(row.renter_name) : null,
    paymentStatus: (row.payment_status as RentalPaymentStatus | null) ?? null,
    fixedAmount: row.fixed_amount != null ? Number(row.fixed_amount) : null,
    paidAmount: row.paid_amount != null ? Number(row.paid_amount) : null,
    currency: row.currency != null ? String(row.currency) : "RUB",
  };
}

export function useRentalsForWeek(weekStartISO: string, weekEndISO: string, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...rentalsQueryKey, "week", weekStartISO]),
    enabled: orgEnabled && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rentals_for_schedule_week", {
        p_week_start: weekStartISO,
        p_week_end: weekEndISO,
      });

      if (error) throw error;

      const rows = (data as Record<string, unknown>[] | null) ?? [];
      return rows.map(mapScheduleRow);
    },
    staleTime: 60 * 1000,
  });
}

export function useRentalConflictsPreview(
  date: string,
  timeStart: string,
  timeEnd: string,
  locationId: string,
  enabled: boolean,
  excludeRentalId?: string
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([
      ...rentalsQueryKey,
      "conflicts",
      date,
      timeStart,
      timeEnd,
      locationId,
      excludeRentalId,
    ]),
    enabled: orgEnabled && enabled && !!date && !!timeStart && !!timeEnd && !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_rental_conflicts", {
        p_date: date,
        p_time_start: timeStart,
        p_time_end: timeEnd,
        p_location_id: locationId,
        p_exclude_rental_id: excludeRentalId ?? null,
      });

      if (error) throw error;

      const result = data as {
        success?: boolean;
        error?: string;
        conflicts?: Record<string, unknown>[];
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.rental.previewFailed", conflicts: [] };
      }

      return {
        success: true as const,
        conflicts: (result.conflicts ?? []).map(mapConflict),
      };
    },
    staleTime: 0,
  });
}

export interface RentalDetail {
  id: string;
  rentalDate: string;
  timeStart: string;
  timeEnd: string;
  locationId: string;
  rentalSeriesId?: string | null;
  bookingStatus: "confirmed" | "cancelled";
  purpose?: string | null;
  internalComment?: string | null;
  fixedAmount?: number | null;
  calculatedAmount?: number | null;
  pricingBreakdown?: unknown | null;
  tariffType?: string | null;
  currency?: string;
  paidAmount?: number | null;
  paymentStatus?: RentalPaymentStatus | null;
  cancelledAt?: string | null;
  cancelledReason?: string | null;
  renter: { id: string; displayName?: string | null; contactPhone?: string | null; contactEmail?: string | null };
  payments: RentalPayment[];
}

export function useRentalDetail(rentalId: string | null, enabled: boolean) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...rentalsQueryKey, "detail", rentalId]),
    enabled: orgEnabled && enabled && !!rentalId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_detail", { p_rental_id: rentalId! });
      if (error) throw error;

      const result = data as {
        success?: boolean;
        error?: string;
        rental?: Record<string, unknown>;
        renter?: Record<string, unknown>;
        payments?: Record<string, unknown>[];
      } | null;

      if (!result?.success || !result.rental) {
        throw new Error(result?.error ?? "schedule.rental.notFound");
      }

      const r = result.rental;
      const ren = result.renter ?? {};

      return {
        id: String(r.id),
        rentalDate: String(r.rental_date).slice(0, 10),
        timeStart: normalizeTime(String(r.time_start)),
        timeEnd: normalizeTime(String(r.time_end)),
        locationId: String(r.location_id),
        rentalSeriesId: r.rental_series_id != null ? String(r.rental_series_id) : null,
        bookingStatus: (r.booking_status as "confirmed" | "cancelled") ?? "confirmed",
        purpose: r.purpose != null ? String(r.purpose) : null,
        internalComment: r.internal_comment != null ? String(r.internal_comment) : null,
        fixedAmount: r.fixed_amount != null ? Number(r.fixed_amount) : null,
        calculatedAmount: r.calculated_amount != null ? Number(r.calculated_amount) : null,
        pricingBreakdown: r.pricing_breakdown ?? null,
        tariffType: r.tariff_type != null ? String(r.tariff_type) : null,
        currency: r.currency != null ? String(r.currency) : "RUB",
        paidAmount: r.paid_amount != null ? Number(r.paid_amount) : null,
        paymentStatus: (r.payment_status as RentalPaymentStatus | null) ?? null,
        cancelledAt: r.cancelled_at != null ? String(r.cancelled_at) : null,
        cancelledReason: r.cancelled_reason != null ? String(r.cancelled_reason) : null,
        renter: {
          id: String(ren.id ?? ""),
          displayName: ren.display_name != null ? String(ren.display_name) : null,
          contactPhone: ren.contact_phone != null ? String(ren.contact_phone) : null,
          contactEmail: ren.contact_email != null ? String(ren.contact_email) : null,
        },
        payments: (result.payments ?? []).map(
          (p): RentalPayment => ({
            id: String(p.id),
            rentalId: rentalId!,
            amount: Number(p.amount),
            currency: String(p.currency ?? "RUB"),
            method: (p.method as PaymentMethod) ?? "cash",
            methodComment: p.method_comment != null ? String(p.method_comment) : null,
            createdAt: String(p.created_at ?? ""),
            operationDate:
              p.operation_date != null ? String(p.operation_date).slice(0, 10) : undefined,
            createdBy: p.created_by != null ? String(p.created_by) : null,
            operationKind: p.operation_kind === "storno" ? "storno" : "payment",
            reversesPaymentId: p.reverses_payment_id != null ? String(p.reverses_payment_id) : null,
            replacesPaymentId: p.replaces_payment_id != null ? String(p.replaces_payment_id) : null,
            correctionReasonCode:
              p.correction_reason_code != null ? String(p.correction_reason_code) : null,
            correctionComment: p.correction_comment != null ? String(p.correction_comment) : null,
            operationNumber: p.operation_number != null ? Number(p.operation_number) : null,
            correctionStatus: p.correction_status as RentalPayment["correctionStatus"],
            remainingAmount:
              p.remaining_amount != null ? Number(p.remaining_amount) : undefined,
          })
        ),
      } satisfies RentalDetail;
    },
    staleTime: 0,
  });
}

export interface CreateRentalInput {
  idempotencyKey: string;
  rentalDate: string;
  timeStart: string;
  timeEnd: string;
  locationId: string;
  renterId: string;
  tariffId?: string | null;
  purpose?: string;
  internalComment?: string;
  fixedAmount?: number;
  currency?: string;
  initialPayment?: number;
  paymentMethod?: PaymentMethod;
  paymentComment?: string;
}

function invalidateRentalQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentalsQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentalPaymentsQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
}

export function useCreateRental() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRentalInput) => {
      const { data, error } = await supabase.rpc("create_rental", {
        p_payload: {
          idempotency_key: input.idempotencyKey,
          rental_date: input.rentalDate,
          time_start: input.timeStart,
          time_end: input.timeEnd,
          location_id: input.locationId,
          renter_id: input.renterId,
          tariff_id: input.tariffId ?? null,
          purpose: input.purpose ?? null,
          internal_comment: input.internalComment ?? null,
          fixed_amount: input.fixedAmount ?? 0,
          currency: input.currency ?? "RUB",
          initial_payment: input.initialPayment ?? 0,
          payment_method: input.paymentMethod ?? "cash",
          payment_comment: input.paymentComment ?? null,
        },
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        rental_id?: string;
        already_applied?: boolean;
        conflict?: Record<string, unknown>;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.rental.createFailed", conflict: result?.conflict };
      }

      return {
        success: true as const,
        rentalId: result.rental_id ?? "",
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: () => invalidateRentalQueries(queryClient),
  });
}

export interface UpdateRentalInput {
  rentalId: string;
  rentalDate?: string;
  timeStart?: string;
  timeEnd?: string;
  locationId?: string;
  renterId?: string;
  purpose?: string;
  internalComment?: string;
  fixedAmount?: number;
  currency?: string;
}

export function useAdjustRentalAmount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { rentalId: string; newAmount: number; reason: string }) => {
      const { data, error } = await supabase.rpc("apply_rental_pricing_adjustment", {
        p_rental_id: input.rentalId,
        p_new_amount: input.newAmount,
        p_reason: input.reason,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        old_amount?: number;
        new_amount?: number;
        remaining?: number;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.rental.amountAdjustFailed" };
      }

      return {
        success: true as const,
        oldAmount: result.old_amount,
        newAmount: result.new_amount,
        remaining: result.remaining,
      };
    },
    onSuccess: () => invalidateRentalQueries(queryClient),
  });
}

export function useUpdateRental() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateRentalInput) => {
      const { data, error } = await supabase.rpc("update_rental", {
        p_rental_id: input.rentalId,
        p_payload: {
          rental_date: input.rentalDate,
          time_start: input.timeStart,
          time_end: input.timeEnd,
          location_id: input.locationId,
          renter_id: input.renterId,
          purpose: input.purpose,
          internal_comment: input.internalComment,
          fixed_amount: input.fixedAmount,
          currency: input.currency,
        },
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; conflict?: Record<string, unknown> } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.rental.updateFailed", conflict: result?.conflict };
      }

      return { success: true as const };
    },
    onSuccess: () => invalidateRentalQueries(queryClient),
  });
}

export function useCancelRental() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { rentalId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("cancel_rental", {
        p_rental_id: input.rentalId,
        p_reason: input.reason,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; already_applied?: boolean } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.rental.cancelFailed" };
      }

      return { success: true as const, alreadyApplied: result.already_applied ?? false };
    },
    onSuccess: () => invalidateRentalQueries(queryClient),
  });
}

export interface RecordRentalPaymentInput {
  rentalId: string;
  amount: number;
  method: PaymentMethod;
  methodComment?: string;
  idempotencyKey: string;
  operationDate?: string;
}

export function useRecordRentalPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordRentalPaymentInput) => {
      const { data, error } = await supabase.rpc("record_rental_payment", {
        p_rental_id: input.rentalId,
        p_amount: input.amount,
        p_method: input.method,
        p_method_comment: input.methodComment ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_operation_date: input.operationDate ?? null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        paid_amount?: number;
        payment_status?: RentalPaymentStatus;
        already_applied?: boolean;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.rental.paymentFailed" };
      }

      return {
        success: true as const,
        paidAmount: result.paid_amount,
        paymentStatus: result.payment_status,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: () => invalidateRentalQueries(queryClient),
  });
}
