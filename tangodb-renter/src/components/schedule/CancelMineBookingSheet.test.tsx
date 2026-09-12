import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as rpc from "../../lib/rpc";
import type { MineSlot } from "../../lib/types";
import CancelMineBookingSheet from "./CancelMineBookingSheet";

vi.mock("../../lib/rpc", () => ({
  rpcDeleteHold: vi.fn(),
  rpcCancelOccurrence: vi.fn(),
}));

const supabase = {} as never;

function slot(overrides: Partial<MineSlot> = {}): MineSlot {
  return {
    id: "mine-1",
    date: "2026-09-14",
    time_start: "14:00",
    time_end: "16:00",
    lifecycle: "active",
    ...overrides,
  };
}

describe("CancelMineBookingSheet", () => {
  const onClose = vi.fn();
  const onDone = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rpc.rpcDeleteHold).mockResolvedValue();
    vi.mocked(rpc.rpcCancelOccurrence).mockResolvedValue();
  });

  it("cancels an unpaid hold", async () => {
    const user = userEvent.setup();
    render(
      <CancelMineBookingSheet
        locale="ru"
        timezone="Europe/Moscow"
        serverNow="2026-09-10T08:00:00.000Z"
        supabase={supabase}
        slot={slot({ lifecycle: "awaiting_payment" })}
        onClose={onClose}
        onDone={onDone}
      />
    );

    expect(screen.getByText(/Неоплаченный холд/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Отменить бронь" }));
    expect(rpc.rpcDeleteHold).toHaveBeenCalledWith(supabase, "mine-1");
    expect(onDone).toHaveBeenCalled();
  });

  it("cancels a paid booking with reserved funds returning to spendable", async () => {
    const user = userEvent.setup();
    render(
      <CancelMineBookingSheet
        locale="ru"
        timezone="Europe/Moscow"
        serverNow="2026-09-10T08:00:00.000Z"
        supabase={supabase}
        slot={slot({ lifecycle: "active" })}
        onClose={onClose}
        onDone={onDone}
      />
    );

    expect(screen.getByText(/Зарезервированные средства вернутся/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Отменить бронь" }));
    expect(rpc.rpcCancelOccurrence).toHaveBeenCalledWith(supabase, "mine-1");
    expect(onDone).toHaveBeenCalled();
  });

  it("warns that prepay is retained inside 24 hours", () => {
    render(
      <CancelMineBookingSheet
        locale="ru"
        timezone="Europe/Moscow"
        serverNow="2026-09-14T10:00:00.000Z"
        supabase={supabase}
        slot={slot({ lifecycle: "prepaid_charged" })}
        onClose={onClose}
        onDone={onDone}
      />
    );

    expect(screen.getByText(/студия удержит предоплату/)).toBeTruthy();
  });

  it("hides confirm for a started or debt slot", () => {
    render(
      <CancelMineBookingSheet
        locale="ru"
        timezone="Europe/Moscow"
        serverNow="2026-09-14T12:00:00.000Z"
        supabase={supabase}
        slot={slot({ lifecycle: "debt" })}
        onClose={onClose}
        onDone={onDone}
      />
    );

    expect(screen.getByText(/нельзя отменить/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отменить бронь" })).toBeNull();
  });
});
