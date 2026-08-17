import { RefreshCw } from "lucide-react";
import type { Client } from "../../types";
import { useSubscriptionMemberChanges } from "../../hooks/useSubscriptionMemberChanges";
import { useI18n } from "../../hooks/useI18n";
import { formatClientName } from "../../lib/utils";
import { toISODateLocal } from "../../lib/scheduleWeek";

interface SubscriptionMemberChangeHistoryProps {
  subscriptionId: string;
  clientMap: Record<string, Client>;
}

export default function SubscriptionMemberChangeHistory({
  subscriptionId,
  clientMap,
}: SubscriptionMemberChangeHistoryProps) {
  const { t, formatDate, formatDateTime } = useI18n();
  const { data: changes = [] } = useSubscriptionMemberChanges(subscriptionId);
  const today = toISODateLocal(new Date());

  if (changes.length === 0) return null;

  const clientLabel = (id: string) => {
    const client = clientMap[id];
    return client ? formatClientName(client.lastName, client.firstName) : id;
  };

  return (
    <div className="space-y-2 border-t border-ink-100 pt-3">
      <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3" />
        {t("subscriptions.partnerReplace.history.title")}
      </p>
      <ul className="space-y-2">
        {changes.map((change) => {
          const displayStatus =
            change.status === "cancelled"
              ? "cancelled"
              : change.status === "scheduled"
                ? "scheduled"
                : change.effectiveDate > today
                  ? "scheduled"
                  : "applied";

          return (
            <li
              key={change.id}
              className="rounded-lg border border-ink-100 bg-ink-50/70 px-3 py-2 text-[11px] text-ink-600 space-y-1"
            >
              <p className="font-semibold text-ink-800">
                {clientLabel(change.outgoingClientId)}
                {" → "}
                {clientLabel(change.incomingClientId)}
              </p>
              <p className="text-ink-500">
                {t("subscriptions.partnerReplace.history.effective", {
                  date: formatDate(new Date(`${change.effectiveDate}T12:00:00`)),
                })}
                {" · "}
                {t(`subscriptions.partnerReplace.history.status.${displayStatus}`)}
              </p>
              {change.reason ? <p className="text-ink-500">{change.reason}</p> : null}
              <p className="text-ink-400">
                {t("subscriptions.partnerReplace.history.createdAt", {
                  date: formatDateTime(new Date(change.createdAt)),
                })}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
