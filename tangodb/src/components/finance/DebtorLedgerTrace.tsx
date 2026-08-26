import { useI18n } from "../../hooks/useI18n";
import { usePersonalLessonDebtTrace } from "../../hooks/usePersonalLessonDebt";
import type { I18nKey } from "../../lib/i18n/keys";
import { paymentCorrectionReasonLabelKey } from "../../lib/paymentCorrection";
import { debtOriginHintKey, type PersonalLessonDebtTraceEvent } from "../../lib/personalLessonDebtTrace";
import { formatCurrency } from "../../lib/utils";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import type { PaymentMethod } from "../../types";

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card", "other"];

interface DebtorLedgerTraceProps {
  lessonId: string | null | undefined;
  chargeId?: string | null;
  billedAmount: number;
  paidAmount: number;
  outstanding: number;
}

function eventKindKey(kind: PersonalLessonDebtTraceEvent["kind"]): I18nKey {
  switch (kind) {
    case "charge_created":
      return "finance.debtors.trace.event.chargeCreated";
    case "storno":
      return "finance.debtors.trace.event.storno";
    case "billed_restated":
      return "finance.debtors.trace.event.billedRestated";
    case "write_off":
      return "finance.debtors.trace.event.writeOff";
    default:
      return "finance.debtors.trace.event.payment";
  }
}

export default function DebtorLedgerTrace({
  lessonId,
  chargeId,
  billedAmount,
  paidAmount,
  outstanding,
}: DebtorLedgerTraceProps) {
  const { t, formatDateTime } = useI18n();
  const traceQuery = usePersonalLessonDebtTrace(lessonId, chargeId, { enabled: Boolean(lessonId) });
  const hintKey = debtOriginHintKey(
    billedAmount,
    paidAmount,
    outstanding,
    (traceQuery.data?.events ?? []).map((event) => ({
      operationKind: event.kind === "storno" ? ("storno" as const) : ("payment" as const),
      replacesPaymentId: null,
      correctionStatus: undefined,
    }))
  );

  if (!lessonId) return null;

  const events = traceQuery.data?.events ?? [];

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
        {t("finance.debtors.trace.title")}
      </p>
      <p className="text-[11px] text-slate-600 leading-snug">
        {t("finance.debtors.trace.formula", {
          billed: formatCurrency(billedAmount),
          paid: formatCurrency(paidAmount),
          debt: formatCurrency(outstanding),
        })}
      </p>
      {hintKey ? <p className="text-[11px] text-rose-700 leading-snug">{t(hintKey)}</p> : null}
      {traceQuery.isLoading ? (
        <p className="text-[11px] text-slate-500">{t("finance.debtors.trace.loading")}</p>
      ) : traceQuery.isError ? (
        <p className="text-[11px] text-slate-500">{t("finance.debtors.traceFailed")}</p>
      ) : events.length === 0 ? (
        <p className="text-[11px] text-slate-500">{t("finance.debtors.trace.empty")}</p>
      ) : (
        <ol className="divide-y divide-slate-200/80 rounded-md border border-slate-200/80 overflow-hidden bg-white">
          {events.map((event, index) => {
            const reasonKey = paymentCorrectionReasonLabelKey(event.reasonCode ?? null);
            const amount =
              event.kind === "storno"
                ? -(event.amount ?? 0)
                : event.kind === "billed_restated" || event.kind === "write_off"
                  ? event.billedAmount ?? event.amount
                  : event.amount;
            return (
              <li key={`${event.kind}-${event.at}-${event.paymentId ?? event.chargeId ?? index}`} className="px-2.5 py-1.5">
                <div className="flex items-start justify-between gap-3 text-[11px] font-sans">
                  <div className="min-w-0">
                    <p className="text-slate-700">
                      {event.at ? formatDateTime(event.at) : "—"}
                      {` · ${t(eventKindKey(event.kind))}`}
                    </p>
                    <p className="text-slate-400 truncate">
                      {event.clientDisplay ? `${event.clientDisplay}` : ""}
                      {event.method && PAYMENT_METHODS.includes(event.method as PaymentMethod)
                        ? `${event.clientDisplay ? " · " : ""}${getPaymentMethodLabel(event.method as PaymentMethod, t)}`
                        : ""}
                      {event.oldBilled != null && event.billedAmount != null
                        ? `${event.clientDisplay || event.method ? " · " : ""}${formatCurrency(event.oldBilled)} → ${formatCurrency(event.billedAmount)}`
                        : ""}
                      {reasonKey ? ` · ${t(reasonKey as I18nKey)}` : ""}
                      {event.reasonComment ? ` · ${event.reasonComment}` : ""}
                    </p>
                  </div>
                  {amount != null ? (
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${
                        amount < 0 ? "text-rose-600" : "text-slate-800"
                      }`}
                    >
                      {formatCurrency(amount)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
