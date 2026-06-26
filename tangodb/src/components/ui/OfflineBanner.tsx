import { CloudOff, WifiOff } from "lucide-react";
import type { ConnectionState } from "../../hooks/useOnlineStatus";
import { useI18n } from "../../hooks/useI18n";

interface OfflineBannerProps {
  connectionState: ConnectionState;
}

export default function OfflineBanner({ connectionState }: OfflineBannerProps) {
  const { t } = useI18n();

  if (connectionState === "online") return null;

  if (connectionState === "server-unreachable") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-slate-100 border-b border-slate-200 text-slate-700 text-xs font-semibold px-4 py-2 flex items-center gap-2"
      >
        <CloudOff className="w-3.5 h-3.5 shrink-0" />
        {t("common.offline.serverUnreachable")}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-semibold px-4 py-2 flex items-center gap-2"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      {t("common.offline.noInternet")}
    </div>
  );
}
