import DemoPurchaseCta from "./DemoPurchaseCta";
import { DEMO_URGENCY_TEXT_CLASS } from "../../lib/demoLicense";
import { useDemoLicenseUi } from "../../hooks/useDemoLicenseUi";
import { useI18n } from "../../hooks/useI18n";

export default function DemoDashboardBanner() {
  const { t } = useI18n();
  const { isDemo, showPurchaseCta, daysLeftLabel, expiryDate, purgeDate, urgency, status } =
    useDemoLicenseUi();

  if (!isDemo || !showPurchaseCta) return null;

  const toneClass = DEMO_URGENCY_TEXT_CLASS[urgency];
  const isRetention = status === "demo_retention";

  return (
    <div
      className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
        isRetention
          ? "bg-amber-50 border-amber-200"
          : urgency === "critical"
            ? "bg-garnet-50 border-garnet-100"
            : urgency === "warning"
              ? "bg-amber-50 border-amber-200"
              : "bg-gold-50 border-gold-100"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${toneClass}`}>
          {isRetention ? t("demo.banner.retentionTitle") : t("demo.banner.activeTitle")}
        </p>
        <p className="text-xs text-ink-600 mt-0.5">
          {isRetention ? (
            <>
              {t("demo.banner.retentionActivate")}
              {purgeDate !== "—" ? ` · ${t("demo.banner.purgeHint", { date: purgeDate })}` : ""}
            </>
          ) : (
            <>
              {daysLeftLabel
                ? `${daysLeftLabel.charAt(0).toUpperCase()}${daysLeftLabel.slice(1)}`
                : t("demo.banner.demoAccess")}
              {expiryDate !== "—" ? ` · ${t("demo.banner.untilDate", { date: expiryDate })}` : ""}
            </>
          )}
        </p>
      </div>
      <DemoPurchaseCta variant="banner" />
    </div>
  );
}
