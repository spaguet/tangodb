import { Check, ShieldCheck, X } from "lucide-react";
import { useMarkPersonalLessonAttendance } from "../../hooks/usePersonalLessons";
import {
  translateConnectionBlockReason,
  useOnlineStatus,
} from "../../hooks/useOnlineStatus";
import { useI18n } from "../../hooks/useI18n";
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
  const { t } = useI18n();
  const { connectionState } = useOnlineStatus();
  const markPersonal = useMarkPersonalLessonAttendance();

  const handleMark = async (status: "present" | "absent" | "excused") => {
    if (connectionState !== "online") {
      toast(translateConnectionBlockReason(connectionState, t) ?? t("common.noConnection"), "error");
      return;
    }
    const res = await markPersonal.mutateAsync({ lessonId: lesson.id, status });
    if (!res.success) {
      toast(res.error ?? t("common.saveMarkFailed"), "error");
      return;
    }
    toast(t("common.markSaved"), "success");
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
        title={t("common.present")}
        className={`flex items-center gap-1 rounded-lg font-semibold border transition-all cursor-pointer disabled:opacity-60 ${btnBase} ${
          lesson.attendanceStatus === "present"
            ? "bg-gold-700 border-gold-700 text-white"
            : "bg-white border-ink-200 text-ink-600 hover:border-gold-300 hover:bg-gold-50"
        }`}
      >
        <Check className="w-3 h-3" />
        {!compact && t("common.present")}
      </button>
      <button
        type="button"
        onClick={() => handleMark("absent")}
        disabled={connectionState !== "online" || markPersonal.isPending}
        title={t("common.absent")}
        className={`flex items-center gap-1 rounded-lg font-semibold border transition-all cursor-pointer disabled:opacity-60 ${btnBase} ${
          lesson.attendanceStatus === "absent"
            ? "bg-garnet-600 border-garnet-600 text-white"
            : "bg-white border-ink-200 text-ink-600 hover:border-garnet-300 hover:bg-garnet-50"
        }`}
      >
        <X className="w-3 h-3" />
        {!compact && t("common.absent")}
      </button>
      <button
        type="button"
        onClick={() => handleMark("excused")}
        disabled={connectionState !== "online" || markPersonal.isPending}
        title={t("common.excusedFull")}
        className={`flex items-center gap-1 rounded-lg font-semibold border transition-all cursor-pointer disabled:opacity-60 ${btnBase} ${
          lesson.attendanceStatus === "excused"
            ? "bg-ink-600 border-ink-600 text-white"
            : "bg-white border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-ink-50"
        }`}
      >
        <ShieldCheck className="w-3 h-3" />
        {!compact && t("common.excusedShort")}
      </button>
    </div>
  );
}
