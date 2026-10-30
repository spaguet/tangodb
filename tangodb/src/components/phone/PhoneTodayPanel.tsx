import { useNavigate } from "react-router-dom";
import { Calendar, CalendarCheck } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { APP_VERSION } from "../../lib/appVersion";

/** Overview tab — shortcuts into journal and schedule (same CRM modules as desktop). */
export default function PhoneTodayPanel() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{t("phone.home.badge")}</p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{t("phone.home.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{t("phone.home.body")}</p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={() => navigate("/attendance")}
          className="w-full min-h-12 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 cursor-pointer touch-manipulation"
        >
          <CalendarCheck className="h-4 w-4 shrink-0" />
          {t("phone.tab.attendance")}
        </button>
        <button
          type="button"
          onClick={() => navigate("/schedule")}
          className="w-full min-h-12 flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer touch-manipulation"
        >
          <Calendar className="h-4 w-4 shrink-0 text-indigo-600" />
          {t("phone.tab.schedule")}
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        {t("phone.home.versionHint")} v{APP_VERSION}
      </p>
    </div>
  );
}
