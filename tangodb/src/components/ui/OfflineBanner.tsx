import { CloudOff, WifiOff } from "lucide-react";
import type { ConnectionState } from "../../hooks/useOnlineStatus";

interface OfflineBannerProps {
  connectionState: ConnectionState;
}

export default function OfflineBanner({ connectionState }: OfflineBannerProps) {
  if (connectionState === "online") return null;

  if (connectionState === "server-unreachable") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-slate-100 border-b border-slate-200 text-slate-700 text-xs font-semibold px-4 py-2 flex items-center gap-2"
      >
        <CloudOff className="w-3.5 h-3.5 shrink-0" />
        Сервер временно недоступен. Можно просматривать сохранённые данные.
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
      Нет соединения с интернетом. Изменения могут не сохраниться.
    </div>
  );
}
