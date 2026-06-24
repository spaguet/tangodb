import { Check, ShieldCheck, X } from "lucide-react";
import { useMarkPersonalLessonAttendance } from "../../hooks/usePersonalLessons";
import {
  getConnectionBlockReason,
  useOnlineStatus,
} from "../../hooks/useOnlineStatus";
import type { PersonalLesson } from "../../types";

interface PersonalLessonAttendanceActionsProps {
  lesson: PersonalLesson;
  canMark: boolean;
  compact?: boolean;
  onMarked?: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export default function PersonalLessonAttendanceActions({
  lesson,
  canMark,
  compact = false,
  onMarked,
  toast,
}: PersonalLessonAttendanceActionsProps) {
  const { connectionState } = useOnlineStatus();
  const markPersonal = useMarkPersonalLessonAttendance();

  const handleMark = async (status: "present" | "absent" | "excused") => {
    if (connectionState !== "online") {
      toast(getConnectionBlockReason(connectionState) ?? "Нет соединения", "error");
      return;
    }
    const res = await markPersonal.mutateAsync({ lessonId: lesson.id, status });
    if (!res.success) {
      toast(res.error ?? "Не удалось сохранить отметку", "error");
      return;
    }
    toast("Отметка сохранена", "success");
    onMarked?.();
  };

  if (!canMark) return null;

  const btnBase = compact
    ? "px-2 py-1 text-[10px]"
    : "px-3 py-1.5 text-xs";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => handleMark("present")}
        disabled={connectionState !== "online" || markPersonal.isPending}
        title="Пришёл"
        className={`flex items-center gap-1 rounded-lg font-semibold border transition-all cursor-pointer disabled:opacity-60 ${btnBase} ${
          lesson.attendanceStatus === "present"
            ? "bg-indigo-600 border-indigo-600 text-white"
            : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
        }`}
      >
        <Check className="w-3 h-3" />
        {!compact && "Пришёл"}
      </button>
      <button
        type="button"
        onClick={() => handleMark("absent")}
        disabled={connectionState !== "online" || markPersonal.isPending}
        title="Не пришёл"
        className={`flex items-center gap-1 rounded-lg font-semibold border transition-all cursor-pointer disabled:opacity-60 ${btnBase} ${
          lesson.attendanceStatus === "absent"
            ? "bg-rose-600 border-rose-600 text-white"
            : "bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:bg-rose-50"
        }`}
      >
        <X className="w-3 h-3" />
        {!compact && "Не пришёл"}
      </button>
      <button
        type="button"
        onClick={() => handleMark("excused")}
        disabled={connectionState !== "online" || markPersonal.isPending}
        title="Уважительный пропуск"
        className={`flex items-center gap-1 rounded-lg font-semibold border transition-all cursor-pointer disabled:opacity-60 ${btnBase} ${
          lesson.attendanceStatus === "excused"
            ? "bg-amber-600 border-amber-600 text-white"
            : "bg-white border-slate-200 text-slate-600 hover:border-amber-300 hover:bg-amber-50"
        }`}
      >
        <ShieldCheck className="w-3 h-3" />
        {!compact && "Уважит."}
      </button>
    </div>
  );
}
