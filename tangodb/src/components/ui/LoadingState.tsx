import { Loader2 } from "lucide-react";

export default function LoadingState({ label = "Загрузка данных..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
      <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
      <p className="text-xs font-medium">{label}</p>
    </div>
  );
}
