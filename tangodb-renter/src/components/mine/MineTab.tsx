import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatMoney } from "../../lib/format";
import { formatRequestAge } from "../../lib/cabinetRefresh";
import { useHoldCountdown } from "../../hooks/useServerClock";
import { miniAppLifecycleKey, isAwaitingPaymentHold } from "../../lib/lifecycle";
import { groupMineBookings, isPackOnHold, packHoldExpiresAt } from "../../lib/packSeriesTimeline";
import { formatShortDate, formatTimeRange } from "../../lib/orgTime";
import {
  rpcAckOutboxSkipped,
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
import { formatTopupAmount } from "../../lib/quoteBalance";
import { absolutizeSignedUrl, qrDownloadFilename, resolveOrgRentalQrUrl } from "../../lib/qrUrl";
import { copyText, downloadQrToDevice, openStudioChat, topupDraftMessage } from "../../lib/studioChat";
import type { PendingTopup, QrAsset, RentalItem, WalletData, WalletEntry } from "../../lib/types";
import {
  walletEntryAmountClass,
  walletEntryAmountPrefix,
  walletEntryLabelKey,
} from "../../lib/walletDisplay";
import { t, tFill, type Locale } from "../../i18n/strings";

const PAGE = 20;

type MineTabProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  supabase: SupabaseClient;
  refreshKey: number;
  focusRentalId?: string | null;
  topupPrefillAmount?: number | null;
  onTopupPrefillConsumed?: () => void;
  onRefreshAll?: () => void;
};

