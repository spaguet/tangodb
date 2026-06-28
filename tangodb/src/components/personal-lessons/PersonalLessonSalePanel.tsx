import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Ticket } from "lucide-react";
import { useSchedule } from "../../hooks/useSchedule";
import { usePersonalLessons } from "../../hooks/usePersonalLessons";
import { useTeamMembers } from "../../hooks/useTeamMembers";
import { useI18n } from "../../hooks/useI18n";
import { useAccessibleLocations } from "../../hooks/useLocations";
import PersonalLessonSaleForm from "./PersonalLessonSaleForm";

interface PersonalLessonSalePanelProps {
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export default function PersonalLessonSalePanel({ toast }: PersonalLessonSalePanelProps) {
  const { t } = useI18n();
  const scheduleQuery = useSchedule();
  const personalLessonsQuery = usePersonalLessons();
  const teamQuery = useTeamMembers();
  const { locations } = useAccessibleLocations();

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
      className="bg-white p-4 border border-slate-200 shadow-xs panel-card-stack panel-sell-under-tabs"
    >
      <div className="panel-form-header panel-form-header-wide-md mb-4">
        <div className="panel-form-header-icon">
          <Ticket className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="panel-form-header-text">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">{t("personal.sell.title")}</h2>
          <p className="text-slate-400 text-[11px] leading-snug">{t("personal.sell.subtitle")}</p>
        </div>
      </div>

      {locations.length === 0 ? (
        <div className="text-center py-20 text-slate-400 space-y-3">
          <Ticket className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-sm">
            {t("attendance.noLocationsHint")}{" "}
            <Link
              to="/settings/locations"
              className="text-indigo-600 hover:text-indigo-800 font-semibold underline-offset-2 hover:underline"
            >
              {t("attendance.settingsLocations")}
            </Link>
            .
          </p>
        </div>
      ) : (
        <PersonalLessonSaleForm
          mode="standalone"
          teacherOptions={teacherOptions}
          scheduleSlots={scheduleSlots}
          personalLessons={personalLessons}
          toast={toast}
          onSuccess={() => {
            toast(t("personal.sell.success"), "success");
          }}
        />
      )}
    </div>
  );
}
