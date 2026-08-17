import { CloudOff, WifiOff, ListChecks } from "lucide-react";
import type { ConnectionState } from "../../hooks/useOnlineStatus";
import { useI18n } from "../../hooks/useI18n";

interface OfflineBannerProps {
  connectionState: ConnectionState;
  pendingCount?: number;
  conflictCount?: number;
  snapshotSyncedAt?: string | null;
  onOpenReconciliation?: () => void;
}

function formatSyncedAt(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function OfflineBanner({
  connectionState,
  pendingCount = 0,
  conflictCount = 0,
  snapshotSyncedAt,
  onOpenReconciliation,
}: OfflineBannerProps) {
  const { t, locale } = useI18n();

  if (connectionState === "online" && pendingCount === 0 && conflictCount === 0) {
    return null;
  }

  const queueLabel =
    pendingCount + conflictCount > 0
      ? t("offline.banner.queueCount", { count: pendingCount + conflictCount })
      : null;

  if (connectionState === "online" && (pendingCount > 0 || conflictCount > 0)) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-gold-50 border-b border-gold-200 text-gold-900 text-xs font-semibold px-4 py-2 flex flex-wrap items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2">
          <ListChecks className="w-3.5 h-3.5 shrink-0" />
          {t("offline.banner.pendingSync")}
          {queueLabel ? ` · ${queueLabel}` : ""}
          {conflictCount > 0 ? ` · ${t("offline.banner.conflicts", { count: conflictCount })}` : ""}
        </span>
        {onOpenReconciliation ? (
          <button
            type="button"
            onClick={onOpenReconciliation}
            className="text-gold-700 underline underline-offset-2 cursor-pointer hover:text-gold-900"
          >
            {t("offline.banner.openReconciliation")}
          </button>
        ) : null}
      </div>
    );
  }

  if (connectionState === "server-unreachable") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-ink-100 border-b border-ink-200 text-ink-700 text-xs font-semibold px-4 py-2 flex flex-wrap items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2">
          <CloudOff className="w-3.5 h-3.5 shrink-0" />
          {t("common.offline.serverUnreachable")}
          {snapshotSyncedAt
            ? ` · ${t("offline.banner.snapshotAt", { time: formatSyncedAt(snapshotSyncedAt, locale) })}`
            : ""}
        </span>
        <span className="flex items-center gap-3">
          {queueLabel ? <span>{queueLabel}</span> : null}
          {onOpenReconciliation && (pendingCount > 0 || conflictCount > 0) ? (
            <button
              type="button"
              onClick={onOpenReconciliation}
              className="text-ink-800 underline underline-offset-2 cursor-pointer"
            >
              {t("offline.banner.openReconciliation")}
            </button>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-50 border-b border-amber-200 text-amber-700 text-xs font-semibold px-4 py-2 flex flex-wrap items-center justify-between gap-2"
    >
      <span className="flex items-center gap-2">
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        {t("offline.banner.modeOffline")}
        {snapshotSyncedAt
          ? ` · ${t("offline.banner.snapshotAt", { time: formatSyncedAt(snapshotSyncedAt, locale) })}`
          : ` · ${t("offline.banner.noSnapshot")}`}
        <span className="font-normal text-amber-700"> · {t("offline.restrictions.scopeHint")}</span>
      </span>
      <span className="flex items-center gap-3">
        {queueLabel ? <span>{queueLabel}</span> : null}
        {onOpenReconciliation ? (
          <button
            type="button"
            onClick={onOpenReconciliation}
            className="text-amber-700 underline underline-offset-2 cursor-pointer"
          >
            {t("offline.banner.openReconciliation")}
          </button>
        ) : null}
      </span>
    </div>
  );
}