export default function MineTab({
  locale,
  bootstrap,
  supabase,
  refreshKey,
  focusRentalId,
  topupPrefillAmount,
  onTopupPrefillConsumed,
  onRefreshAll,
}: MineTabProps) {
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
  const lastOpenedChatMessageRef = useRef<string | null>(null);

  const [displayName, setDisplayName] = useState(bootstrap.displayName);
  const [phone, setPhone] = useState(bootstrap.contactPhone ?? "");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const loadedBookingsCountRef = useRef(PAGE);
  const focusHandledRef = useRef<string | null>(null);
  const undeliveredAckRef = useRef(false);

  useEffect(() => {
    const count = bootstrap.undeliveredNotifications;
    if (count <= 0 || undeliveredAckRef.current) return;
    undeliveredAckRef.current = true;
    void rpcAckOutboxSkipped(supabase).catch(() => {
      undeliveredAckRef.current = false;
    });
  }, [bootstrap.undeliveredNotifications, supabase]);

  useEffect(() => {
    setDisplayName(bootstrap.displayName);
    setPhone(bootstrap.contactPhone ?? "");
  }, [bootstrap.displayName, bootstrap.contactPhone]);

  const resolveQrAssetUrl = useCallback(
    async (asset: QrAsset): Promise<string | null> => {
      try {
        const viaFunction = await rpcGetRentalQrAccessUrl(supabase, asset.id);
        if (viaFunction) return viaFunction;
      } catch {
        /* fall through to Storage / RPC url */
      }
      try {
        return await resolveOrgRentalQrUrl(supabase, asset);
      } catch {
        return absolutizeSignedUrl(asset.signed_url);
      }
    },
    [supabase]
  );

  const loadBookings = useCallback(
    async (mode: "initial" | "refresh" | "more") => {
      if (mode === "more") {
        const next = bookingsOffset + PAGE;
        const b = await rpcListMine(supabase, PAGE, next);
        setBookings((prev) => {
          const merged = [...prev, ...b.items];
          loadedBookingsCountRef.current = merged.length;
          return merged;
        });
        setBookingsOffset(next);
        setBookingsTotal(b.total);
        return;
      }

      const limit =
        mode === "refresh" ? Math.max(PAGE, loadedBookingsCountRef.current) : PAGE;
      const b = await rpcListMine(supabase, limit, 0);
      setBookings(b.items);
      setBookingsTotal(b.total);
      if (mode === "initial") {
        setBookingsOffset(0);
        loadedBookingsCountRef.current = b.items.length;
      } else {
        setBookingsOffset(Math.max(0, b.items.length - PAGE));
        loadedBookingsCountRef.current = b.items.length;
      }
    },
    [supabase, bookingsOffset]
  );

  const load = useCallback(
    async (bookingsMode?: "initial" | "refresh") => {
      setError(null);
      const w = await rpcGetWallet(supabase, PAGE, 0);
      setWallet(w);
      const mode =
        bookingsMode ?? (loadedBookingsCountRef.current > PAGE ? "refresh" : "initial");
      await loadBookings(mode);
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
          const firstQrId = resolved[0]?.id ?? "";
          setTopupQrId((prev) =>
            resolved.some((asset) => asset.id === prev) ? prev : firstQrId
          );
          if (firstQrId) {
            setTopupMethod((prev) => (prev === "cash" ? "qr" : prev));
          }
        } catch {
          setQrs([]);
          setTopupQrId("");
        }
      }
    },
    [supabase, bootstrap.addonActive, resolveQrAssetUrl, loadBookings]
  );

  useEffect(() => {
    setBookingsOffset(0);
    loadedBookingsCountRef.current = PAGE;
  }, [refreshKey]);

  useEffect(() => {
    if (!focusRentalId || loading || focusHandledRef.current === focusRentalId) return;
    const target = document.getElementById(`rental-${focusRentalId}`);
    if (!target) return;
    focusHandledRef.current = focusRentalId;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRentalId, loading, bookings]);

  useEffect(() => {
    focusHandledRef.current = null;
  }, [focusRentalId]);

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

  useEffect(() => {
    if (topupPrefillAmount == null || topupPrefillAmount <= 0) return;
    setTopupAmount(formatTopupAmount(topupPrefillAmount));
    onTopupPrefillConsumed?.();
  }, [topupPrefillAmount, onTopupPrefillConsumed]);

  const loadMoreBookings = async () => {
    try {
      await loadBookings("more");
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    }
  };

  const onDeleteHold = async (id: string) => {
    setActionId(id);
    try {
      await rpcDeleteHold(supabase, id);
      await load("refresh");
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
      await load("refresh");
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
      await load("refresh");
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setActionId(null);
    }
  };

  const draftForAmount = (amountLabel: string, correlationCode?: string) =>
    topupDraftMessage({ locale, amountLabel, method: topupMethod, correlationCode });

  const openChatWithMessage = async (message: string) => {
    const url = bootstrap.chatUrl;
    if (!url) {
      setError(t(locale, "topupNeedChat"));
      return false;
    }
    if (lastOpenedChatMessageRef.current === message) {
      return true;
    }
    const copied = await copyText(message);
    openStudioChat(url);
    lastOpenedChatMessageRef.current = message;
    setTopupMsg(copied ? t(locale, "topupCopied") : null);
    return true;
  };

  const refreshQrUrl = useCallback(
    async (asset: QrAsset): Promise<string | null> => {
      const next = await resolveQrAssetUrl(asset);
      setQrs((prev) => prev.map((item) => (item.id === asset.id ? { ...item, signed_url: next } : item)));
      return next;
    },
    [resolveQrAssetUrl]
  );

  const openChatWithDraft = async (amountLabel: string) => {
    await openChatWithMessage(draftForAmount(amountLabel));
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
    try {
      const result = await rpcSubmitTopup(supabase, {
        amount,
        method: topupMethod,
        ...(topupMethod === "qr" ? { qr_asset_id: topupQrId } : {}),
      });
      setTopupMsg(tFill(locale, "topupSuccess", { code: result.correlation_code }));
      setTopupAmount("");
      await load("refresh");
      if (topupMethod === "qr" && bootstrap.chatUrl) {
        const message = draftForAmount(amountLabel, result.correlation_code);
        await openChatWithMessage(message);
      }
    } catch (err) {
      const key = rpcErrorKey(err);
      setError(t(locale, key));
      if (key === "topupPendingExists" && bootstrap.chatUrl && topupMethod === "qr") {
        await openChatWithDraft(amountLabel);
      }
    }
  };

  const manualRefresh = () => {
    onRefreshAll?.();
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
  const pendingTopup = wallet?.pending_topup ?? null;

  const methodActiveCls = "bg-indigo-600 text-white border border-indigo-600";
  const methodIdleCls = "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50";

  return (
    <div className="flex flex-col gap-4 bg-slate-50 px-4 pb-8 pt-3 text-slate-800">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {bootstrap.undeliveredNotifications > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {tFill(locale, "undeliveredNotifications", {
            count: bootstrap.undeliveredNotifications,
          })}
        </p>
      ) : null}

      {pendingTopup ? (
        <PendingTopupCard locale={locale} pending={pendingTopup} currency={currency} />
      ) : null}

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
          {wallet.entries.length > 0 ? (
            <WalletHistory
              locale={locale}
              currency={currency}
              entries={wallet.entries}
            />
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className={sectionTitleCls}>{t(locale, "tabMine")}</h2>
          <button
            type="button"
            className={`shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60`}
            disabled={loading}
            onClick={manualRefresh}
          >
            {loading ? t(locale, "refreshing") : t(locale, "refresh")}
          </button>
        </div>
        {bookings.length === 0 ? (
          <p className="text-sm text-slate-500">{t(locale, "noBookings")}</p>
        ) : (
          groupMineBookings(bookings).map((row) => {
            if (row.kind === "pack") {
              return (
                <PackSeriesCard
                  key={row.seriesId}
                  locale={locale}
                  rentals={row.rentals}
                  head={row.head}
                  currency={currency}
                  serverNow={bootstrap.serverNow}
                  highlighted={row.rentals.some((r) => focusRentalId === r.id)}
                  busy={actionId === row.seriesId || row.rentals.some((r) => actionId === r.id)}
                  onCancelPack={
                    row.head.can_cancel_pack ? () => void onCancelPack(row.seriesId) : undefined
                  }
                  onHoldExpired={() => void load("refresh")}
                />
              );
            }
            const r = row.rental;
            const seriesId = r.rental_series_id;
            return (
              <RentalCard
                key={r.id}
                locale={locale}
                rental={r}
                currency={currency}
                serverNow={bootstrap.serverNow}
                highlighted={focusRentalId === r.id}
                busy={actionId === r.id || actionId === (r.rental_series_id ?? "")}
                onDeleteHold={() => void onDeleteHold(r.id)}
                onCancel={() => void onCancel(r.id)}
                onCancelPack={
                  r.can_cancel_pack && seriesId ? () => void onCancelPack(seriesId) : undefined
                }
                onHoldExpired={() => void load("refresh")}
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
        {pendingTopup ? (
          <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-xs leading-relaxed text-indigo-900">
            {t(locale, "topupPendingBlocked")}
          </p>
        ) : null}
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
            {bootstrap.chatUrl && topupMethod === "qr" ? (
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
            ) : topupMethod === "qr" ? (
              <p className="text-xs leading-relaxed text-amber-800">{t(locale, "topupNeedChat")}</p>
            ) : null}
            <button
              type="button"
              className={`w-full ${btnSecondaryCls}`}
              onClick={() => void submitTopup()}
              disabled={Boolean(pendingTopup)}
            >
              {t(locale, "topupSubmit")}
            </button>
            {topupMsg ? <p className="text-xs font-medium text-indigo-600">{topupMsg}</p> : null}
          </>
        )}
      </section>

      <section className={`${panelCls} p-3`}>
        <details className="group">
          <summary className={`${sectionTitleCls} cursor-pointer list-none marker:content-none [&::-webkit-details-marker]:hidden`}>
            {t(locale, "profile")}
          </summary>
          <div className="mt-3 space-y-3">
            <label className="flex flex-col gap-1">
              <span className={labelCls}>{t(locale, "displayName")}</span>
              <input
                className={fieldCls}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
              />
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
          </div>
        </details>
      </section>
    </div>
  );
}

type WalletHistoryProps = {
  locale: Locale;
  currency: string;
  entries: WalletEntry[];
};

function WalletHistory({ locale, currency, entries }: WalletHistoryProps) {
  const localeTag = locale === "en" ? "en-US" : "ru-RU";

  return (
    <div className="border-t border-slate-100 pt-2">
      <p className={`${labelCls} mb-1`}>{t(locale, "walletHistory")}</p>
      <ul className="space-y-1.5">
        {entries.map((entry) => {
          const labelKey = walletEntryLabelKey(entry.entry_type);
          const label = labelKey ? t(locale, labelKey) : entry.entry_type;
          const when = new Intl.DateTimeFormat(localeTag, {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(entry.created_at));

          return (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 text-slate-600">
                <span className="block font-medium text-slate-800">{label}</span>
                <span className="text-slate-500">{when}</span>
                {entry.balance_after != null ? (
                  <span className="block text-slate-400">
                    {tFill(locale, "walletEntryBalanceAfter", {
                      amount: formatMoney(entry.balance_after, currency, locale),
                    })}
                  </span>
                ) : null}
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${walletEntryAmountClass(entry)}`}>
                {walletEntryAmountPrefix(entry)}
                {formatMoney(entry.amount, currency, locale)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type PendingTopupCardProps = {
  locale: Locale;
  pending: PendingTopup;
  currency: string;
};

function PendingTopupCard({ locale, pending, currency }: PendingTopupCardProps) {
  const localeTag = locale === "en" ? "en" : "ru";
  const methodLabel =
    pending.method === "qr" ? t(locale, "topupMethodQr") : t(locale, "topupMethodCash");

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm shadow-xs">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
        {t(locale, "topupPendingStatus")}
      </p>
      <p className="mt-1 font-semibold text-slate-800">
        {formatMoney(pending.amount, currency, locale)}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {tFill(locale, "topupPendingMeta", {
          method: methodLabel,
          age: formatRequestAge(pending.created_at, localeTag),
        })}
      </p>
      <p className="mt-1 text-xs font-semibold text-indigo-800">
        {tFill(locale, "topupPendingCode", { code: pending.correlation_code })}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-indigo-900">{t(locale, "topupPendingHint")}</p>
    </section>
  );
}

type PackSeriesCardProps = {
  locale: Locale;
  rentals: RentalItem[];
  head: RentalItem;
  currency: string;
  serverNow: string;
  highlighted?: boolean;
  busy: boolean;
  onCancelPack?: () => void;
  onHoldExpired?: () => void;
};

function PackSeriesCard({
  locale,
  rentals,
  head,
  currency,
  serverNow,
  highlighted = false,
  busy,
  onCancelPack,
  onHoldExpired,
}: PackSeriesCardProps) {
  const localeTag = locale === "en" ? "en" : "ru";
  const packHold = isPackOnHold(head);
  const countdown = useHoldCountdown(
    packHoldExpiresAt(head),
    packHold,
    serverNow,
    onHoldExpired
  );
  const sessionCount = head.series_occurrence_count ?? rentals.length;
  const packCost = rentals.reduce((sum, r) => sum + (r.fixed_amount ?? 0), 0);

  return (
    <div
      className={`rounded-xl border p-3 text-sm space-y-2 shadow-xs ${
        highlighted ? "ring-2 ring-indigo-400 ring-offset-2" : ""
      } ${
        packHold
          ? "slot-hold border-slate-300 text-slate-800"
          : "border-slate-200 bg-white border-l-4 border-l-indigo-600"
      }`}
    >
      <div className="flex justify-between gap-2">
        <span className="font-semibold text-slate-900">
          {tFill(locale, "packSeriesTitle", { count: String(sessionCount) })}
        </span>
        <span className="text-slate-600">{formatTimeRange(head.time_start, head.time_end)}</span>
      </div>
      <p className="text-xs font-medium text-indigo-700">
        {packHold ? t(locale, "packSeriesHold") : t(locale, miniAppLifecycleKey(head.lifecycle))}
      </p>
      {packCost > 0 ? (
        <p className="text-xs font-medium text-slate-700">
          {formatMoney(packCost, head.currency ?? currency, locale)}
        </p>
      ) : null}
      {countdown ? (
        <p className="text-xs font-medium text-amber-800">
          {t(locale, "holdExpires")}: {countdown}
        </p>
      ) : null}
      <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
        {rentals.map((r) => (
          <li key={r.id} id={`rental-${r.id}`}>
            {formatShortDate(r.rental_date, localeTag)} · {formatTimeRange(r.time_start, r.time_end)}
            <span className="ml-1 text-slate-500">({t(locale, miniAppLifecycleKey(r.lifecycle))})</span>
          </li>
        ))}
      </ul>
      {onCancelPack ? (
        <button type="button" disabled={busy} className={btnDestructiveOpenCls} onClick={onCancelPack}>
          {t(locale, "cancelPack")}
        </button>
      ) : null}
    </div>
  );
}

type RentalCardProps = {
  locale: Locale;
  rental: RentalItem;
  currency: string;
  serverNow: string;
  highlighted?: boolean;
  busy: boolean;
  onDeleteHold: () => void;
  onCancel: () => void;
  onCancelPack?: () => void;
  onHoldExpired?: () => void;
};

function RentalCard({
  locale,
  rental,
  currency,
  serverNow,
  highlighted = false,
  busy,
  onDeleteHold,
  onCancel,
  onCancelPack,
  onHoldExpired,
}: RentalCardProps) {
  const isHold = isAwaitingPaymentHold(rental.lifecycle);
  const canDeleteHold = rental.can_delete_hold === true;
  const canCancel = rental.can_cancel_occurrence === true;
  const countdown = useHoldCountdown(
    rental.hold_expires_at,
    isHold,
    serverNow,
    onHoldExpired
  );
  const lifecycleKey = miniAppLifecycleKey(rental.lifecycle);

  return (
    <div
      id={`rental-${rental.id}`}
      className={`rounded-xl border p-3 text-sm space-y-2 shadow-xs ${
        highlighted ? "ring-2 ring-indigo-400 ring-offset-2" : ""
      } ${
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
      <p className="text-xs font-medium text-indigo-700">{t(locale, lifecycleKey)}</p>
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
        {onCancelPack ? (
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
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">(
    asset.signed_url ? "ready" : "loading"
  );
  const imageRetryUsedRef = useRef(false);
  const refreshUrlRef = useRef(refreshUrl);
  const assetRef = useRef(asset);
  refreshUrlRef.current = refreshUrl;
  assetRef.current = asset;

  useEffect(() => {
    if (asset.signed_url) {
      setSrc(asset.signed_url);
      setPhase("ready");
    }
  }, [asset.id, asset.signed_url]);

  useEffect(() => {
    if (asset.signed_url) return;
    let cancelled = false;
    setPhase("loading");
    imageRetryUsedRef.current = false;
    void refreshUrlRef.current(assetRef.current).then(
      (next) => {
        if (cancelled) return;
        setSrc(next);
        setPhase(next ? "ready" : "failed");
      },
      () => {
        if (cancelled) return;
        setSrc(null);
        setPhase("failed");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.signed_url]);

  const saveQr = async () => {
    const downloadUrl =
      src ??
      (await refreshUrlRef.current(assetRef.current).then((next) => {
        setSrc(next);
        setPhase(next ? "ready" : "failed");
        return next;
      }));
    if (!downloadUrl) return;
    const ok = await downloadQrToDevice(downloadUrl, qrDownloadFilename(asset.label, asset.id));
    if (ok) onSaved();
  };

  const handleImageError = () => {
    if (src?.startsWith("data:") || imageRetryUsedRef.current) {
      setSrc(null);
      setPhase("failed");
      return;
    }
    imageRetryUsedRef.current = true;
    setPhase("loading");
    void refreshUrlRef.current(assetRef.current).then(
      (next) => {
        setSrc(next);
        setPhase(next ? "ready" : "failed");
      },
      () => {
        setSrc(null);
        setPhase("failed");
      }
    );
  };

  return (
    <div className="space-y-2">
      {src && phase !== "failed" ? (
        <img
          src={src}
          alt={asset.label ?? t(locale, "topupMethodQr")}
          className="mx-auto max-h-48 w-auto rounded-lg border border-slate-200 bg-white p-2"
          onError={handleImageError}
        />
      ) : phase === "loading" ? (
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
