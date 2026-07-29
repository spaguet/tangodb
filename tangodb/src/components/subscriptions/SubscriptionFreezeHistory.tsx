import { useMemo } from "react";
import { Snowflake, XCircle } from "lucide-react";
import type { SubscriptionFreezePeriod } from "../../types";
import {
  useCancelSubscriptionFreezePeriod,
  useSubscriptionFreezePeriods,
} from "../../hooks/useSubscriptionFreezePeriods";
import { useI18n } from "../../hooks/useI18n";
import { toISODateLocal } from "../../lib/scheduleWeek";
import { resolveMutationError } from "../../lib/resolveMutationError";

interface SubscriptionFreezeHistoryProps {
  subscriptionId: string;
  canManage: boolean;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

function periodDisplayStatus(
  period: SubscriptionFreezePeriod,
  today: string
): "active" | "scheduled" | "past" | "cancelled" {
  if (period.status === "cancelled") return "cancelled";
  if (period.endDate < today) return "past";
  if (period.startDate > today) return "scheduled";
  return "active";
}

export default function SubscriptionFreezeHistory({
  subscriptionId,
  canManage,
  toast,
}: SubscriptionFreezeHistoryProps) {
  const { t, formatDate, formatDateTime } = useI18n();
  const cancelFreeze = useCancelSubscriptionFreezePeriod();
  const { data: periods = [] } = useSubscriptionFreezePeriods(subscriptionId);
  const today = useMemo(() => toISODateLocal(new Date()), []);

  if (periods.length === 0) return null;

  const handleCancel = async (period: SubscriptionFreezePeriod) => {
    if (!window.confirm(t("freeze.history.cancelConfirm"))) return;
    const res = await cancelFreeze.mutateAsync(period.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "freeze.error.cancelFailed", t), "error");
      return;
    }
    toast(t("freeze.success.cancelled"), "success");
  };

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <Snowflake className="w-3 h-3" />
        {t("freeze.history.title")}
      </p>
      <ul className="space-y-2">
        {periods.map((period) => {
          const status = periodDisplayStatus(period, today);
          const canCancel =
            canManage &&
            period.status === "active" &&
            period.endDate >= today &&
            !cancelFreeze.isPending;

          return (
            <li
              key={period.id}
              className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-600 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">
                    {formatDate(new Date(`${period.startDate}T12:00:00`))}
                    {" — "}
                    {formatDate(new Date(`${period.endDate}T12:00:00`))}
                  </p>
                  <p className="text-slate-500">
                    {t("freeze.history.duration", { count: period.calendarDays })}
                    {" · "}
                    {t(`freeze.history.status.${status}`)}
                  </p>
                </div>
                {canCancel ? (
                  <button
                    type="button"
                    onClick={() => void handleCancel(period)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600 hover:underline cursor-pointer shrink-0"
                  >
                    <XCircle className="w-3 h-3" />
                    {t("freeze.history.cancel")}
                  </button>
                ) : null}
              </div>
              {period.reason ? <p className="text-slate-500">{period.reason}</p> : null}
              <p className="text-slate-400">
                {t("freeze.history.createdAt", {
                  date: formatDateTime(new Date(period.createdAt)),
                })}
                {period.cancelledAt
                  ? ` · ${t("freeze.history.cancelledAt", { date: formatDateTime(new Date(period.cancelledAt)) })}`
                  : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
