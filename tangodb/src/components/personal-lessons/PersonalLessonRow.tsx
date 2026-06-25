import { Coins, Edit, Trash2 } from "lucide-react";
import {
  canPayPersonalLesson,
  canReadLessonClients,
  canShowPaidStatus,
  canWritePersonalLesson,
  maskClientDisplay,
} from "../../lib/scheduleLessonAccess";
import { isPastDate, isPersonalLessonLockedForWrite, toISODateLocal } from "../../lib/scheduleWeek";
import { formatCurrency } from "../../lib/utils";
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
  can: CanFn;
  showPrice: boolean;
  locationName?: string;
  disciplineName?: string;
  teacherName?: string;
  onEdit: (lesson: PersonalLesson) => void;
  onDelete: (lesson: PersonalLesson) => void;
  onPay: (lesson: PersonalLesson) => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

function PaymentBadge({ lesson }: { lesson: PersonalLesson }) {
  if (lesson.subscriptionId) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200">
        Пакет
      </span>
    );
  }
  if (lesson.paid === "yes") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        Оплачено
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      Долг
    </span>
  );
}

function AttendanceBadge({ lesson }: { lesson: PersonalLesson }) {
  if (!lesson.attendanceStatus) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">
        Не отмечено
      </span>
    );
  }
  if (lesson.attendanceStatus === "present") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        {lesson.subscriptionId ? "Списано" : "Пришёл"}
      </span>
    );
  }
  if (lesson.attendanceStatus === "absent") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        {lesson.subscriptionId ? "Списано" : "Не пришёл"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
      Уважит. пропуск
    </span>
  );
}

export default function PersonalLessonRow({
  lesson,
  role,
  memberId,
  isReadOnly,
  can,
  showPrice,
  locationName,
  disciplineName,
  teacherName,
  onEdit,
  onDelete,
  onPay,
  toast,
}: PersonalLessonRowProps) {
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
  const isPast = isPastDate(lesson.date);
  const canWrite =
    canWritePersonalLesson(role, memberId, displayLesson, can, isReadOnly) &&
    !isPersonalLessonLockedForWrite(lesson.date);
  const canDelete = canWrite && !isPast;
  const canPay = canPayPersonalLesson(role, memberId, displayLesson, can, isReadOnly);
  const todayISO = toISODateLocal(new Date());
  const canMarkAttendance = lesson.date <= todayISO;

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
      <td className="py-3 px-3 text-xs text-slate-800 whitespace-nowrap">
        {lesson.timeStart}–{lesson.timeEnd}
      </td>
      <td className="py-3 px-3 text-xs text-slate-600">{locationName ?? "—"}</td>
      <td className="py-3 px-3 text-xs text-slate-600">{disciplineName ?? "—"}</td>
      <td className="py-3 px-3 text-xs text-slate-600">{teacherName ?? "—"}</td>
      <td className="py-3 px-3 text-xs text-slate-800 font-medium">{clientLabel}</td>
      <td className="py-3 px-3 text-xs text-slate-500">{personalLessonTypeLabel(lesson.type)}</td>
      <td className="py-3 px-3">
        <div className="flex flex-wrap gap-1">
          <PaymentBadge lesson={lesson} />
          {(canShowPaidStatus(role) || !lesson.subscriptionId) && <AttendanceBadge lesson={lesson} />}
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
              title="Оплатить"
              className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 cursor-pointer transition-colors"
            >
              <Coins className="w-3.5 h-3.5" />
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={() => onEdit(lesson)}
              title="Редактировать"
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(lesson)}
              title="Удалить"
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
