import { Info } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

export default function OfflineScopeNotice() {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-900 space-y-1">
      <p className="font-semibold flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0" />
        {t("offline.restrictions.scopeTitle")}
      </p>
      <p className="text-amber-800/90 leading-relaxed">{t("offline.restrictions.scopeHint")}</p>
    </div>
  );
}
