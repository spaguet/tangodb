import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as rpc from "../../lib/rpc";
import * as qrUrl from "../../lib/qrUrl";
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
    resolveOrgRentalQrUrl: vi.fn(async (_supabase: unknown, asset: { storage_path: string | null }) => {
      if (!asset.storage_path) return null;
      return `https://example.supabase.co/storage/v1/object/sign/org-rental-qr/${asset.storage_path}`;
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
    vi.mocked(qrUrl.resolveOrgRentalQrUrl).mockImplementation(
      async (_supabase: unknown, asset: { storage_path: string | null }) => {
        if (!asset.storage_path) return null;
        return `https://example.supabase.co/storage/v1/object/sign/org-rental-qr/${asset.storage_path}`;
      }
    );
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
    vi.mocked(rpc.rpcGetRentalQrAccessUrl).mockImplementation(async (_supabase, id) => {
      const url = `https://qr.test/${id}.png`;
      return { displaySrc: url, downloadUrl: url };
    });

    const { rerender } = render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("Старый QR").getAttribute("src")).toBe(
        "https://example.supabase.co/storage/v1/object/sign/org-rental-qr/org/qr-old"
      );
    });

    rerender(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={1} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("Новый QR").getAttribute("src")).toBe(
        "https://example.supabase.co/storage/v1/object/sign/org-rental-qr/org/qr-new"
      );
    });
  });

  it("renders the studio Storage signed URL from storage_path", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "VietQR",
        signed_url: null,
        storage_path: "org/qr-1",
      },
    ]);

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("VietQR").getAttribute("src")).toBe(
        "https://example.supabase.co/storage/v1/object/sign/org-rental-qr/org/qr-1"
      );
    });
    expect(rpc.rpcGetRentalQrAccessUrl).not.toHaveBeenCalled();
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
    vi.mocked(qrUrl.resolveOrgRentalQrUrl).mockResolvedValue(null);

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Не удалось показать QR/i)).toBeTruthy();
    });
    expect(screen.queryByText("Загрузка…")).toBeNull();
  });

  it("ignores SQL signed_url from RPC and uses storage_path only", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "VietQR",
        signed_url: "https://bogus.example/generated-qr.png",
        storage_path: "org/qr-1",
      },
    ]);

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("VietQR").getAttribute("src")).toBe(
        "https://example.supabase.co/storage/v1/object/sign/org-rental-qr/org/qr-1"
      );
    });
    expect(rpc.rpcGetRentalQrAccessUrl).not.toHaveBeenCalled();
  });

  it("prefers Storage signed URL over Edge data URL", async () => {
    mockLoadedMine();
    const storageSigned = "https://example.supabase.co/storage/v1/object/sign/org-rental-qr/real.png";
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "VietQR",
        signed_url: null,
        storage_path: "org/qr-1",
      },
    ]);
    vi.mocked(rpc.rpcGetRentalQrAccessUrl).mockResolvedValue({
      displaySrc: "data:image/png;base64,AAAA",
      downloadUrl: null,
    });
    vi.mocked(qrUrl.resolveOrgRentalQrUrl).mockResolvedValue(storageSigned);

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("VietQR").getAttribute("src")).toBe(storageSigned);
    });
    expect(rpc.rpcGetRentalQrAccessUrl).not.toHaveBeenCalled();
  });

  it("falls back to Edge sign when Storage signing fails", async () => {
    mockLoadedMine();
    const edgeSigned = "https://example.supabase.co/storage/v1/object/sign/org-rental-qr/edge.png";
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "VietQR",
        signed_url: null,
        storage_path: "org/qr-1",
      },
    ]);
    vi.mocked(qrUrl.resolveOrgRentalQrUrl).mockResolvedValue(null);
    vi.mocked(rpc.rpcGetRentalQrAccessUrl).mockResolvedValue({
      displaySrc: edgeSigned,
      downloadUrl: edgeSigned,
    });

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("VietQR").getAttribute("src")).toBe(edgeSigned);
    });
  });

  it("shows hint when submitting top-up without amount", async () => {
    mockLoadedMine();
    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Отправить заявку/i })).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: /Отправить заявку/i }));

    await waitFor(() => {
      expect(screen.getByText(/Укажите сумму для пополнения баланса/i)).toBeTruthy();
    });
    expect(rpc.rpcSubmitTopup).not.toHaveBeenCalled();
  });

  it("shows popup after successful top-up submit", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcSubmitTopup).mockResolvedValue({
      id: "topup-1",
      amount: 250000,
      correlation_code: "TDB-ABC",
    });

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Сумма/i)).toBeTruthy();
    });

    await userEvent.type(screen.getByPlaceholderText(/Сумма/i), "250000");
    await userEvent.click(screen.getByRole("button", { name: /Отправить заявку/i }));

    await waitFor(() => {
      expect(screen.getByText("Заявка отправлена")).toBeTruthy();
    });
    expect(screen.getByText(/TDB-ABC/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Отправить чек/i })).toBeTruthy();
    expect(rpc.rpcSubmitTopup).toHaveBeenCalledWith(supabase, {
      amount: 250000,
      method: "cash",
    });
  });

  it("submits QR top-up with qr_asset_id when QR is auto-selected", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "VietQR",
        signed_url: null,
        storage_path: "org/qr-1",
      },
    ]);
    vi.mocked(rpc.rpcSubmitTopup).mockResolvedValue({
      id: "topup-qr",
      amount: 1000,
      correlation_code: "TDB-QR1",
    });

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("VietQR")).toBeTruthy();
    });

    await userEvent.type(screen.getByPlaceholderText(/Сумма/i), "1000");
    await userEvent.click(screen.getByRole("button", { name: /Отправить заявку/i }));

    await waitFor(() => {
      expect(screen.getByText("Заявка отправлена")).toBeTruthy();
    });
    expect(rpc.rpcSubmitTopup).toHaveBeenCalledWith(supabase, {
      amount: 1000,
      method: "qr",
      qr_asset_id: "qr-1",
    });
  });

  it("submits QR top-up after switching cash → QR студии", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "VietQR",
        signed_url: null,
        storage_path: "org/qr-1",
      },
    ]);
    vi.mocked(rpc.rpcSubmitTopup).mockResolvedValue({
      id: "topup-qr",
      amount: 500,
      correlation_code: "TDB-QR2",
    });

    render(
      <MineTab locale="ru" bootstrap={mockBootstrap} supabase={supabase} refreshKey={0} />
    );

    await waitFor(() => {
      expect(screen.getByAltText("VietQR")).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: /Наличные/i }));
    await userEvent.click(screen.getByRole("button", { name: /QR студии/i }));
    await userEvent.type(screen.getByPlaceholderText(/Сумма/i), "500");
    await userEvent.click(screen.getByRole("button", { name: /Отправить заявку/i }));

    await waitFor(() => {
      expect(rpc.rpcSubmitTopup).toHaveBeenCalledWith(supabase, {
        amount: 500,
        method: "qr",
        qr_asset_id: "qr-1",
      });
    });
  });

  it("submits VND top-up above legacy 1M cap when bootstrap allows it", async () => {
    mockLoadedMine();
    vi.mocked(rpc.rpcListActiveQr).mockResolvedValue([
      {
        id: "qr-1",
        label: "VietQR",
        signed_url: null,
        storage_path: "org/qr-1",
      },
    ]);
    vi.mocked(rpc.rpcSubmitTopup).mockResolvedValue({
      id: "topup-vnd",
      amount: 2_400_000,
      correlation_code: "TDB-VND",
    });

    render(
      <MineTab
        locale="ru"
        bootstrap={{
          ...mockBootstrap,
          currencyCode: "VND",
          topupMaxAmount: 100_000_000,
        }}
        supabase={supabase}
        refreshKey={0}
      />
    );

    await waitFor(() => {
      expect(screen.getByAltText("VietQR")).toBeTruthy();
    });

    await userEvent.type(screen.getByPlaceholderText(/Сумма/i), "2400000");
    await userEvent.click(screen.getByRole("button", { name: /Отправить заявку/i }));

    await waitFor(() => {
      expect(rpc.rpcSubmitTopup).toHaveBeenCalledWith(supabase, {
        amount: 2_400_000,
        method: "qr",
        qr_asset_id: "qr-1",
      });
    });
  });
});
