import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockBootstrap } from "../test/fixtures";
import CabinetScreen from "./CabinetScreen";

vi.mock("../hooks/useCabinetLiveRefresh", () => ({
  useCabinetLiveRefresh: () => undefined,
}));

vi.mock("../lib/rpc", () => ({
  rpcGetWallet: vi.fn().mockResolvedValue({
    pending_topup: null,
    has_awaiting_payment: false,
  }),
}));

vi.mock("../components/schedule/ScheduleTab", () => ({
  default: ({
    onOpenBooking,
    onTopup,
  }: {
    onOpenBooking: (booking: {
      locationId: string;
      date: string;
      start: string;
      packDays: string[];
    }) => void;
    onTopup: (amount: number) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onOpenBooking({
            locationId: "loc-1",
            date: "2026-09-10",
            start: "18:00",
            packDays: ["2026-09-10"],
          })
        }
      >
        open-booking
      </button>
      <button type="button" onClick={() => onTopup(500)}>
        schedule-topup
      </button>
    </div>
  ),
}));

vi.mock("../components/schedule/BookingSheet", () => ({
  default: ({ onTopup }: { onTopup: (amount: number) => void }) => (
    <div>
      <span>booking-open</span>
      <button type="button" onClick={() => onTopup(120)}>
        Пополнить 120
      </button>
    </div>
  ),
}));

vi.mock("../components/mine/MineTab", () => ({
  default: () => <div>mine-tab</div>,
}));

vi.mock("../components/mine/TopupSheet", () => ({
  default: ({
    initialAmount,
    closeLabel,
    onClose,
  }: {
    initialAmount: number;
    closeLabel: string;
    onClose: () => void;
  }) => (
    <div>
      <span>{`topup-sheet-${initialAmount}`}</span>
      <span>{closeLabel}</span>
      <button type="button" onClick={onClose}>
        close-topup
      </button>
    </div>
  ),
}));

describe("CabinetScreen top-up overlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens top-up over the booking form without switching to profile", async () => {
    const user = userEvent.setup();
    render(
      <CabinetScreen
        locale="ru"
        bootstrap={mockBootstrap}
        organizationId="org-1"
        supabase={{} as never}
      />
    );

    await user.click(screen.getByRole("button", { name: "open-booking" }));
    expect(screen.getByText("booking-open")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Пополнить 120" }));

    expect(screen.getByText("booking-open")).toBeTruthy();
    expect(screen.getByText("topup-sheet-120")).toBeTruthy();
    expect(screen.getByText("Назад к брони")).toBeTruthy();
    expect(screen.queryByText("mine-tab")).toBeNull();
    expect(screen.getByRole("tab", { name: "Расписание" }).getAttribute("aria-selected")).toBe(
      "true"
    );
  });

  it("keeps the schedule tab when topping up from the grid", async () => {
    const user = userEvent.setup();
    render(
      <CabinetScreen
        locale="ru"
        bootstrap={mockBootstrap}
        organizationId="org-1"
        supabase={{} as never}
      />
    );

    await user.click(screen.getByRole("button", { name: "schedule-topup" }));

    await waitFor(() => {
      expect(screen.getByText("topup-sheet-500")).toBeTruthy();
    });
    expect(screen.getByText("Закрыть")).toBeTruthy();
    expect(screen.queryByText("mine-tab")).toBeNull();
    expect(screen.getByRole("tab", { name: "Расписание" }).getAttribute("aria-selected")).toBe(
      "true"
    );
  });
});
