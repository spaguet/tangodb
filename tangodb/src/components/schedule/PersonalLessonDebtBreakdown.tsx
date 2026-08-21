import { paymentEffectiveAmount } from "../../lib/paymentCorrection";
import type { PaymentWithCorrectionMeta } from "../../lib/paymentCorrection";
import { formatCurrency } from "../../lib/utils";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import { useI18n } from "../../hooks/useI18n";

interface PersonalLessonDebtBreakdownProps {
  billedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  tariffLabel?: string | null;
  payments?: PaymentWithCorrectionMeta[];
}

export default function PersonalLessonDebtBreakdown({
  billedAmount,
  paidAmount,
  remainingAmount,
  tariffLabel,
  payments = [],
}: PersonalLessonDebtBreakdownProps) {
  const { t, formatDateTime } = useI18n();
  const hasLedger = billedAmount > 0 || paidAmount > 0 || payments.length > 0;
  if (!hasLedger) return null;

  const closed = remainingAmount <= 0.005 && billedAmount > 0 && paidAmount >= billedAmount;

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-3 text-xs font-sans">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
            {t("personal.pay.billed")}
          </p>
          <p className="text-slate-800 font-semibold tabular-nums">{formatCurrency(billedAmount)}</p>
          {tariffLabel ? <p className="text-[11px] text-slate-500 mt-0.5 truncate">{tariffLabel}</p> : null}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
            {t("personal.pay.paidSoFar")}
          </p>
          <p className="text-slate-700 font-semibold tabular-nums">{formatCurrency(paidAmount)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs font-sans">
        <span className={closed ? "text-indigo-700 font-medium" : "text-rose-600 font-semibold"}>
          {closed ? t("personal.pay.closed") : `${t("common.debt")}: ${formatCurrency(remainingAmount)}`}
        </span>
      </div>

      {billedAmount > 0 ? (
        <p className="text-[11px] text-slate-500 leading-snug">
          {t("personal.pay.debtFormula", {
            billed: formatCurrency(billedAmount),
            paid: formatCurrency(paidAmount),
            debt: formatCurrency(remainingAmount),
          })}
        </p>
      ) : null}

      {!closed && billedAmount > 0 ? (
        <p className="text-[11px] text-slate-500 leading-snug">{t("personal.pay.debtWhy")}</p>
      ) : null}

      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
          {t("personal.pay.paymentsHeading")}
        </p>
        {payments.length === 0 ? (
          <p className="text-[11px] text-slate-500">{t("personal.pay.noPayments")}</p>
        ) : (
          <ul className="divide-y divide-slate-200/80 rounded-md border border-slate-200/80 overflow-hidden bg-white">
            {payments.map((payment) => {
              const effective = paymentEffectiveAmount(payment);
              const isStorno = payment.operationKind === "storno";
              return (
                <li
                  key={payment.id}
                  className="flex items-start justify-between gap-3 px-2.5 py-1.5 text-[11px] font-sans"
                >
                  <div className="min-w-0">
                    <p className="text-slate-700 truncate">
                      {formatDateTime(payment.createdAt)}
                      {isStorno ? ` · ${t("personal.pay.storno")}` : ""}
                    </p>
                    <p className="text-slate-400 truncate">
                      {getPaymentMethodLabel(payment.method, t)}
                      {payment.clientDisplay ? ` · ${payment.clientDisplay}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${
                      effective < 0 ? "text-rose-600" : "text-slate-800"
                    }`}
                  >
                    {formatCurrency(effective)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
