import type { SupabaseClient } from "@supabase/supabase-js";
import { qrDisplaySrc, qrHttpsDownloadUrl } from "./qrUrl";
import type {
  LocationRow,
  OccupancyData,
  QrAsset,
  QuoteOneTime,
  PackCreateResult,
  QuotePackOccurrence,
  RentalItem,
  RpcResult,
  WalletData,
} from "./types";

function unwrap<T>(data: unknown, fallbackError = "rpcFailed"): T {
  const row = data as RpcResult<Record<string, unknown>>;
  if (!row || row.success !== true) {
    throw new Error(String((row as { error?: string })?.error ?? fallbackError));
  }
  return row as T;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function rpcListLocations(supabase: SupabaseClient): Promise<LocationRow[]> {
  const { data, error } = await supabase.rpc("renter_list_locations");
  if (error) throw new Error(error.message);
  const result = unwrap<{ locations: LocationRow[] }>(data);
  return result.locations ?? [];
}

export async function rpcGetOccupancy(
  supabase: SupabaseClient,
  locationId: string,
  from?: string,
  to?: string
): Promise<OccupancyData> {
  const { data, error } = await supabase.rpc("renter_get_occupancy", {
    p_location_id: locationId,
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) throw new Error(error.message);
  return unwrap<OccupancyData>(data);
}

export async function rpcQuoteOneTime(
  supabase: SupabaseClient,
  payload: {
    location_id: string;
    rental_date: string;
    time_start: string;
    time_end: string;
  }
): Promise<QuoteOneTime> {
  const { data, error } = await supabase.rpc("renter_quote_booking", { p_payload: payload });
  if (error) throw new Error(error.message);
  return unwrap<QuoteOneTime>(data);
}

export async function rpcQuotePack(
  supabase: SupabaseClient,
  payload: {
    location_id: string;
    valid_from: string;
    valid_to: string;
    time_start: string;
    time_end: string;
    weekdays: number[];
  }
): Promise<{
  kind: string;
  valid_from: string;
  valid_to: string;
  occurrences: QuotePackOccurrence[];
  can_create?: boolean;
  reasons?: string[];
  cost?: number;
  prepay?: number;
  remainder?: number;
  currency?: string;
}> {
  const { data, error } = await supabase.rpc("renter_quote_booking", { p_payload: payload });
  if (error) throw new Error(error.message);
  return unwrap<{
    kind: string;
    valid_from: string;
    valid_to: string;
    occurrences: QuotePackOccurrence[];
    can_create?: boolean;
    reasons?: string[];
    cost?: number;
    prepay?: number;
    remainder?: number;
    currency?: string;
  }>(data);
}

export async function rpcCreateBooking(
  supabase: SupabaseClient,
  payload: {
    location_id: string;
    rental_date: string;
    time_start: string;
    time_end: string;
    idempotency_key: string;
  }
): Promise<{ rental: RentalItem; already_applied?: boolean }> {
  const { data, error } = await supabase.rpc("renter_create_booking", { p_payload: payload });
  if (error) throw new Error(error.message);
  return unwrap<{ rental: RentalItem; already_applied?: boolean }>(data);
}

export async function rpcCreatePack(
  supabase: SupabaseClient,
  payload: {
    location_id: string;
    valid_from: string;
    valid_to: string;
    time_start: string;
    time_end: string;
    weekdays: number[];
    idempotency_key: string;
  }
): Promise<PackCreateResult> {
  const { data, error } = await supabase.rpc("renter_create_recurring_pack", {
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  return unwrap<PackCreateResult>(data);
}

export async function rpcListMine(
  supabase: SupabaseClient,
  limit: number,
  offset: number
): Promise<{ items: RentalItem[]; total: number; limit: number; offset: number }> {
  const { data, error } = await supabase.rpc("renter_list_mine", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return unwrap<{ items: RentalItem[]; total: number; limit: number; offset: number }>(data);
}

export async function rpcGetWallet(
  supabase: SupabaseClient,
  limit: number,
  offset: number
): Promise<WalletData> {
  const { data, error } = await supabase.rpc("renter_get_wallet", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  const row = unwrap<
    WalletData & {
      pending_topup?: WalletData["pending_topup"];
      has_awaiting_payment?: boolean;
    }
  >(data);
  return {
    ...row,
    pending_topup: row.pending_topup ?? null,
    has_awaiting_payment: row.has_awaiting_payment ?? false,
    entries: (row.entries ?? []).map((entry) => ({
      ...entry,
      direction:
        entry.direction === "credit" || entry.direction === "debit" ? entry.direction : null,
      balance_after:
        entry.balance_after != null && Number.isFinite(Number(entry.balance_after))
          ? Number(entry.balance_after)
          : null,
    })),
  };
}

export async function rpcCancelOccurrence(
  supabase: SupabaseClient,
  rentalId: string
): Promise<void> {
  const { data, error } = await supabase.rpc("renter_cancel_occurrence", {
    p_rental_id: rentalId,
  });
  if (error) throw new Error(error.message);
  unwrap(data);
}

export async function rpcCancelPack(supabase: SupabaseClient, seriesId: string): Promise<void> {
  const { data, error } = await supabase.rpc("renter_cancel_pack", {
    p_series_id: seriesId,
  });
  if (error) throw new Error(error.message);
  unwrap(data);
}

export async function rpcDeleteHold(supabase: SupabaseClient, rentalId: string): Promise<void> {
  const { data, error } = await supabase.rpc("renter_delete_hold", {
    p_rental_id: rentalId,
  });
  if (error) throw new Error(error.message);
  unwrap(data);
}

export async function rpcUpdateProfile(
  supabase: SupabaseClient,
  displayName: string,
  contactPhone: string | null
): Promise<void> {
  const { data, error } = await supabase.rpc("renter_update_profile", {
    p_payload: { display_name: displayName, contact_phone: contactPhone },
  });
  if (error) throw new Error(error.message);
  unwrap(data);
}

export async function rpcListActiveQr(supabase: SupabaseClient): Promise<QrAsset[]> {
  const { data, error } = await supabase.rpc("renter_list_active_qr");
  if (error) throw new Error(error.message);
  const result = unwrap<{ assets: Record<string, unknown>[] }>(data);
  return (result.assets ?? []).map((row) => ({
    id: String(row.id),
    label: row.label != null ? String(row.label) : null,
    signed_url: null,
    storage_path: row.storage_path != null ? String(row.storage_path) : null,
  }));
}

export type RentalQrAccess = {
  displaySrc: string | null;
  downloadUrl: string | null;
};

export async function rpcGetRentalQrAccessUrl(
  supabase: SupabaseClient,
  assetId: string
): Promise<RentalQrAccess | null> {
  try {
    const invoked = supabase.functions.invoke("renter-qr-upload", {
      body: { action: "sign", id: assetId },
    });
    const { data, error } = await withTimeout(invoked, 8_000);
    if (error) return null;
    const result = data as {
      success?: boolean;
      signed_url?: string | null;
      content_base64?: string | null;
      mime_type?: string | null;
    } | null;
    if (!result?.success) return null;
    return {
      displaySrc: qrDisplaySrc(result),
      downloadUrl: qrHttpsDownloadUrl(result),
    };
  } catch {
    return null;
  }
}

export async function rpcSubmitTopup(
  supabase: SupabaseClient,
  payload: { amount: number; method: "qr" | "cash"; qr_asset_id?: string }
): Promise<{ id: string; amount: number; correlation_code: string }> {
  const { data, error } = await supabase.rpc("renter_submit_topup", { p_payload: payload });
  if (error) throw new Error(error.message);
  const row = data as RpcResult<{ id: string; amount: number; correlation_code: string }>;
  if (!row?.success) {
    throw new Error(String((row as { error?: string })?.error ?? "rpcFailed"));
  }
  return row as { id: string; amount: number; correlation_code: string };
}

export async function rpcAckOutboxSkipped(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.rpc("renter_ack_outbox_skipped");
  if (error) throw new Error(error.message);
  const row = data as RpcResult<unknown>;
  if (!row?.success) {
    throw new Error(String((row as { error?: string })?.error ?? "rpcFailed"));
  }
}
