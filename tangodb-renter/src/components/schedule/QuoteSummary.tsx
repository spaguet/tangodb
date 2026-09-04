import { btnPrimaryCls, panelCls } from "../../lib/crmUi";
import { formatMoney } from "../../lib/format";
import { quoteAvailable, quoteShortage } from "../../lib/quoteBalance";
import type { WalletData } from "../../lib/types";
import { t, tFill, type Locale } from "../../i18n/strings";

type QuoteSummaryProps = {
  locale: Locale;
  currency: string;
  cost: number;
  prepay: number;
  remainder: number;
  wallet: WalletData | null;
  walletLoading?: boolean;
  sessionCount?: number;
  holdNote?: string;
  onTopup?: (amount: number) => void;
};

export default function QuoteSummary({
  locale,
  currency,
  cost,
  prepay,
  remainder,
  wallet,
  walletLoading,
  sessionCount,
  holdNote,
  onTopup,
}: QuoteSummaryProps) {
  const available = wallet ? quoteAvailable(wallet) : null;
  const shortage = wallet && available !== null ? quoteShortage(prepay, available) : null;
  const topupAmount =
    wallet && shortage !== null && shortage > 0
      ? wallet.debt_amount > 0
        ? wallet.debt_amount + prepay
        : shortage
      : 0;

  return (
    <div className={`${panelCls} space-y-1 p-3 text-sm`}>
      <p className="text-slate-800">
        {t(locale, "cost")}: {formatMoney(cost, currency, locale)}
        {sessionCount != null
          ? ` (${sessionCount} ${locale === "en" ? "sessions" : "занятий"})`
          : null}
      </p>
      <p className="text-slate-600">
        {t(locale, "prepay")}: {formatMoney(prepay, currency, locale)}
      </p>
      <p className="text-slate-600">
        {t(locale, "remainder")}: {formatMoney(remainder, currency, locale)}
      </p>
      {walletLoading ? (
        <p className="text-slate-500">{t(locale, "quoteLoading")}</p>
      ) : wallet ? (
        <>
          <p className="text-slate-600">
            {t(locale, "availableBalance")}: {formatMoney(available ?? 0, currency, locale)}
          </p>
          {shortage !== null && shortage > 0 ? (
            <p className="font-medium text-amber-800">
              {t(locale, "shortage")}: {formatMoney(shortage, currency, locale)}
            </p>
          ) : null}
          {wallet.debt_amount > 0 && shortage !== null && shortage > 0 ? (
            <p className="text-xs leading-relaxed text-amber-800">
              {tFill(locale, "topupDebtThenActivate", {
                debt: formatMoney(wallet.debt_amount, currency, locale),
                prepay: formatMoney(prepay, currency, locale),
              })}
            </p>
          ) : null}
        </>
      ) : null}
      {holdNote ? (
        <p className="text-xs leading-relaxed text-slate-600">{holdNote}</p>
      ) : null}
      {onTopup && topupAmount > 0 ? (
        <button
          type="button"
          className={`mt-2 w-full ${btnPrimaryCls}`}
          onClick={() => onTopup(topupAmount)}
        >
          {tFill(locale, "topupAmountCta", {
            amount: formatMoney(topupAmount, currency, locale),
          })}
        </button>
      ) : null}
    </div>
  );
}

export function topupAmountFromWallet(
  wallet: WalletData,
  requiredPrepay: number
): number {
  const available = quoteAvailable(wallet);
  const shortage = quoteShortage(requiredPrepay, available);
  if (shortage <= 0) return 0;
  return wallet.debt_amount > 0 ? wallet.debt_amount + requiredPrepay : shortage;
}
