import { AlertTriangle } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

interface GoogleCalendarFreebusyWarningProps {
  visible: boolean;
  checking?: boolean;
}

export default function GoogleCalendarFreebusyWarning({
  visible,
  checking = false,
}: GoogleCalendarFreebusyWarningProps) {
  const { t } = useI18n();

  if (!visible && !checking) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>
        {checking
          ? t("integrations.googleCalendar.freebusy.checking")
          : t("integrations.googleCalendar.freebusy.overlapWarning")}
      </span>
    </div>
  );
}
