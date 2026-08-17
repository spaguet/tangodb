import { DEMO_URGENCY_TEXT_CLASS } from "../../lib/demoLicense";
import { useDemoLicenseUi } from "../../hooks/useDemoLicenseUi";
import { useI18n } from "../../hooks/useI18n";

interface DemoBrandBadgeProps {
  compact?: boolean;
}

export default function DemoBrandBadge({ compact = false }: DemoBrandBadgeProps) {
  const { t } = useI18n();
  const { isDemo, daysLeftLabel, expiryDate, purgeDate, urgency, status } = useDemoLicenseUi();

  if (!isDemo) return null;

  const toneClass = DEMO_URGENCY_TEXT_CLASS[urgency];
  const tooltip =
    status === "demo_retention"
      ? t("demo.badge.tooltipRetention", { date: purgeDate !== "—" ? purgeDate : "" })
      : t("demo.badge.tooltipActive", { date: expiryDate });

  return (
    <div className={compact ? "mt-0.5" : "mt-1"} title={tooltip}>
      <p className={`text-[10px] font-semibold uppercase tracking-wider leading-tight ${toneClass}`}>
        {t("demo.badge.label")}
      </p>
      {daysLeftLabel && (
        <p className={`text-[10px] leading-tight mt-0.5 ${toneClass}`}>{daysLeftLabel}</p>
      )}
      {!compact && status === "demo_active" && expiryDate !== "—" && (
        <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
          {t("demo.badge.untilDate", { date: expiryDate })}
        </p>
      )}
      {!compact && status === "demo_retention" && purgeDate !== "—" && (
        <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
          {t("demo.badge.purgeDate", { date: purgeDate })}
        </p>
      )}
    </div>
  );
}
