import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { UserPlus, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { canAssignLessonSubstitute } from "../../lib/lessonSubstitute";
import { useAssignLessonSubstitute, useClearLessonSubstitute } from "../../hooks/useLessonSubstitutes";
import { useTeamMembers, memberListLabel } from "../../hooks/useTeamMembers";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useI18n } from "../../hooks/useI18n";
import type { GroupDisplayLesson, PersonalDisplayLesson } from "../../types";
import AppSelect from "../ui/AppSelect";
import { btnAddCls, btnCancelCls, btnDestructiveCls } from "../ui/buttonStyles";

interface SubstituteLessonDialogProps {
  lesson: GroupDisplayLesson | PersonalDisplayLesson | null;
  teacherName?: string;
  substituteTeacherName?: string;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SubstituteLessonDialog({
  lesson,
  teacherName,
  substituteTeacherName,
  toast,
  onClose,
  onSuccess,
}: SubstituteLessonDialogProps) {
  const { t, formatDate } = useI18n();
  const { memberId } = useOrganization();
  const { role, isReadOnly, options } = usePermissions();
  const assignSubstitute = useAssignLessonSubstitute();
  const clearSubstitute = useClearLessonSubstitute();
  const teamQuery = useTeamMembers();

  const [substituteId, setSubstituteId] = useState("");

  const originalTeacherId = lesson?.teacherMemberId ?? null;
  const existingSubstituteId = lesson?.substituteTeacherMemberId ?? null;

  useEffect(() => {
    if (!lesson) return;
    setSubstituteId(lesson.substituteTeacherMemberId ?? "");
  }, [lesson]);

  useEffect(() => {
    if (!lesson) return;
    const pending = assignSubstitute.isPending || clearSubstitute.isPending;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lesson, assignSubstitute.isPending, clearSubstitute.isPending, onClose]);

  const canAssign = canAssignLessonSubstitute({
    role,
    memberId,
    originalTeacherMemberId: originalTeacherId,
    isReadOnly,
    restrictedAdmin: options.restrictedAdmin,
  });

  const teacherOptions = useMemo(
    () =>
      (teamQuery.data ?? []).filter(
        (member) =>
          member.role === "teacher" &&
          member.is_active &&
          member.id !== originalTeacherId
      ),
    [teamQuery.data, originalTeacherId]
  );

  if (!lesson || !canAssign) return null;

  const pending = assignSubstitute.isPending || clearSubstitute.isPending;
  const title =
    lesson.kind === "group"
      ? lesson.groupName?.trim() || t("common.groupLesson")
      : t("common.personalLesson");

  const handleSave = async () => {
    if (!substituteId) {
      toast(t("schedule.substitute.error.pickTeacher"), "error");
      return;
    }
    const res = await assignSubstitute.mutateAsync({
      occurrenceKind: lesson.kind,
      occurrenceDate: lesson.date,
      scheduleSlotId: lesson.kind === "group" ? lesson.slotId : null,
      personalLessonId: lesson.kind === "personal" ? lesson.lessonId : null,
      substituteMemberId: substituteId,
    });
    if (res.success === false) {
      toast(resolveMutationError(res.error, "schedule.substitute.error.saveFailed", t), "error");
      return;
    }
    toast(t("schedule.substitute.assigned"), "success");
    onSuccess();
    onClose();
  };

  const handleClear = async () => {
    const res = await clearSubstitute.mutateAsync({
      occurrenceKind: lesson.kind,
      occurrenceDate: lesson.date,
      scheduleSlotId: lesson.kind === "group" ? lesson.slotId : null,
      personalLessonId: lesson.kind === "personal" ? lesson.lessonId : null,
    });
    if (res.success === false) {
      toast(resolveMutationError(res.error, "schedule.substitute.error.clearFailed", t), "error");
      return;
    }
    toast(t("schedule.substitute.cleared"), "success");
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            if (!pending) onClose();
          }}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
        />
        <motion.div
          initial={{ scale: 0.97, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0, y: 8 }}
          transition={{ duration: 0.18 }}
          className="relative bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-4 panel-card-stack"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                {t("schedule.substitute.title")}
              </p>
              <h3 className="text-base font-semibold tracking-tight text-slate-900 break-words">
                {title}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {formatDate(lesson.date)} · {lesson.timeStart} – {lesson.timeEnd}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              aria-label={t("common.close")}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            {t("schedule.substitute.hint", {
              teacher: teacherName ?? t("schedule.form.teacher"),
            })}
          </p>

          {existingSubstituteId && substituteTeacherName ? (
            <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
              {t("schedule.substitute.current", { name: substituteTeacherName })}
            </p>
          ) : null}

          <AppSelect
            label={t("schedule.substitute.pickTeacher")}
            value={substituteId}
            onChange={(e) => setSubstituteId(e.target.value)}
            disabled={pending}
          >
            <option value="">{t("schedule.substitute.pickPlaceholder")}</option>
            {teacherOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {memberListLabel(member)}
              </option>
            ))}
          </AppSelect>

          {teacherOptions.length === 0 ? (
            <p className="text-xs text-slate-500">{t("schedule.substitute.noTeachers")}</p>
          ) : null}

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={pending || teacherOptions.length === 0}
              className={`w-full ${btnAddCls}`}
            >
              <UserPlus className="w-4 h-4" />
              {pending ? t("common.saving") : t("schedule.substitute.confirm")}
            </button>
            {existingSubstituteId ? (
              <button
                type="button"
                onClick={() => void handleClear()}
                disabled={pending}
                className={`w-full ${btnDestructiveCls}`}
              >
                {t("schedule.substitute.clear")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className={`w-full ${btnCancelCls}`}
            >
              {t("common.cancel")}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
