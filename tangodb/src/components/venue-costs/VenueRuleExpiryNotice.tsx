import { AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../../hooks/useI18n";
import type { VenueCostRuleStatus } from "../../hooks/useVenueCosts";
import { isVenuePaymentAckRequired } from "../../lib/venueCostPaymentGate";

interface VenueRuleExpiryNoticeProps {
  status: VenueCostRuleStatus;
  compact?: boolean;
  /** Lesson / visit date — suppress notice when the rule still covers this day. */
  serviceDate?: string | null;
}

export default function VenueRuleExpiryNotice({
  status,
  compact = false,
  serviceDate,
}: VenueRuleExpiryNoticeProps) {
  const { t, formatDate } = useI18n();
  if (
    !isVenuePaymentAckRequired(
      status.acknowledgementRequired,
      status.latestValidTo,
      serviceDate
    )
  ) {
    return null;
  }

  return (
    <div className={`rounded-xl border border-amber-200 bg-amber-50 text-amber-900 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("venueCosts.expiry.title")}</p>
          <p className="text-xs mt-1 leading-relaxed">
            {t("venueCosts.expiry.body", {
              date: status.latestValidTo ? formatDate(status.latestValidTo) : "—",
              count: status.pendingUnpricedCount,
            })}
          </p>
          {!compact && (
            <Link
              to="/settings/hall-rent"
              className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-amber-900 hover:underline"
            >
              {t("venueCosts.expiry.openSettings")}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
