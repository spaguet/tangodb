import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as rpc from "../../lib/rpc";
import { mockBootstrap, makeWallet } from "../../test/fixtures";
import PackSheet from "./PackSheet";

vi.mock("../../lib/rpc", () => ({
  rpcGetWallet: vi.fn(),
  rpcQuotePack: vi.fn(),
  rpcCreatePack: vi.fn(),
}));

const supabase = {} as never;
const packDays = ["2026-09-07", "2026-09-08", "2026-09-09"];

const occurrence = {
  kind: "pack_occurrence",
  date: "2026-09-07",
  time_start: "18:00",
  time_end: "20:00",
  hours: 2,
  rate: 500,
  cost: 1000,
  prepay: 500,
  remainder: 500,
  currency: "RUB",
  busy: false,
  can_create: true,
};

describe("PackSheet weekday form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rpc.rpcGetWallet).mockResolvedValue(makeWallet());
    vi.mocked(rpc.rpcQuotePack).mockResolvedValue({
      kind: "pack",
      valid_from: packDays[0],
      valid_to: "2026-10-04",
      occurrences: [occurrence],
      can_create: true,
    });
  });

  it("blocks submit when first date weekday is deselected", async () => {
    render(
      <PackSheet
        locale="ru"
        bootstrap={mockBootstrap}
        organizationId="org-1"
        supabase={supabase}
        locationId="loc-1"
        days={packDays}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onTopup={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Стоимость/i)).toBeTruthy();
    });

    // 2026-09-07 is Monday — deselect Mon button
    await userEvent.click(screen.getByRole("button", { name: "Пн" }));

    expect(
      screen.getByText("Дата первого занятия должна попадать в выбранные дни недели.")
    ).toBeTruthy();

    const confirm = screen.getByRole("button", { name: /Подтвердить бронь/i });
    expect(confirm).toHaveProperty("disabled", true);
  });

  it("includes weekday when valid_from changes to a new day", async () => {
    render(
      <PackSheet
        locale="ru"
        bootstrap={mockBootstrap}
        organizationId="org-1"
        supabase={supabase}
        locationId="loc-1"
        days={packDays}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onTopup={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Стоимость/i)).toBeTruthy();
    });

    const select = screen.getByDisplayValue("2026-09-07");
    await userEvent.selectOptions(select, "2026-09-08");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Вт" }).className).toMatch(/indigo-600/);
    });
    expect(screen.queryByText(/должна попадать в выбранные дни/i)).toBeNull();
  });

  it("shows hold result after pack create", async () => {
    vi.mocked(rpc.rpcGetWallet).mockResolvedValue(
      makeWallet({ wallet_balance: 0, spendable: 0, reserved_prepay: 0 })
    );
    vi.mocked(rpc.rpcCreatePack).mockResolvedValue({
      series_id: "series-1",
      series_status: "awaiting_payment",
      hold_expires_at: "2026-09-08T15:00:00.000Z",
      occurrence_count: 3,
    });

    render(
      <PackSheet
        locale="ru"
        bootstrap={mockBootstrap}
        organizationId="org-1"
        supabase={supabase}
        locationId="loc-1"
        days={packDays}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onTopup={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Стоимость/i)).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: /Подтвердить бронь/i }));

    await waitFor(() => {
      expect(screen.getByText(/Пакет создан/i)).toBeTruthy();
      expect(screen.getByText(/Пополнить/i)).toBeTruthy();
    });
  });
});
