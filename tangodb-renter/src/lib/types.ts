export type RpcResult<T> = { success: true } & T | { success: false; error: string };

export type LocationRow = { id: string; name: string };

export type BusySlot = { date: string; time_start: string; time_end: string };

export type MineSlot = {
  id: string;
  date: string;
  time_start: string;
  time_end: string;
  lifecycle: string;
};

export type OccupancyData = {
  window: { from: string; to: string };
  from: string;
  to: string;
  busy: BusySlot[];
  mine: MineSlot[];
};

export type RentalItem = {
  id: string;
  rental_series_id: string | null;
  location_id: string;
  rental_date: string;
  time_start: string;
  time_end: string;
  channel: string;
  lifecycle: string;
  booking_status: string;
  hold_expires_at: string | null;
  prepay_amount: number | null;
  remainder_amount: number | null;
  debt_amount: number | null;
  fixed_amount: number | null;
  currency: string | null;
  prepay_charged_at: string | null;
  remainder_charged_at: string | null;
  can_delete_hold?: boolean;
  can_cancel_occurrence?: boolean;
  can_cancel_pack?: boolean;
  series_status?: string | null;
  series_hold_expires_at?: string | null;
  series_occurrence_count?: number | null;
  series_occurrence_index?: number | null;
};

export type PackCreateResult = {
  series_id: string;
  series_status?: string;
  hold_expires_at?: string | null;
  occurrence_count?: number;
  already_applied?: boolean;
};

export type PendingTopup = {
  id: string;
  amount: number;
  method: "qr" | "cash";
  created_at: string;
  correlation_code: string;
};

export type WalletEntry = {
  id: string;
  entry_type: string;
  amount: number;
  direction?: "credit" | "debit" | null;
  balance_after?: number | null;
  rental_id: string | null;
  phase: string | null;
  created_at: string;
};

export type WalletData = {
  wallet_balance: number;
  spendable: number;
  reserved_prepay: number;
  debt_amount: number;
  pending_topup: PendingTopup | null;
  has_awaiting_payment: boolean;
  entries: WalletEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type QuoteOneTime = {
  kind: string;
  hours: number;
  rate: number;
  cost: number;
  prepay: number;
  remainder: number;
  currency: string;
  busy: boolean;
  can_create?: boolean;
  reasons?: string[];
  balance?: number | null;
  shortage?: number | null;
  fingerprint?: string;
};

export type QuotePackOccurrence = QuoteOneTime & {
  date: string;
  time_start: string;
  time_end: string;
};

export type QrAsset = {
  id: string;
  label: string | null;
  signed_url: string | null;
  storage_path: string | null;
  download_url?: string | null;
};
