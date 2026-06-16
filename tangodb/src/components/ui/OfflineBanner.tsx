import { WifiOff } from "lucide-react";

interface OfflineBannerProps {
  isOnline: boolean;
}

export default function OfflineBanner({ isOnline }: OfflineBannerProps) {
  if (isOnline) return null;

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
