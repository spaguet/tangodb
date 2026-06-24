import { useMemo } from "react";
import { Ticket } from "lucide-react";
import { useSchedule } from "../../hooks/useSchedule";
import { usePersonalLessons } from "../../hooks/usePersonalLessons";
import { memberListLabel, useTeamMembers } from "../../hooks/useTeamMembers";
import { pageTabPanelCls } from "../ui/PageTabs";
import PersonalLessonSaleForm from "./PersonalLessonSaleForm";

interface PersonalLessonSalePanelProps {
  activeTab: string;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export default function PersonalLessonSalePanel({ activeTab, toast }: PersonalLessonSalePanelProps) {
  const scheduleQuery = useSchedule();
  const personalLessonsQuery = usePersonalLessons();
  const teamQuery = useTeamMembers();

  const teacherOptions = useMemo(
    () =>
      (teamQuery.data ?? []).filter(
        (member) =>
          member.is_active &&
          (member.role === "teacher" ||
            member.role === "owner" ||
            member.role === "director" ||
            member.role === "admin")
      ),
    [teamQuery.data]
  );

  const scheduleSlots = useMemo(
    () =>
      (scheduleQuery.data ?? []).map((slot) => ({
        id: slot.id,
        dayOfWeek: slot.dayOfWeek,
        time: slot.time,
        timeEnd: slot.timeEnd,
        disciplineId: slot.disciplineId,
        groupName: slot.groupName,
        locationId: slot.locationId,
        validFrom: slot.validFrom,
        validTo: slot.validTo,
      })),
    [scheduleQuery.data]
  );

  const personalLessons = useMemo(
    () =>
      (personalLessonsQuery.data ?? []).map((lesson) => ({
        id: lesson.id,
        date: lesson.date,
        timeStart: lesson.timeStart,
        timeEnd: lesson.timeEnd,
        locationId: lesson.locationId,
      })),
    [personalLessonsQuery.data]
  );

  return (
    <div
      className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack panel-sell-under-tabs ${pageTabPanelCls(activeTab, "view")}`}
    >
      <div className="panel-form-header panel-form-header-wide-md mb-4">
        <div className="panel-form-header-icon">
          <Ticket className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="panel-form-header-text">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">Продажа</h2>
          <p className="text-slate-400 text-[11px] leading-snug">
            Запишите персональный урок или продайте пакет.
          </p>
        </div>
      </div>

      <PersonalLessonSaleForm
        mode="standalone"
        teacherOptions={teacherOptions}
        scheduleSlots={scheduleSlots}
        personalLessons={personalLessons}
        toast={toast}
        onSuccess={() => {
          toast("Персональный урок оформлен", "success");
        }}
      />
    </div>
  );
}
