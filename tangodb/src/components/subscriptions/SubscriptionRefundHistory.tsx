import { Banknote, CheckCircle2, XCircle } from "lucide-react";
import {
  useCancelSubscriptionRefund,
  useCompleteSubscriptionRefund,
  useSubscriptionRefunds,
} from "../../hooks/useSubscriptionRefunds";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import type { Client } from "../../types";
import type { SubscriptionRefundRecord } from "../../lib/subscriptionRefund";
import { formatClientName } from "../../lib/utils";
import type { I18nKey } from "../../lib/i18n/keys";

interface SubscriptionRefundHistoryProps {
  subscriptionId: string;
  canManage: boolean;
  clientMap: Record<string, Client>;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

function refundKindLabel(
  refund: SubscriptionRefundRecord,
  t: (key: I18nKey, params?: Record<string, string | number>) => string
) {
  return refund.refundKind === "partial"
    ? t("subscriptions.refund.kind.partial")
    : t("subscriptions.refund.kind.finish");
}

export default function SubscriptionRefundHistory({
  subscriptionId,
  canManage,
  clientMap,
  toast,
}: SubscriptionRefundHistoryProps) {
  const { t, formatDate } = useI18n();
  const { data: refunds = [] } = useSubscriptionRefunds({ subscriptionId });
  const completeRefund = useCompleteSubscriptionRefund();
  const cancelRefund = useCancelSubscriptionRefund();

  if (refunds.length === 0) return null;

  const handleComplete = async (refund: SubscriptionRefundRecord) => {
    if (!window.confirm(t("subscriptions.refund.completeConfirm", { amount: formatCurrency(refund.amount) }))) return;
    const res = await completeRefund.mutateAsync({ refundId: refund.id });
    if (!res.success) {
      toast(resolveMutationError(res.error, "subscriptions.refund.error.completeFailed", t), "error");
      return;
    }
    toast(t("subscriptions.refund.completeSuccess", { amount: formatCurrency(res.amount) }), "success");
  };

  const handleCancel = async (refund: SubscriptionRefundRecord) => {
    if (!window.confirm(t("subscriptions.refund.cancelConfirm", { amount: formatCurrency(refund.amount) }))) return;
    const res = await cancelRefund.mutateAsync({ refundId: refund.id });
    if (!res.success) {
      toast(resolveMutationError(res.error, "subscriptions.refund.error.cancelFailed", t), "error");
      return;
    }
    toast(t("subscriptions.refund.cancelSuccess"), "success");
  };

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <Banknote className="w-3 h-3" />
        {t("subscriptions.refund.history.title")}
      </p>
      <ul className="space-y-2">
        {refunds.map((refund) => {
          const client = clientMap[refund.clientId];
          const recipient = client ? formatClientName(client.lastName, client.firstName) : refund.clientId;
          const pending = refund.status === "pending";
          const canAct = canManage && pending && !completeRefund.isPending && !cancelRefund.isPending;

          return (
            <li key={refund.id} className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-600 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">
                    {t("subscriptions.refund.history.amount", { amount: formatCurrency(refund.amount) })}
                  </p>
                  <p className="text-slate-500">
                    {refundKindLabel(refund, t)}
                    {" · "}
                    {getPaymentMethodLabel(refund.method, t)}
                    {" · "}
                    {recipient}
                  </p>
                  <p className="text-slate-500">
                    {formatDate(refund.operationDate)}
                    {" · "}
                    {t(`subscriptions.refund.history.status.${refund.status}`)}
                  </p>
                  {refund.lessonsDeducted > 0 ? (
                    <p className="text-slate-500">
                      {t("subscriptions.refund.history.lessonsDeducted", { count: refund.lessonsDeducted })}
                    </p>
                  ) : null}
                  {refund.reason ? <p className="text-slate-500 italic">{refund.reason}</p> : null}
                </div>
                {canAct ? (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleComplete(refund)}
                      className="inline-flex items-center gap-1 text-emerald-700 hover:underline cursor-pointer text-[10px] font-semibold uppercase"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {t("subscriptions.refund.completeAction")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCancel(refund)}
                      className="inline-flex items-center gap-1 text-rose-600 hover:underline cursor-pointer text-[10px] font-semibold uppercase"
                    >
                      <XCircle className="w-3 h-3" />
                      {t("subscriptions.refund.cancelAction")}
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
