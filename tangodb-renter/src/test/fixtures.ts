import type { BootstrapData } from "../lib/auth";
import type { RentalItem, WalletData } from "../lib/types";

export const mockBootstrap: BootstrapData = {
  studioName: "Test Studio",
  timezone: "Europe/Moscow",
  currencyCode: "RUB",
  locale: "ru",
  chatUrl: "https://t.me/teststudio",
  botUrl: "https://t.me/testbot",
  addonActive: true,
  botStarted: true,
  allowsWrite: true,
  displayName: "Иван Тест",
  contactPhone: "+79001234567",
  bookingBanned: false,
  serverNow: "2026-09-03T12:00:00.000Z",
  undeliveredNotifications: 0,
  topupMaxAmount: 1_000_000,
};

export function makeWallet(overrides: Partial<WalletData> = {}): WalletData {
  return {
    wallet_balance: 500,
    spendable: 500,
    reserved_prepay: 0,
    debt_amount: 0,
    pending_topup: null,
    has_awaiting_payment: false,
    entries: [],
    total: 0,
    limit: 20,
    offset: 0,
    ...overrides,
  };
}

export function makeRental(overrides: Partial<RentalItem> = {}): RentalItem {
  return {
    id: "rental-1",
    rental_series_id: null,
    location_id: "loc-1",
    rental_date: "2026-09-10",
    time_start: "18:00",
    time_end: "20:00",
    channel: "miniapp",
    lifecycle: "active",
    booking_status: "confirmed",
    hold_expires_at: null,
    prepay_amount: 500,
    remainder_amount: 500,
    debt_amount: null,
    fixed_amount: 1000,
    currency: "RUB",
    prepay_charged_at: null,
    remainder_charged_at: null,
    can_delete_hold: false,
    can_cancel_occurrence: false,
    can_cancel_pack: false,
    ...overrides,
  };
}
