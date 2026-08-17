import { AlertTriangle, CalendarOff, CheckCircle2, Loader2 } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import type { I18nKey } from "../../lib/i18n/keys";
import type { LessonGoogleSyncUiStatus } from "../../lib/googleCalendarApi";

interface GoogleCalendarSyncStatusBadgeProps {
  status: LessonGoogleSyncUiStatus | null;
  lastError?: string | null;
  compact?: boolean;
}

const toneByStatus: Record<
  LessonGoogleSyncUiStatus,
  { wrap: string; icon: typeof CheckCircle2 }
> = {
  synced: {
    wrap: "text-emerald-700 bg-emerald-50 border-emerald-100",
    icon: CheckCircle2,
  },
  pending: {
    wrap: "text-amber-800 bg-amber-50 border-amber-100",
    icon: Loader2,
  },
  error: {
    wrap: "text-rose-700 bg-rose-50 border-rose-100",
    icon: AlertTriangle,
  },
  not_connected: {
    wrap: "text-slate-600 bg-slate-50 border-slate-200",
    icon: CalendarOff,
  },
};

export default function GoogleCalendarSyncStatusBadge({
  status,
  lastError,
  compact = false,
}: GoogleCalendarSyncStatusBadgeProps) {
  const { t } = useI18n();

  if (!status) return null;

  const tone = toneByStatus[status];
  const Icon = tone.icon;
  const labelKey = `integrations.googleCalendar.lessonSync.${status}` as I18nKey;

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${tone.wrap} ${
        compact ? "text-[11px]" : "text-xs"
      }`}
      title={status === "error" && lastError ? lastError : undefined}
    >
      <Icon
        className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${status === "pending" ? "animate-spin" : ""}`}
      />
      <div className="min-w-0">
        <p className="font-medium">{t(labelKey)}</p>
        {status === "error" && lastError && !compact && (
          <p className="mt-0.5 opacity-90 break-words">{lastError}</p>
        )}
      </div>
    </div>
  );
}
