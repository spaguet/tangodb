import { useMemo } from "react";
import { Ticket } from "lucide-react";
import { useTeamMembers } from "../../hooks/useTeamMembers";
import { useI18n } from "../../hooks/useI18n";
import { useAccessibleLocations } from "../../hooks/useLocations";
import { isActiveLessonConductingMember } from "../../lib/lessonTeacherRoles";
import PersonalLessonSaleForm from "./PersonalLessonSaleForm";
import AddLocationsInSettingsHint from "../ui/AddLocationsInSettingsHint";

interface PersonalLessonSalePanelProps {
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export default function PersonalLessonSalePanel({ toast }: PersonalLessonSalePanelProps) {
  const { t } = useI18n();
  const teamQuery = useTeamMembers();
  const { locations } = useAccessibleLocations();

  const teacherOptions = useMemo(
    () => (teamQuery.data ?? []).filter(isActiveLessonConductingMember),
    [teamQuery.data]
  );

  return (
    <div
      className="bg-white p-4 border border-slate-200 shadow-xs panel-card-stack panel-sell-under-tabs pb-6"
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
          <AddLocationsInSettingsHint />
        </div>
      ) : (
        <PersonalLessonSaleForm
          mode="standalone"
          teacherOptions={teacherOptions}
          scheduleSlots={[]}
          personalLessons={[]}
          toast={toast}
          onSuccess={() => {
            toast(t("personal.sell.success"), "success");
          }}
        />
      )}
    </div>
  );
}
