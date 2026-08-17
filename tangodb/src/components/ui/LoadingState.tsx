import { Loader2 } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

export default function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
      <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
      <p className="text-xs font-normal">{label ?? t("common.loading.data")}</p>
    </div>
  );
}
