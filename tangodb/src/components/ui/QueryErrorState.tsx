import { AlertCircle, RefreshCw } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

interface QueryErrorStateProps {
  message?: string;
  error?: Error | null;
  onRetry?: () => void;
}

export default function QueryErrorState({ message, error, onRetry }: QueryErrorStateProps) {
  const { t } = useI18n();

  return (
    <div className="p-6 text-center text-rose-600">
      <AlertCircle className="w-8 h-8 mx-auto mb-2" />
      <p className="font-semibold">{message ?? t("common.error.loadFailed")}</p>
      {error?.message ? (
        <p className="text-xs text-slate-500 mt-1">{error.message}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t("common.retryLoad")}
        </button>
      ) : null}
    </div>
  );
}
