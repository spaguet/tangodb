import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import { formatMoney, holdCountdown } from "../../lib/format";
import { formatShortDate, formatTimeRange } from "../../lib/orgTime";
import {
  rpcCancelOccurrence,
  rpcCancelPack,
  rpcDeleteHold,
  rpcGetWallet,
  rpcListActiveQr,
  rpcListMine,
  rpcSubmitTopup,
  rpcUpdateProfile,
} from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
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

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

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
        setQrs(assets);
        if (assets[0]) setTopupQrId(assets[0].id);
      } catch {
        setQrs([]);
      }
    }
  }, [supabase, bookingsOffset, bootstrap.addonActive]);

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

  const submitTopup = async () => {
    setTopupMsg(null);
    setError(null);
    const amount = Number(topupAmount.replace(",", "."));
    try {
      await rpcSubmitTopup(supabase, {
        amount,
        method: topupMethod,
        ...(topupMethod === "qr" ? { qr_asset_id: topupQrId } : {}),
      });
      setTopupMsg(t(locale, "topupSuccess"));
      setTopupAmount("");
      await load();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    }
  };

  const openChat = () => {
    const url = bootstrap.chatUrl;
    if (!url) return;
    window.Telegram?.WebApp?.openTelegramLink?.(url);
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
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 rounded-full border-2 border-[var(--tg-theme-button-color,#38bdf8)] border-t-transparent animate-spin" />
      </div>
    );
  }

  const currency = bootstrap.currencyCode;
  const debt = wallet?.debt_amount ?? 0;
  const seenSeries = new Set<string>();

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {wallet ? (
        <section className="rounded-xl bg-white/5 p-3 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs opacity-60">{t(locale, "walletBalance")}</p>
              <p className="font-medium">{formatMoney(wallet.wallet_balance, currency, locale)}</p>
            </div>
            <div>
              <p className="text-xs opacity-60">{t(locale, "spendable")}</p>
              <p className="font-medium">{formatMoney(wallet.spendable, currency, locale)}</p>
            </div>
            <div>
              <p className="text-xs opacity-60">{t(locale, "reservedPrepay")}</p>
              <p>{formatMoney(wallet.reserved_prepay, currency, locale)}</p>
            </div>
            <div>
              <p className="text-xs opacity-60">{t(locale, "debt")}</p>
              <p className={debt > 0 ? "text-rose-300 font-medium" : ""}>
                {formatMoney(debt, currency, locale)}
              </p>
            </div>
          </div>
          {debt > 0 ? (
            <p className="text-xs text-amber-200/90 leading-relaxed">{t(locale, "debtWarning")}</p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold opacity-80">{t(locale, "tabMine")}</h2>
        {bookings.length === 0 ? (
          <p className="text-sm opacity-60">{t(locale, "noBookings")}</p>
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
          <button
            type="button"
            className="w-full rounded-lg border border-white/15 py-2 text-sm"
            onClick={() => void loadMoreBookings()}
          >
            {t(locale, "loadMore")}
          </button>
        ) : null}
      </section>

      <section className="rounded-xl bg-white/5 p-3 space-y-3">
        <h2 className="text-sm font-semibold">{t(locale, "topup")}</h2>
        {!bootstrap.addonActive ? (
          <p className="text-xs opacity-70">{t(locale, "addonInactiveTopup")}</p>
        ) : (
          <>
            <input
              type="number"
              inputMode="decimal"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm"
              placeholder={t(locale, "topupAmount")}
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 text-xs ${topupMethod === "cash" ? "bg-[var(--tg-theme-button-color,#38bdf8)]" : "bg-white/10"}`}
                onClick={() => setTopupMethod("cash")}
              >
                {t(locale, "topupMethodCash")}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg py-2 text-xs ${topupMethod === "qr" ? "bg-[var(--tg-theme-button-color,#38bdf8)]" : "bg-white/10"}`}
                onClick={() => setTopupMethod("qr")}
                disabled={qrs.length === 0}
              >
                {t(locale, "topupMethodQr")}
              </button>
            </div>
            {topupMethod === "qr" && qrs.length > 0 ? (
              <select
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm"
                value={topupQrId}
                onChange={(e) => setTopupQrId(e.target.value)}
              >
                {qrs.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label ?? q.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            ) : null}
            {topupMethod === "qr" && qrs.length === 0 ? (
              <p className="text-xs opacity-70">{t(locale, "topupNoQr")}</p>
            ) : null}
            {qrs.map((q) =>
              topupMethod === "qr" && q.id === topupQrId ? (
                <img
                  key={q.id}
                  src={q.signed_url}
                  alt=""
                  className="mx-auto max-h-40 rounded-lg"
                />
              ) : null
            )}
            <button
              type="button"
              className="w-full rounded-lg bg-[var(--tg-theme-button-color,#38bdf8)] py-2.5 text-sm text-white"
              onClick={() => void submitTopup()}
            >
              {t(locale, "topupSubmit")}
            </button>
            {topupMsg ? <p className="text-xs text-emerald-300">{topupMsg}</p> : null}
            {bootstrap.chatUrl ? (
              <button
                type="button"
                className="w-full rounded-lg border border-white/20 py-2 text-sm"
                onClick={openChat}
              >
                {t(locale, "topupOpenChat")}
              </button>
            ) : null}
          </>
        )}
      </section>

      <section className="rounded-xl bg-white/5 p-3 space-y-3">
        <h2 className="text-sm font-semibold">{t(locale, "profile")}</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">{t(locale, "displayName")}</span>
          <input
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">{t(locale, "phone")}</span>
          <input
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
          />
        </label>
        <button
          type="button"
          className="w-full rounded-lg border border-white/20 py-2 text-sm"
          onClick={() => void saveProfile()}
        >
          {t(locale, "saveProfile")}
        </button>
        {profileMsg ? <p className="text-xs text-emerald-300">{profileMsg}</p> : null}
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
  const canCancel =
    !isHold && ["active", "prepaid_charged"].includes(rental.lifecycle);
  const countdown = isHold ? holdCountdown(rental.hold_expires_at) : null;
  const isPack = Boolean(rental.rental_series_id);

  return (
    <div
      className={`rounded-lg border p-3 text-sm space-y-2 ${
        isHold ? "slot-hold border-slate-400/30" : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex justify-between gap-2">
        <span>{formatShortDate(rental.rental_date, locale === "en" ? "en" : "ru")}</span>
        <span className="opacity-80">
          {formatTimeRange(rental.time_start, rental.time_end)}
        </span>
      </div>
      <p className="text-xs opacity-70">{rental.lifecycle}</p>
      {rental.fixed_amount != null ? (
        <p className="text-xs">
          {formatMoney(rental.fixed_amount, rental.currency ?? currency, locale)}
        </p>
      ) : null}
      {countdown ? (
        <p className="text-xs text-amber-200">
          {t(locale, "holdExpires")}: {countdown}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canDeleteHold ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-white/20 px-2 py-1 text-xs"
            onClick={onDeleteHold}
          >
            {t(locale, "deleteHold")}
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-white/20 px-2 py-1 text-xs"
            onClick={onCancel}
          >
            {t(locale, "cancelBooking")}
          </button>
        ) : null}
        {isPack && onCancelPack ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-rose-400/40 px-2 py-1 text-xs text-rose-200"
            onClick={onCancelPack}
          >
            {t(locale, "cancelPack")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
