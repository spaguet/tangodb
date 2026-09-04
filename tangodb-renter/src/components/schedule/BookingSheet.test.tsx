import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as rpc from "../../lib/rpc";
import { makeWallet } from "../../test/fixtures";
import BookingSheet from "./BookingSheet";

vi.mock("../../lib/rpc", () => ({
  rpcGetWallet: vi.fn(),
  rpcQuoteOneTime: vi.fn(),
  rpcCreateBooking: vi.fn(),
}));

const supabase = {} as never;

const baseQuote = {
  kind: "one_time",
  hours: 2,
  rate: 500,
  cost: 1000,
  prepay: 500,
  remainder: 500,
  currency: "RUB",
  busy: false,
  can_create: true,
};

describe("BookingSheet booking result", () => {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const onTopup = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rpc.rpcGetWallet).mockResolvedValue(makeWallet({ spendable: 50 }));
    vi.mocked(rpc.rpcQuoteOneTime).mockResolvedValue(baseQuote);
  });

  it("shows result screen with top-up CTA after hold booking is created", async () => {
    vi.mocked(rpc.rpcCreateBooking).mockResolvedValue({
      rental: {
        id: "rental-new",
        rental_series_id: null,
        location_id: "loc-1",
        rental_date: "2026-09-10",
        time_start: "18:00",
        time_end: "20:00",
        channel: "miniapp",
        lifecycle: "awaiting_payment",
        booking_status: "pending",
        hold_expires_at: "2026-09-03T15:00:00.000Z",
        prepay_amount: 500,
        remainder_amount: 500,
        debt_amount: null,
        fixed_amount: 1000,
        currency: "RUB",
        prepay_charged_at: null,
        remainder_charged_at: null,
      },
    });

    render(
      <BookingSheet
        locale="ru"
        timezone="Europe/Moscow"
        serverNow="2026-09-03T12:00:00.000Z"
        organizationId="org-1"
        supabase={supabase}
        locationId="loc-1"
        date="2026-09-10"
        defaultStart="18:00"
        onClose={onClose}
        onDone={onDone}
        onTopup={onTopup}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Стоимость/i)).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));

    await waitFor(() => {
      expect(screen.getByText("Бронь создана")).toBeTruthy();
    });

    const topupBtn = screen.getByRole("button", { name: /Пополнить/i });
    await userEvent.click(topupBtn);
    expect(onTopup).toHaveBeenCalledWith(450);
    expect(onDone).toHaveBeenCalled();
  });

  it("shows active booking message when lifecycle is active", async () => {
    vi.mocked(rpc.rpcCreateBooking).mockResolvedValue({
      rental: {
        id: "rental-active",
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
        prepay_charged_at: "2026-09-03T12:00:00.000Z",
        remainder_charged_at: null,
      },
    });

    render(
      <BookingSheet
        locale="ru"
        timezone="Europe/Moscow"
        serverNow="2026-09-03T12:00:00.000Z"
        organizationId="org-1"
        supabase={supabase}
        locationId="loc-1"
        date="2026-09-10"
        defaultStart="18:00"
        onClose={onClose}
        onDone={onDone}
        onTopup={onTopup}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Подтвердить/i })).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));

    await waitFor(() => {
      expect(screen.getByText(/Бронь активна/i)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Пополнить/i })).toBeNull();
  });
});
