import { CheckCircle2, Coins, Edit, RotateCcw, Trash2 } from "lucide-react";
import {
  canPayPersonalLesson,
  canReadLessonClients,
  canShowPaidStatus,
  canWritePersonalLesson,
  maskClientDisplay,
} from "../../lib/scheduleLessonAccess";
import { isPersonalLessonLockedForWrite, toISODateLocal } from "../../lib/scheduleWeek";
import { formatCurrency } from "../../lib/utils";
import { personalLessonHasScheduleDebt, personalLessonRemainingAmount } from "../../lib/personalLessonPayment";
import { formatReopenLessonError } from "../../lib/venueCostDraftErrors";
import { useI18n } from "../../hooks/useI18n";
import {
  useClosePersonalLessonOccurrence,
  useReopenLessonOccurrenceClosure,
  type LessonOccurrenceClosure,
} from "../../hooks/useVenueCosts";
import type { PersonalLesson } from "../../types";
import type { MemberRole } from "../../types/organization";
import type { PermissionAction } from "../../lib/permissions";
import PersonalLessonAttendanceActions from "./PersonalLessonAttendanceActions";
import { personalLessonTypeLabel } from "./personalLessonFilterUtils";

type CanFn = (action: PermissionAction, context?: { disciplineId?: string | null; locationId?: string | null }) => boolean;

interface PersonalLessonRowProps {
  lesson: PersonalLesson;
  role: MemberRole | null;
  memberId: string | null;
  isReadOnly: boolean;
  canEditPastSchedule?: boolean;
  can: CanFn;
  showPrice: boolean;
  locationName?: string;
  disciplineName?: string;
  teacherName?: string;
  closedClosure?: LessonOccurrenceClosure | null;
  onEdit: (lesson: PersonalLesson) => void;
  onDelete: (lesson: PersonalLesson) => void;
  onPay: (lesson: PersonalLesson) => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

function PaymentBadge({
  lesson,
  t,
  showAmount,
}: {
  lesson: PersonalLesson;
  t: ReturnType<typeof useI18n>["t"];
  showAmount: boolean;
}) {
  if (lesson.subscriptionId) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        {t("personal.row.package")}
      </span>
    );
  }
  if (!personalLessonHasScheduleDebt(lesson)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        {t("personal.row.paid")}
      </span>
    );
  }
  const debt = personalLessonRemainingAmount(lesson.price, lesson.paidAmount);
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      {t("personal.row.debt")}
      {showAmount && lesson.paidAmount > 0 ? ` · ${formatCurrency(debt)}` : ""}
    </span>
  );
}

function AttendanceBadge({ lesson, t }: { lesson: PersonalLesson; t: ReturnType<typeof useI18n>["t"] }) {
  if (!lesson.attendanceStatus) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">
        {t("common.notMarked")}
      </span>
    );
  }
  if (lesson.attendanceStatus === "present") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        {lesson.subscriptionId ? t("common.charged") : t("personal.row.presentCharged")}
      </span>
    );
  }
  if (lesson.attendanceStatus === "absent") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        {lesson.subscriptionId ? t("common.charged") : t("personal.row.absentCharged")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      {t("personal.row.excusedSkip")}
    </span>
  );
}

