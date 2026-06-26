import { AlertCircle } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

interface QueryErrorStateProps {
  message?: string;
  error?: Error | null;
}

export default function QueryErrorState({ message, error }: QueryErrorStateProps) {
  const { t } = useI18n();

  return (
    <div className="p-6 text-center text-rose-600">
      <AlertCircle className="w-8 h-8 mx-auto mb-2" />
      <p className="font-semibold">{message ?? t("common.error.loadFailed")}</p>
      {error?.message ? (
        <p className="text-xs text-slate-500 mt-1">{error.message}</p>
      ) : null}
    </div>
  );
}
