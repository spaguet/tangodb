import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as rpc from "../../lib/rpc";
import { mockBootstrap, makeRental, makeWallet } from "../../test/fixtures";
import MineTab from "./MineTab";

vi.mock("../../lib/rpc", () => ({
  rpcGetWallet: vi.fn(),
  rpcListMine: vi.fn(),
  rpcListActiveQr: vi.fn(),
  rpcGetRentalQrAccessUrl: vi.fn(),
  rpcSubmitTopup: vi.fn(),
  rpcUpdateProfile: vi.fn(),
  rpcAckOutboxSkipped: vi.fn(),
  rpcCancelOccurrence: vi.fn(),
  rpcCancelPack: vi.fn(),
  rpcDeleteHold: vi.fn(),
}));

vi.mock("../../lib/qrUrl", async () => {
  const actual = await vi.importActual<typeof import("../../lib/qrUrl")>("../../lib/qrUrl");
  return {
    ...actual,
    resolveOrgRentalQrUrl: vi.fn(async (_supabase: unknown, asset: { signed_url: string | null }) => {
      return asset.signed_url;
    }),
  };
});

const supabase = {} as never;

function mockLoadedMine(overrides?: {
  wallet?: ReturnType<typeof makeWallet>;
  bookings?: ReturnType<typeof makeRental>[];
}) {
  vi.mocked(rpc.rpcGetWallet).mockResolvedValue(overrides?.wallet ?? makeWallet());
  vi.mocked(rpc.rpcListMine).mockResolvedValue({
    items: overrides?.bookings ?? [],
    total: overrides?.bookings?.length ?? 0,
    limit: 20,
    offset: 0,
  });
  vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([]);
}

describe("MineTab stage B surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders pending top-up request card", async () => {
    mockLoadedMine({
      wallet: makeWallet({
        pending_topup: {
          id: "topup-1",
          amount: 1500,
          method: "cash",
          created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
          correlation_code: "TDB-TEST",
        },
      }),
    });

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByText("Заявка на пополнение")).toBeTruthy();
    });
    expect(screen.getByText(/1\s*500/)).toBeTruthy();
    expect(screen.getByText(/отправлена 10 мин назад/i)).toBeTruthy();
    expect(screen.getByText(/TDB-TEST/)).toBeTruthy();
  });

  it("prefills top-up amount from schedule CTA", async () => {
    mockLoadedMine();
    const onConsumed = vi.fn();

    const { rerender } = render(
      <MineTab
        locale="ru"
        bootstrap={mockBootstrap}
        supabase={supabase}
        refreshKey={0}
        topupPrefillAmount={null}
        onTopupPrefillConsumed={onConsumed}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Сумма/i)).toBeTruthy();
    });

    rerender(
      <MineTab
        locale="ru"
        bootstrap={mockBootstrap}
        supabase={supabase}
        refreshKey={0}
        topupPrefillAmount={250.5}
        onTopupPrefillConsumed={onConsumed}
      />
    );

    await waitFor(() => {
      expect((screen.getByPlaceholderText(/Сумма/i) as HTMLInputElement).value).toBe("250.50");
    });
    expect(onConsumed).toHaveBeenCalled();
  });

  it("shows undelivered Telegram notification summary", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcAckOutboxSkipped).mockResolvedValue();

    render(
      <MineTab
        locale="ru"
        bootstrap={{ ...mockBootstrap, undeliveredNotifications: 3 }}
        supabase={supabase}
        refreshKey={0}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Не доставлено уведомлений в Telegram: 3/i)).toBeTruthy();
    });
    expect(rpc.rpcAckOutboxSkipped).toHaveBeenCalled();
  });

  it("initializes profile fields from bootstrap", async () => {
    mockLoadedMine();

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByText("Профиль")).toBeTruthy();
    });

    await userEvent.click(screen.getByText("Профиль"));

    const profileSection = screen.getByText("Профиль").closest("details");
    expect(profileSection).toBeTruthy();
    const scope = within(profileSection!);

    await waitFor(() => {
      expect((scope.getByDisplayValue("Иван Тест") as HTMLInputElement).value).toBe("Иван Тест");
    });
    expect((scope.getByDisplayValue("+79001234567") as HTMLInputElement).value).toBe(
      "+79001234567"
    );
  });

  it("shows cancellation controls based on server can_cancel flags", async () => {
    mockLoadedMine({
      bookings: [
        makeRental({
          id: "hold-1",
          lifecycle: "awaiting_payment",
          hold_expires_at: "2026-09-03T15:00:00.000Z",
          can_delete_hold: true,
        }),
        makeRental({
          id: "occ-1",
          lifecycle: "active",
          can_cancel_occurrence: true,
        }),
        makeRental({
          id: "pack-1",
          rental_series_id: "series-1",
          lifecycle: "active",
          can_cancel_pack: true,
        }),
      ],
    });

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByText("Удалить холд")).toBeTruthy();
    });
    expect(screen.getByText("Отменить бронь")).toBeTruthy();
    expect(screen.getByText("Отменить пакет")).toBeTruthy();
  });

  it("blocks top-up submit while pending request exists", async () => {
    mockLoadedMine({
      wallet: makeWallet({
        pending_topup: {
          id: "topup-1",
          amount: 500,
          method: "qr",
          created_at: new Date().toISOString(),
          correlation_code: "TDB-PEND",
        },
      }),
    });

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Новая заявка недоступна, пока студия не обработает текущую/i)
      ).toBeTruthy();
    });

    const submit = screen.getByRole("button", { name: /Отправить заявку/i });
    expect(submit).toHaveProperty("disabled", true);
  });

  it("keeps QR preview visible when the active QR asset changes", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcListActiveQr)
      .mockResolvedValueOnce([
        {
          id: "qr-old",
          label: "Старый QR",
          signed_url: null,
          storage_path: "org/qr-old",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "qr-new",
          label: "Новый QR",
          signed_url: null,
          storage_path: "org/qr-new",
        },
      ]);
    vi.mocked(rpc.rpcGetRentalQrAccessUrl).mockImplementation(
      async (_supabase, id) => `https://qr.test/${id}.png`
    );

    const { rerender } = render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("Старый QR").getAttribute("src")).toBe("https://qr.test/qr-old.png");
    });

    rerender(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={1} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("Новый QR").getAttribute("src")).toBe("https://qr.test/qr-new.png");
    });
  });

  it("renders an inline data URL from the QR sign function", async () => {
    mockLoadedMine();
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "VietQR",
        signed_url: null,
        storage_path: "org/qr-1",
      },
    ]);
    vi.mocked(rpc.rpcGetRentalQrAccessUrl).mockResolvedValue(dataUrl);

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("VietQR").getAttribute("src")).toBe(dataUrl);
    });
  });

  it("shows a broken QR message instead of spinning forever when sign fails", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "QR студии",
        signed_url: null,
        storage_path: "org/qr-1",
      },
    ]);
    vi.mocked(rpc.rpcGetRentalQrAccessUrl).mockResolvedValue(null);

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Не удалось показать QR/i)).toBeTruthy();
    });
    expect(screen.queryByText("Загрузка…")).toBeNull();
  });
});
