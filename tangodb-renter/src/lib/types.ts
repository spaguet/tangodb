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
};

export type WalletData = {
  wallet_balance: number;
  spendable: number;
  reserved_prepay: number;
  debt_amount: number;
  entries: Array<{
    id: string;
    entry_type: string;
    amount: number;
    rental_id: string | null;
    phase: string | null;
    created_at: string;
  }>;
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
};
