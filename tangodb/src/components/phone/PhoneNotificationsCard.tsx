import { Bell } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useStaffLessonNotificationsToggle } from "../../hooks/useStaffLessonNotifications";
import { usePermissions } from "../../hooks/usePermissions";
import {
  readNotificationsPromptDismissed,
  writeNotificationsPromptDismissed,
} from "../../lib/staffPush/preferences";
import { useState } from "react";
import { LocalNotifications } from "@capacitor/local-notifications";

export default function PhoneNotificationsCard() {
  const { t } = useI18n();
  const { role } = usePermissions();
  const { lessonRemindersEnabled, setLessonRemindersEnabled } = useStaffLessonNotificationsToggle();
  const [showPrompt, setShowPrompt] = useState(() => !readNotificationsPromptDismissed());

  if (role === "accountant") return null;

  const enableWithPermissions = async () => {
    await LocalNotifications.requestPermissions();
    await setLessonRemindersEnabled(true);
    writeNotificationsPromptDismissed();
    setShowPrompt(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{t("phone.notifications.title")}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{t("phone.notifications.description")}</p>
        </div>
      </div>

      {showPrompt && !lessonRemindersEnabled ? (
        <button
          type="button"
          onClick={() => void enableWithPermissions()}
          className="flex min-h-12 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white cursor-pointer hover:bg-indigo-700 transition-colors"
        >
          {t("phone.notifications.enable")}
        </button>
      ) : null}

      <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 cursor-pointer">
        <span className="text-sm font-semibold text-slate-800">{t("phone.notifications.toggle")}</span>
        <input
          type="checkbox"
          checked={lessonRemindersEnabled}
          onChange={(e) => void setLessonRemindersEnabled(e.target.checked)}
          className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
        />
      </label>
    </div>
  );
}
