import { useMemo } from "react";
import { motion } from "motion/react";
import { CalendarOff, Clock } from "lucide-react";
import { useScheduleCancellations } from "../../hooks/useScheduleCancellations";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useI18n } from "../../hooks/useI18n";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";

interface ScheduleUpcomingCancellationsBlockProps {
  disciplineMap: Map<string, string>;
  teamMap: Map<string, string>;
  locationMap: Map<string, string>;
}

export default function ScheduleUpcomingCancellationsBlock({
  disciplineMap,
  teamMap,
  locationMap,
}: ScheduleUpcomingCancellationsBlockProps) {
  const { t, plural, formatDate } = useI18n();
  const { role, memberId } = useOrganization();
  const { can } = usePermissions();

  const cancellationsQuery = useScheduleCancellations({
    enabled: can("schedule.read"),
    role,
    memberId,
  });

  const rows = useMemo(() => {
    return (cancellationsQuery.data ?? []).map((entry) => {
      const groupLabel =
        entry.groupName?.trim() ||
        (entry.disciplineId ? disciplineMap.get(entry.disciplineId) : undefined) ||
        t("common.groupLesson");

      return {
        entry,
        groupLabel,
        teacherName: entry.teacherMemberId ? teamMap.get(entry.teacherMemberId) : undefined,
        locationName: entry.locationId ? locationMap.get(entry.locationId) : undefined,
      };
    });
  }, [cancellationsQuery.data, disciplineMap, teamMap, locationMap, t]);

  if (!can("schedule.read")) {
    return null;
  }

  if (cancellationsQuery.isLoading) {
    return <LoadingState label={t("schedule.cancellations.loading")} />;
  }

  if (cancellationsQuery.isError) {
    return (
      <QueryErrorState
        message={t("schedule.cancellations.loadFailed")}
        error={cancellationsQuery.error}
      />
    );
  }

  if (rows.length === 0) {
    return null;
  }

  const countLabel = `${rows.length} ${plural(rows.length, [
    t("common.lesson.one"),
    t("common.lesson.few"),
    t("common.lesson.many"),
  ])}`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-amber-200/80 shadow-xs overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-b border-amber-100 bg-amber-50/60">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarOff className="w-4 h-4 text-amber-700 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">{t("schedule.cancellations.title")}</h3>
            <p className="text-[11px] text-slate-500">{t("schedule.cancellations.subtitle")}</p>
          </div>
        </div>
        <span className="text-sm font-semibold text-amber-700 tabular-nums shrink-0">{countLabel}</span>
      </div>

      <ul className="divide-y divide-slate-100">
        {rows.map(({ entry, groupLabel, teacherName, locationName }) => (
          <li
            key={entry.id}
            className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{groupLabel}</p>
              <p className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                <span>{formatDate(entry.date)}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3 shrink-0" />
                  {entry.timeStart}–{entry.timeEnd}
                </span>
              </p>
              {[locationName, teacherName].filter(Boolean).length > 0 ? (
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {[locationName, teacherName].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
