import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import {
  btnDestructiveOpenCls,
  btnPrimaryCls,
  btnSecondaryCls,
  fieldCls,
  labelCls,
  panelCls,
  sectionTitleCls,
} from "../../lib/crmUi";
import { formatMoney, holdCountdown } from "../../lib/format";
import { formatShortDate, formatTimeRange } from "../../lib/orgTime";
import {
  rpcCancelOccurrence,
  rpcCancelPack,
  rpcDeleteHold,
  rpcGetRentalQrAccessUrl,
  rpcGetWallet,
  rpcListActiveQr,
  rpcListMine,
  rpcSubmitTopup,
  rpcUpdateProfile,
} from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import { qrDownloadFilename, resolveOrgRentalQrUrl } from "../../lib/qrUrl";
import { copyText, downloadQrToDevice, openStudioChat, topupDraftMessage } from "../../lib/studioChat";
import type { QrAsset, RentalItem, WalletData } from "../../lib/types";
import { t, type Locale } from "../../i18n/strings";

const PAGE = 20;

type MineTabProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  supabase: SupabaseClient;
  refreshKey: number;
};

export default function MineTab({ locale, bootstrap, supabase, refreshKey }: MineTabProps) {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [bookings, setBookings] = useState<RentalItem[]>([]);
  const [bookingsTotal, setBookingsTotal] = useState(0);
  const [bookingsOffset, setBookingsOffset] = useState(0);
  const [qrs, setQrs] = useState<QrAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const [topupAmount, setTopupAmount] = useState("");
  const [topupMethod, setTopupMethod] = useState<"qr" | "cash">("cash");
  const [topupQrId, setTopupQrId] = useState("");
  const [topupMsg, setTopupMsg] = useState<string | null>(null);
  const [receiptSent, setReceiptSent] = useState(false);
  const [chatOpened, setChatOpened] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const resolveQrAssetUrl = useCallback(
    async (asset: QrAsset): Promise<string | null> => {
      const viaFunction = await rpcGetRentalQrAccessUrl(supabase, asset.id);
      if (viaFunction) return viaFunction;
      return resolveOrgRentalQrUrl(supabase, asset);
    },
    [supabase]
  );

  const load = useCallback(async () => {
    setError(null);
    const [w, b] = await Promise.all([
      rpcGetWallet(supabase, PAGE, 0),
      rpcListMine(supabase, PAGE, bookingsOffset),
    ]);
    setWallet(w);
    setBookings(b.items);
    setBookingsTotal(b.total);
    if (bootstrap.addonActive) {
      try {
        const assets = await rpcListActiveQr(supabase);
        const resolved = await Promise.all(
          assets.map(async (asset) => ({
            ...asset,
            signed_url: await resolveQrAssetUrl(asset),
          }))
        );
        setQrs(resolved);
        if (resolved[0]) setTopupQrId((prev) => prev || resolved[0].id);
      } catch {
        setQrs([]);
      }
    }
  }, [supabase, bookingsOffset, bootstrap.addonActive, resolveQrAssetUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (err) {
        if (!cancelled) setError(t(locale, rpcErrorKey(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, locale, refreshKey]);

  const loadMoreBookings = async () => {
    const next = bookingsOffset + PAGE;
    try {
      const b = await rpcListMine(supabase, PAGE, next);
      setBookings((prev) => [...prev, ...b.items]);
      setBookingsOffset(next);
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    }
  };

  const onDeleteHold = async (id: string) => {
    setActionId(id);
    try {
      await rpcDeleteHold(supabase, id);
      await load();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setActionId(null);
    }
  };

  const onCancel = async (id: string) => {
    setActionId(id);
    try {
      await rpcCancelOccurrence(supabase, id);
      await load();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setActionId(null);
    }
  };

  const onCancelPack = async (seriesId: string) => {
    setActionId(seriesId);
    try {
      await rpcCancelPack(supabase, seriesId);
      await load();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setActionId(null);
    }
  };

  const draftForAmount = (amountLabel: string) =>
    topupDraftMessage({ locale, amountLabel, method: topupMethod });

  const refreshQrUrl = useCallback(
    async (asset: QrAsset): Promise<string | null> => {
      const next = await resolveQrAssetUrl(asset);
      setQrs((prev) => prev.map((item) => (item.id === asset.id ? { ...item, signed_url: next } : item)));
      return next;
    },
    [resolveQrAssetUrl]
  );

  const openChatWithDraft = async (amountLabel: string) => {
    const url = bootstrap.chatUrl;
    if (!url) {
      setError(t(locale, "topupNeedChat"));
      return;
    }
    const copied = await copyText(draftForAmount(amountLabel));
    openStudioChat(url);
    setChatOpened(true);
    setTopupMsg(copied ? t(locale, "topupCopied") : t(locale, "topupReceiptHint"));
  };

  const submitTopup = async () => {
    setTopupMsg(null);
    setError(null);
    const amount = Number(topupAmount.replace(",", "."));
    const amountLabel = Number.isFinite(amount)
      ? formatMoney(amount, bootstrap.currencyCode, locale)
      : topupAmount;
    if (topupMethod === "qr" && !bootstrap.chatUrl) {
      setError(t(locale, "topupNeedChat"));
      return;
    }
    if (bootstrap.chatUrl && (!receiptSent || !chatOpened)) {
      setError(t(locale, "topupNeedReceipt"));
      return;
    }
    try {
      await rpcSubmitTopup(supabase, {
        amount,
        method: topupMethod,
        ...(topupMethod === "qr" ? { qr_asset_id: topupQrId } : {}),
      });
      setTopupMsg(t(locale, "topupSuccess"));
      setTopupAmount("");
      setReceiptSent(false);
      await load();
      if (bootstrap.chatUrl) {
        await copyText(draftForAmount(amountLabel));
        openStudioChat(bootstrap.chatUrl);
      }
    } catch (err) {
      const key = rpcErrorKey(err);
      setError(t(locale, key));
      if (key === "topupPendingExists" && bootstrap.chatUrl) {
        await openChatWithDraft(amountLabel);
      }
    }
  };

  const saveProfile = async () => {
    setProfileMsg(null);
    setError(null);
    try {
      await rpcUpdateProfile(supabase, displayName.trim(), phone.trim() || null);
      setProfileMsg(t(locale, "profileSaved"));
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    }
  };

  if (loading && !wallet) {
    return (
      <div className="flex justify-center bg-slate-50 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  const currency = bootstrap.currencyCode;
  const debt = wallet?.debt_amount ?? 0;
  const seenSeries = new Set<string>();

  const methodActiveCls = "bg-indigo-600 text-white border border-indigo-600";
  const methodIdleCls = "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50";

  return (
    <div className="flex flex-col gap-4 bg-slate-50 px-4 pb-8 pt-3 text-slate-800">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {wallet ? (
        <section className={`${panelCls} space-y-2 p-3 text-sm`}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className={labelCls}>{t(locale, "walletBalance")}</p>
              <p className="font-semibold text-slate-800">
                {formatMoney(wallet.wallet_balance, currency, locale)}
              </p>
            </div>
            <div>
              <p className={labelCls}>{t(locale, "spendable")}</p>
              <p className="font-semibold text-slate-800">
                {formatMoney(wallet.spendable, currency, locale)}
              </p>
            </div>
            <div>
              <p className={labelCls}>{t(locale, "reservedPrepay")}</p>
              <p className="text-slate-700">{formatMoney(wallet.reserved_prepay, currency, locale)}</p>
            </div>
            <div>
              <p className={labelCls}>{t(locale, "debt")}</p>
              <p className={debt > 0 ? "font-semibold text-rose-600" : "text-slate-700"}>
                {formatMoney(debt, currency, locale)}
              </p>
            </div>
          </div>
          {debt > 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-900">
              {t(locale, "debtWarning")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className={sectionTitleCls}>{t(locale, "tabMine")}</h2>
        {bookings.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, "noBookings")}</p>
        ) : (
          bookings.map((r) => {
            const seriesId = r.rental_series_id;
            const showPackCancel =
              seriesId && !seenSeries.has(seriesId) ? (seenSeries.add(seriesId), true) : false;
            return (
              <RentalCard
                key={r.id}
                locale={locale}
                rental={r}
                currency={currency}
                busy={actionId === r.id || actionId === (r.rental_series_id ?? "")}
                onDeleteHold={() => void onDeleteHold(r.id)}
                onCancel={() => void onCancel(r.id)}
                onCancelPack={
                  showPackCancel && seriesId ? () => void onCancelPack(seriesId) : undefined
                }
              />
            );
          })
        )}
        {bookings.length < bookingsTotal ? (
          <button type="button" className={`w-full ${btnSecondaryCls}`} onClick={() => void loadMoreBookings()}>
            {t(locale, "loadMore")}
          </button>
        ) : null}
      </section>

      <section className={`${panelCls} space-y-3 p-3`}>
        <h2 className={sectionTitleCls}>{t(locale, "topup")}</h2>
        {!bootstrap.addonActive ? (
          <p className="text-xs text-slate-500">{t(locale, "addonInactiveTopup")}</p>
        ) : (
          <>
            <input
              type="number"
              inputMode="decimal"
              className={fieldCls}
              placeholder={t(locale, "topupAmount")}
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                  topupMethod === "cash" ? methodActiveCls : methodIdleCls
                }`}
                onClick={() => setTopupMethod("cash")}
              >
                {t(locale, "topupMethodCash")}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                  topupMethod === "qr" ? methodActiveCls : methodIdleCls
                }`}
                onClick={() => setTopupMethod("qr")}
                disabled={qrs.length === 0}
              >
                {t(locale, "topupMethodQr")}
              </button>
            </div>
            {topupMethod === "qr" && qrs.length > 0 ? (
              <select className={fieldCls} value={topupQrId} onChange={(e) => setTopupQrId(e.target.value)}>
                {qrs.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label ?? q.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            ) : null}
            {topupMethod === "qr" && qrs.length === 0 ? (
              <p className="text-xs text-slate-500">{t(locale, "topupNoQr")}</p>
            ) : null}
            {qrs.map((q) =>
              topupMethod === "qr" && q.id === topupQrId ? (
                <StudioQrPreview
                  key={q.id}
                  locale={locale}
                  asset={q}
                  refreshUrl={refreshQrUrl}
                  onSaved={() => setTopupMsg(t(locale, "topupQrSaved"))}
                />
              ) : null
            )}
            <p className="text-xs leading-relaxed text-slate-600">
              {t(locale, topupMethod === "qr" ? "topupReceiptHint" : "topupCashHint")}
            </p>
            {bootstrap.chatUrl ? (
              <>
                <button
                  type="button"
                  className={`w-full ${btnPrimaryCls}`}
                  onClick={() => {
                    const amount = Number(topupAmount.replace(",", "."));
                    const amountLabel = Number.isFinite(amount) && amount > 0
                      ? formatMoney(amount, currency, locale)
                      : topupAmount.trim() || t(locale, "topupAmount");
                    void openChatWithDraft(amountLabel);
                  }}
                >
                  {t(locale, "topupOpenChat")}
                </button>
                <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={receiptSent}
                    onChange={(e) => setReceiptSent(e.target.checked)}
                  />
                  <span>{t(locale, "topupReceiptCheck")}</span>
                </label>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-amber-800">{t(locale, "topupNeedChat")}</p>
            )}
            <button
              type="button"
              className={`w-full ${btnSecondaryCls}`}
              onClick={() => void submitTopup()}
            >
              {t(locale, "topupSubmit")}
            </button>
            {topupMsg ? <p className="text-xs font-medium text-indigo-600">{topupMsg}</p> : null}
          </>
        )}
      </section>

      <section className={`${panelCls} space-y-3 p-3`}>
        <h2 className={sectionTitleCls}>{t(locale, "profile")}</h2>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t(locale, "displayName")}</span>
          <input className={fieldCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t(locale, "phone")}</span>
          <input
            className={fieldCls}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
          />
        </label>
        <button type="button" className={`w-full ${btnSecondaryCls}`} onClick={() => void saveProfile()}>
          {t(locale, "saveProfile")}
        </button>
        {profileMsg ? <p className="text-xs font-medium text-indigo-600">{profileMsg}</p> : null}
      </section>
    </div>
  );
}

type RentalCardProps = {
  locale: Locale;
  rental: RentalItem;
  currency: string;
  busy: boolean;
  onDeleteHold: () => void;
  onCancel: () => void;
  onCancelPack?: () => void;
};

function RentalCard({
  locale,
  rental,
  currency,
  busy,
  onDeleteHold,
  onCancel,
  onCancelPack,
}: RentalCardProps) {
  const isHold = rental.lifecycle === "awaiting_payment";
  const canDeleteHold = isHold;
  const canCancel = !isHold && ["active", "prepaid_charged"].includes(rental.lifecycle);
  const countdown = isHold ? holdCountdown(rental.hold_expires_at) : null;
  const isPack = Boolean(rental.rental_series_id);

  return (
    <div
      className={`rounded-xl border p-3 text-sm space-y-2 shadow-xs ${
        isHold
          ? "slot-hold border-slate-300 text-slate-800"
          : "border-slate-200 bg-white border-l-4 border-l-indigo-600"
      }`}
    >
      <div className="flex justify-between gap-2">
        <span className="font-medium text-slate-800">
          {formatShortDate(rental.rental_date, locale === "en" ? "en" : "ru")}
        </span>
        <span className="text-slate-600">{formatTimeRange(rental.time_start, rental.time_end)}</span>
      </div>
      <p className="text-xs text-slate-500">{rental.lifecycle}</p>
      {rental.fixed_amount != null ? (
        <p className="text-xs font-medium text-slate-700">
          {formatMoney(rental.fixed_amount, rental.currency ?? currency, locale)}
        </p>
      ) : null}
      {countdown ? (
        <p className="text-xs font-medium text-amber-800">
          {t(locale, "holdExpires")}: {countdown}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canDeleteHold ? (
          <button type="button" disabled={busy} className={btnSecondaryCls} onClick={onDeleteHold}>
            {t(locale, "deleteHold")}
          </button>
        ) : null}
        {canCancel ? (
          <button type="button" disabled={busy} className={btnSecondaryCls} onClick={onCancel}>
            {t(locale, "cancelBooking")}
          </button>
        ) : null}
        {isPack && onCancelPack ? (
          <button type="button" disabled={busy} className={btnDestructiveOpenCls} onClick={onCancelPack}>
            {t(locale, "cancelPack")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

type StudioQrPreviewProps = {
  locale: Locale;
  asset: QrAsset;
  refreshUrl: (asset: QrAsset) => Promise<string | null>;
  onSaved: () => void;
};

function StudioQrPreview({ locale, asset, refreshUrl, onSaved }: StudioQrPreviewProps) {
  const [src, setSrc] = useState<string | null>(asset.signed_url);
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [retryAfterError, setRetryAfterError] = useState(false);

  useEffect(() => {
    setSrc(asset.signed_url);
    setRetryAfterError(false);
  }, [asset.id, asset.signed_url]);

  const ensureUrl = useCallback(async () => {
    setLoadingSrc(true);
    try {
      const next = await refreshUrl(asset);
      setSrc(next);
      return next;
    } finally {
      setLoadingSrc(false);
    }
  }, [asset, refreshUrl]);

  useEffect(() => {
    if (src || loadingSrc) return;
    void ensureUrl();
  }, [src, loadingSrc, ensureUrl]);

  const saveQr = async () => {
    const downloadUrl = src ?? (await ensureUrl());
    if (!downloadUrl) return;
    const ok = await downloadQrToDevice(downloadUrl, qrDownloadFilename(asset.label, asset.id));
    if (ok) onSaved();
  };

  const handleImageError = () => {
    if (retryAfterError) {
      setSrc(null);
      return;
    }
    setRetryAfterError(true);
    void ensureUrl();
  };

  return (
    <div className="space-y-2">
      {src ? (
        <img
          src={src}
          alt={asset.label ?? t(locale, "topupMethodQr")}
          className="mx-auto max-h-48 w-auto rounded-lg border border-slate-200 bg-white p-2"
          onError={handleImageError}
        />
      ) : loadingSrc ? (
        <p className="text-xs text-slate-500">{t(locale, "loading")}</p>
      ) : (
        <p className="text-xs text-amber-800">{t(locale, "topupQrBroken")}</p>
      )}
      <button type="button" className={`w-full ${btnSecondaryCls}`} onClick={() => void saveQr()}>
        {t(locale, "topupSaveQr")}
      </button>
    </div>
  );
}