export default function PersonalLessonRow({
  lesson,
  role,
  memberId,
  isReadOnly,
  canEditPastSchedule = false,
  can,
  showPrice,
  locationName,
  disciplineName,
  teacherName,
  closedClosure = null,
  onEdit,
  onDelete,
  onPay,
  toast,
}: PersonalLessonRowProps) {
  const { t } = useI18n();
  const closePersonalLesson = useClosePersonalLessonOccurrence();
  const reopenLessonClosure = useReopenLessonOccurrenceClosure();
  const todayISO = toISODateLocal(new Date());
  const canMarkAttendance = lesson.date <= todayISO;
  const canClose =
    !isReadOnly &&
    lesson.date <= todayISO &&
    (can("personal_lessons.write", {
      disciplineId: lesson.disciplineId,
      locationId: lesson.locationId,
    }) ||
      can("finance.read"));
  const canReopen = can("finance.read");
  const activeClosure = closedClosure;
  const displayLesson = {
    kind: "personal" as const,
    lessonId: lesson.id,
    date: lesson.date,
    timeStart: lesson.timeStart,
    timeEnd: lesson.timeEnd,
    paid: lesson.paid,
    disciplineId: lesson.disciplineId ?? null,
    locationId: lesson.locationId ?? null,
    teacherMemberId: lesson.teacherMemberId ?? null,
    clientDisplay: lesson.clientDisplay,
  };

  const canReadClients = canReadLessonClients(role, displayLesson, can);
  const clientLabel = maskClientDisplay(lesson.clientDisplay, canReadClients);
  const canWrite =
    canWritePersonalLesson(role, memberId, displayLesson, can, isReadOnly, canEditPastSchedule) &&
    !isPersonalLessonLockedForWrite(lesson.date, canEditPastSchedule);
  const canDelete = canWrite;
  const canPay = canPayPersonalLesson(role, memberId, displayLesson, can, isReadOnly);

  const handleClose = async () => {
    const res = await closePersonalLesson.mutateAsync({ personalLessonId: lesson.id });
    if (res.success === false) {
      toast(t("venueCosts.closeLesson.error", { error: res.error }), "error");
      return;
    }
    if (res.amount != null) {
      toast(
        `${t("venueCosts.closeLesson.success")} · ${t("venueCosts.closeLesson.amount", {
          amount: formatCurrency(res.amount),
        })}`,
        "success"
      );
    } else {
      toast(t("venueCosts.closeLesson.success"), "success");
    }
  };

  const handleReopen = async () => {
    if (!activeClosure) return;
    const reason = window.prompt(t("venueCosts.reopenLesson.reason"));
    if (reason == null) return;
    if (!reason.trim()) {
      toast(formatReopenLessonError("reason_required", t), "error");
      return;
    }
    const res = await reopenLessonClosure.mutateAsync({
      closureId: activeClosure.id,
      reason: reason.trim(),
    });
    if (!res.success) {
      toast(formatReopenLessonError(res.error, t), "error");
      return;
    }
    toast(t("venueCosts.reopenLesson.success"), "success");
  };

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
      <td className="py-3 px-3 text-xs text-slate-800 whitespace-nowrap">
        {lesson.timeStart}–{lesson.timeEnd}
      </td>
      <td className="py-3 px-3 text-xs text-slate-600">{locationName ?? "—"}</td>
      <td className="py-3 px-3 text-xs text-slate-600">{disciplineName ?? "—"}</td>
      <td className="py-3 px-3 text-xs text-slate-600">{teacherName ?? "—"}</td>
      <td className="py-3 px-3 text-xs text-slate-800 font-medium">{clientLabel}</td>
      <td className="py-3 px-3 text-xs text-slate-500">{personalLessonTypeLabel(lesson.type, t)}</td>
      <td className="py-3 px-3">
        <div className="flex flex-wrap gap-1">
          <PaymentBadge lesson={lesson} t={t} showAmount={showPrice} />
          {(canShowPaidStatus(role) || !lesson.subscriptionId) && <AttendanceBadge lesson={lesson} t={t} />}
        </div>
      </td>
      <td className="py-3 px-3 text-xs text-slate-800 whitespace-nowrap">
        {showPrice ? (lesson.subscriptionId ? "—" : formatCurrency(lesson.price)) : "—"}
      </td>
      <td className="py-3 px-3">
        {canMarkAttendance && (
          <PersonalLessonAttendanceActions
            lesson={lesson}
            canMark={canMarkAttendance}
            compact
            toast={toast}
          />
        )}
      </td>
      <td className="py-3 px-3">
        <div className="flex items-center gap-1">
          {canPay && (
            <button
              type="button"
              onClick={() => onPay(lesson)}
              title={t("common.pay")}
              className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 cursor-pointer transition-colors"
            >
              <Coins className="w-3.5 h-3.5" />
            </button>
          )}
          {canClose && !activeClosure && (
            <button
              type="button"
              onClick={() => void handleClose()}
              disabled={closePersonalLesson.isPending}
              title={t("venueCosts.closeLesson")}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors disabled:opacity-60"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          )}
          {activeClosure && canReopen && (
            <button
              type="button"
              onClick={() => void handleReopen()}
              disabled={reopenLessonClosure.isPending}
              title={t("venueCosts.reopenLesson")}
              className="p-1.5 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors disabled:opacity-60"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {activeClosure && !canReopen && (
            <span
              title={t("venueCosts.closeLesson.closed")}
              className="p-1.5 rounded-lg text-indigo-600"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </span>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={() => onEdit(lesson)}
              title={t("common.edit")}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(lesson)}
              title={t("common.delete")}
              className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
