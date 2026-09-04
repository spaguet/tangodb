import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import type { StaffTopupPreviewEffect } from "../../hooks/useRenterTopupInbox";
import { formatCurrency } from "../../lib/utils";

interface TopupEffectPreviewProps {
  loading: boolean;
  error: unknown;
  effect: StaffTopupPreviewEffect | undefined;
}

export default function TopupEffectPreview({ loading, error, effect }: TopupEffectPreviewProps) {
  const { t } = useI18n();

  if (loading) {
    return <p className="text-xs text-slate-400">{t("common.loading.default")}</p>;
  }

  if (error) {
    return (
      <p className="text-xs text-rose-600">
        {resolveMutationError(
          error instanceof Error ? error.message : null,
          "renter.topup.previewFailed",
          t
        )}
      </p>
    );
  }

  if (!effect) return null;

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-1 text-xs">
      <p className="font-semibold text-slate-700">{t("renters.detail.staffTopupReviewEffect")}</p>
      <p>
        {t("renters.detail.staffTopupReviewBalanceBefore")}: {formatCurrency(effect.walletBalanceBefore)}
      </p>
      <p>
        {t("renters.detail.staffTopupReviewBalanceAfter")}: {formatCurrency(effect.walletBalanceAfter)}
      </p>
      <p>
        {t("renters.detail.staffTopupReviewDebt")}: {formatCurrency(effect.debtToSettle)}
        {effect.miniappDebtBefore > 0 ? (
          <span className="text-slate-500">
            {" "}
            ({formatCurrency(effect.miniappDebtBefore)} → {formatCurrency(effect.miniappDebtAfter)})
          </span>
        ) : null}
      </p>
      <p>
        {t("renters.detail.staffTopupReviewHolds")}: {effect.holdsToActivate}
      </p>
      <p>
        {t("renters.detail.staffTopupReviewSpendable")}: {formatCurrency(effect.spendableBefore)} →{" "}
        {formatCurrency(effect.spendableAfter)}
      </p>
    </div>
  );
}
