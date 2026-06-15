import { AlertCircle } from "lucide-react";

interface QueryErrorStateProps {
  message?: string;
  error?: Error | null;
}

export default function QueryErrorState({
  message = "Не удалось загрузить данные",
  error,
}: QueryErrorStateProps) {
  return (
    <div className="p-6 text-center text-rose-600">
      <AlertCircle className="w-8 h-8 mx-auto mb-2" />
      <p className="font-semibold">{message}</p>
      {error?.message ? (
        <p className="text-xs text-slate-500 mt-1">{error.message}</p>
      ) : null}
    </div>
  );
}
