import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import {
  btnDestructiveOpenCls,
  btnSecondaryCls,
  fieldCls,
  labelCls,
  panelCls,
  sectionTitleCls,
} from "../../lib/crmUi";
import { formatMoney } from "../../lib/format";
import { formatRequestAge } from "../../lib/cabinetRefresh";
import { useHoldCountdown } from "../../hooks/useServerClock";
import { miniAppLifecycleKey, isAwaitingPaymentHold, occupiesMiniAppGrid } from "../../lib/lifecycle";
import { groupMineBookings, isPackOnHold, packHoldExpiresAt } from "../../lib/packSeriesTimeline";
import { formatShortDate, formatTimeRange } from "../../lib/orgTime";
import {
  rpcAckOutboxSkipped,
  rpcCancelOccurrence,
  rpcCancelPack,
  rpcDeleteHold,
  rpcGetWallet,
  rpcListMine,
  rpcUpdateProfile,
} from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import type { PendingTopup, RentalItem, WalletData, WalletEntry } from "../../lib/types";
import {
  walletEntryAmountClass,
  walletEntryAmountPrefix,
  walletEntryLabelKey,
} from "../../lib/walletDisplay";
import { t, tFill, type Locale } from "../../i18n/strings";
import TopupForm from "./TopupForm";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

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

  const loadBookings = useCallback(
    async (mode: "initial" | "refresh" | "more") => {
      if (mode === "more") {
        const next = bookingsOffset + PAGE;
        const b = await rpcListMine(supabase, PAGE, next);
        setBookings((prev) => {
          const merged = [...prev, ...b.items.filter((item) => occupiesMiniAppGrid(item.lifecycle))];
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
      const items = b.items.filter((item) => occupiesMiniAppGrid(item.lifecycle));
      setBookings(items);
      setBookingsTotal(b.total);
      if (mode === "initial") {
        setBookingsOffset(0);
        loadedBookingsCountRef.current = items.length;
      } else {
        setBookingsOffset(Math.max(0, items.length - PAGE));
        loadedBookingsCountRef.current = items.length;
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
    },
    [supabase, loadBookings]
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
      onRefreshAll?.();
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
      onRefreshAll?.();
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
      onRefreshAll?.();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setActionId(null);
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

  return (
    <div className="flex flex-col gap-4 bg-slate-50 px-4 pb-8 pt-3 text-slate-800">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {bootstrap.pendingSurchargeReviews.length > 0 ? (
        <div className="space-y-2">
          {bootstrap.pendingSurchargeReviews.map((review) => (
            <p
              key={review.id}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900"
            >
              {review.seriesValidFrom && review.seriesValidTo
                ? tFill(locale, "surchargeReviewPending", {
                    from: formatShortDate(review.seriesValidFrom, locale === "en" ? "en" : "ru"),
                    to: formatShortDate(review.seriesValidTo, locale === "en" ? "en" : "ru"),
                    amount: formatMoney(review.suggestedAmount, review.currency, locale),
                  })
                : t(locale, "surchargeReviewPendingGeneric")}
            </p>
          ))}
        </div>
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
          groupMineBookings(bookings.filter((r) => occupiesMiniAppGrid(r.lifecycle))).map((row) => {
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
                  onDeleteHold={(id) => void onDeleteHold(id)}
                  onCancel={(id) => void onCancel(id)}
                  onCancelPack={
                    row.head.can_cancel_pack ||
                    (isPackOnHold(row.head) && row.rentals.some((r) => r.can_delete_hold === true))
                      ? () => void onCancelPack(row.seriesId)
                      : undefined
                  }
                  onHoldExpired={() => {
                    void load("refresh");
                    onRefreshAll?.();
                  }}
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
                onHoldExpired={() => {
                  void load("refresh");
                  onRefreshAll?.();
                }}
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

      <TopupForm
        locale={locale}
        bootstrap={bootstrap}
        supabase={supabase}
        pendingTopup={pendingTopup}
        refreshKey={refreshKey}
        initialAmount={topupPrefillAmount}
        onInitialAmountConsumed={onTopupPrefillConsumed}
        onSubmitted={() => void load("refresh")}
      />

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
  const [expanded, setExpanded] = useState(false);
  const localeTag = locale === "en" ? "en-US" : "ru-RU";

  return (
    <div className="border-t border-slate-100 pt-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className={labelCls}>{t(locale, "walletHistory")}</span>
        <span className="text-xs text-slate-400" aria-hidden="true">
          {expanded ? "в–І" : "в–ј"}
        </span>
      </button>
      {expanded ? (
        <ul className="mt-1 space-y-1.5">
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
      ) : null}
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
  onDeleteHold: (rentalId: string) => void;
  onCancel: (rentalId: string) => void;
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
  onDeleteHold,
  onCancel,
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
  const hasCancellableOccurrence = rentals.some((r) => r.can_cancel_occurrence === true);
  const hasDeletableHold = rentals.some((r) => r.can_delete_hold === true);

  return (
    <div
      className={`rounded-xl border p-3 text-sm space-y-2 shadow-xs ${
        highlighted ? "ring-2 ring-indigo-400 ring-offset-2" : ""
      } ${
        packHold
          ? "slot-hold-soft border-slate-200 text-slate-800"
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
      <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
        {rentals.map((r) => {
          const canDeleteHold = r.can_delete_hold === true;
          const canCancelOccurrence = r.can_cancel_occurrence === true;
          return (
            <li
              key={r.id}
              id={`rental-${r.id}`}
              className="flex items-start justify-between gap-2 rounded-md px-1 py-0.5"
            >
              <span className="min-w-0">
                {formatShortDate(r.rental_date, localeTag)} · {formatTimeRange(r.time_start, r.time_end)}
                <span className="ml-1 text-slate-500">
                  ({t(locale, miniAppLifecycleKey(r.lifecycle))})
                </span>
              </span>
              {canDeleteHold ? (
                <button
                  type="button"
                  disabled={busy}
                  className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  onClick={() => onDeleteHold(r.id)}
                >
                  {t(locale, "deleteHold")}
                </button>
              ) : canCancelOccurrence ? (
                <button
                  type="button"
                  disabled={busy}
                  className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  onClick={() => onCancel(r.id)}
                >
                  {t(locale, "cancelBooking")}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hasCancellableOccurrence ? (
        <p className="text-[11px] leading-relaxed text-slate-500">{t(locale, "cancelOccurrenceHint")}</p>
      ) : null}
      {hasDeletableHold ? (
        <p className="text-[11px] leading-relaxed text-slate-500">{t(locale, "deletePackHoldHint")}</p>
      ) : null}
      {onCancelPack ? (
        <button type="button" disabled={busy} className={btnDestructiveOpenCls} onClick={onCancelPack}>
          {packHold ? t(locale, "deletePackHold") : t(locale, "cancelPack")}
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
          ? "slot-hold-soft border-slate-200 text-slate-800"
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
