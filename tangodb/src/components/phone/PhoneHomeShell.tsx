import { useI18n } from "../../hooks/useI18n";
import { APP_VERSION } from "../../lib/appVersion";

export default function PhoneHomeShell() {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{t("phone.home.badge")}</p>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">{t("phone.home.title")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{t("phone.home.body")}</p>
      <p className="mt-6 text-[11px] text-slate-400">
        {t("phone.home.versionHint")} v{APP_VERSION}
      </p>
    </div>
  );
}
