import DemoPurchaseCta from "./DemoPurchaseCta";
import { DEMO_URGENCY_TEXT_CLASS } from "../../lib/demoLicense";
import { useDemoLicenseUi } from "../../hooks/useDemoLicenseUi";

export default function DemoDashboardBanner() {
  const { isDemo, showPurchaseCta, daysLeftLabel, expiryDate, purgeDate, urgency, status } =
    useDemoLicenseUi();

  if (!isDemo || !showPurchaseCta) return null;

  const toneClass = DEMO_URGENCY_TEXT_CLASS[urgency];
  const isRetention = status === "demo_retention";

  return (
    <div
      className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
        isRetention
          ? "bg-amber-50 border-amber-100"
          : urgency === "critical"
            ? "bg-rose-50 border-rose-100"
            : urgency === "warning"
              ? "bg-amber-50 border-amber-100"
              : "bg-indigo-50 border-indigo-100"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${toneClass}`}>
          {isRetention ? "Демо завершено — CRM только для просмотра" : "Вы используете демо-версию TangoDB"}
        </p>
        <p className="text-xs text-slate-600 mt-0.5">
          {isRetention ? (
            <>
              Активируйте полную версию, чтобы продолжить работу
              {purgeDate !== "—" ? ` · данные будут удалены ${purgeDate}` : ""}
            </>
          ) : (
            <>
              {daysLeftLabel ? `${daysLeftLabel.charAt(0).toUpperCase()}${daysLeftLabel.slice(1)}` : "Демо-доступ"}
              {expiryDate !== "—" ? ` · до ${expiryDate}` : ""}
            </>
          )}
        </p>
      </div>
      <DemoPurchaseCta variant="banner" />
    </div>
  );
}
