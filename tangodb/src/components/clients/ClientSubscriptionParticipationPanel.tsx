import { Ticket } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "../../hooks/useI18n";
import { usePrices } from "../../hooks/usePrices";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { useClientSubscriptionMemberChanges } from "../../hooks/useSubscriptionMemberChanges";
import { resolveClientSubscriptionParticipations } from "../../lib/subscriptionMembers";
import { toISODateLocal } from "../../lib/scheduleWeek";

interface ClientSubscriptionParticipationPanelProps {
  clientId: string;
}

export default function ClientSubscriptionParticipationPanel({
  clientId,
}: ClientSubscriptionParticipationPanelProps) {
  const { t, formatDate } = useI18n();
  const subscriptionsQuery = useSubscriptions();
  const memberChangesQuery = useClientSubscriptionMemberChanges(clientId);
  const pricesQuery = usePrices();
  const today = useMemo(() => toISODateLocal(new Date()), []);

  const participations = useMemo(() => {
    const subscriptions = subscriptionsQuery.data ?? [];
    const changes = memberChangesQuery.data ?? [];
    return resolveClientSubscriptionParticipations(clientId, subscriptions, changes, today);
  }, [clientId, subscriptionsQuery.data, memberChangesQuery.data, today]);

  if (subscriptionsQuery.isLoading || memberChangesQuery.isLoading) {
    return null;
  }

  if (participations.length === 0) {
    return null;
  }

  const prices = pricesQuery.data ?? [];

  return (
    <div className="space-y-2 border-t border-ink-100 pt-3">
      <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <Ticket className="w-3 h-3" />
        {t("clientCard.subscriptions.title")}
      </p>
      <ul className="space-y-2">
        {participations.map(({ subscription, isActive, fromDate, toDate }) => {
          const price = subscription.priceId
            ? prices.find((p) => p.id === subscription.priceId)
            : undefined;
          const tariffLabel = price?.label?.trim() || subscription.type;

          return (
            <li
              key={subscription.id}
              className="rounded-lg border border-ink-100 bg-ink-50/70 px-3 py-2 text-[11px] text-ink-600 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-ink-800">{tariffLabel}</p>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                    isActive ? "text-gold-700" : "text-ink-400"
                  }`}
                >
                  {isActive
                    ? t("clientCard.subscriptions.active")
                    : t("clientCard.subscriptions.historical")}
                </span>
              </div>
              <p className="text-ink-500">
                {t("clientCard.subscriptions.period", {
                  from: formatDate(new Date(`${fromDate}T12:00:00`)),
                  to: toDate
                    ? formatDate(new Date(`${toDate}T12:00:00`))
                    : t("clientCard.subscriptions.present"),
                })}
              </p>
              {!isActive ? null : (
                <p className="text-ink-500">
                  {t("clientCard.subscriptions.lessonsLeft", {
                    left: subscription.lessonsLeft,
                    total: subscription.lessonsTotal,
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
