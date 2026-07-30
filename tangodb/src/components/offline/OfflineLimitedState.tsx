import { CloudOff, Clock, MapPin } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import type { SnapshotLocation } from "../../lib/offline/types";

interface OfflineLimitedStateProps {
  reason: "missing" | "expired";
  windowStart?: string | null;
  windowEnd?: string | null;
  locations?: SnapshotLocation[];
}

export default function OfflineLimitedState({
  reason,
  windowStart,
  windowEnd,
  locations,
}: OfflineLimitedStateProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6 text-center space-y-3">
      <CloudOff className="w-10 h-10 mx-auto text-amber-700" />
      <h3 className="font-semibold text-slate-800">
        {reason === "expired"
          ? t("offline.limited.expiredTitle")
          : t("offline.limited.missingTitle")}
      </h3>
      <p className="text-sm text-slate-600 max-w-md mx-auto">
        {reason === "expired"
          ? t("offline.limited.expiredHint")
          : t("offline.limited.missingHint")}
      </p>
      {locations && locations.length > 0 ? (
        <div className="text-xs text-slate-500 max-w-md mx-auto space-y-1">
          <p className="font-semibold uppercase tracking-wider flex items-center justify-center gap-1">
            <MapPin className="w-3 h-3" />
            {t("offline.limited.locationsTitle")}
          </p>
          <p>{locations.map((loc) => loc.name).join(", ")}</p>
        </div>
      ) : null}
      <div className="text-xs text-slate-500 space-y-1">
        <p className="font-semibold uppercase tracking-wider">{t("offline.limited.fallbackTitle")}</p>
        <p>{t("offline.limited.fallbackSteps")}</p>
      </div>
      {windowStart && windowEnd ? (
        <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1">
          <Clock className="w-3 h-3" />
          {t("offline.snapshot.window", { start: windowStart, end: windowEnd })}
        </p>
      ) : null}
    </div>
  );
}
