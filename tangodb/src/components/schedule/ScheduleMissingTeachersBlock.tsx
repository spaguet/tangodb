import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Loader2, UserRoundSearch } from "lucide-react";
import AppSelect from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import {
  useScheduleMissingTeachers,
  type MissingTeacherEntry,
} from "../../hooks/useScheduleMissingTeachers";
import { useUpdatePersonalLesson } from "../../hooks/usePersonalLessons";
import { useUpdateGroupScheduleMetadata } from "../../hooks/useSchedule";
import { resolveMutationError, isI18nKey } from "../../lib/resolveMutationError";
import { dowShort } from "../../lib/utils";

interface ScheduleMissingTeachersBlockProps {
  disciplineMap: Map<string, string>;
  locationMap: Map<string, string>;
  teacherOptions: { id: string; label: string }[];
  onAssigned?: () => void;
}

function entryKey(entry: MissingTeacherEntry): string {
  return entry.kind === "personal" ? `personal:${entry.id}` : `group:${entry.slotId}`;
}

export default function ScheduleMissingTeachersBlock({
  disciplineMap,
  locationMap,
  teacherOptions,
  onAssigned,
}: ScheduleMissingTeachersBlockProps) {
  const { t, plural, formatDate, locale } = useI18n();
  const toast = useToast();
  const { can } = usePermissions();
  const canAssign = can("schedule.write");

  const missingQuery = useScheduleMissingTeachers({
    enabled: can("schedule.read"),
  });
  const updatePersonalLesson = useUpdatePersonalLesson();
  const updateGroupMetadata = useUpdateGroupScheduleMetadata();

  const [selectedTeacherByKey, setSelectedTeacherByKey] = useState<Record<string, string>>({});
  const [assigningKey, setAssigningKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    return (missingQuery.data ?? []).map((entry) => {
      const disciplineName = entry.disciplineId
        ? disciplineMap.get(entry.disciplineId)
        : undefined;
      const locationName = entry.locationId ? locationMap.get(entry.locationId) : undefined;

      if (entry.kind === "personal") {
        return {
          entry,
          title:
            entry.clientDisplay && entry.clientDisplay !== t("schedule.lessonInfo.clientNotSpecified")
              ? entry.clientDisplay
              : t("common.personalLabel"),
          meta: [
            formatDate(entry.date),
            `${entry.timeStart}–${entry.timeEnd}`,
            disciplineName,
            locationName,
          ]
            .filter(Boolean)
            .join(" · "),
          canAssign: canAssign && Boolean(entry.disciplineId),
        };
      }

      const groupLabel =
        entry.groupName?.trim() ||
        disciplineName ||
        t("common.groupLesson");

      return {
        entry,
        title: groupLabel,
        meta: [
          `${dowShort(entry.dayOfWeek, locale)} ${entry.timeStart}–${entry.timeEnd}`,
          t("schedule.missingTeachers.since", { date: formatDate(entry.validFrom) }),
          locationName,
        ]
          .filter(Boolean)
          .join(" · "),
        canAssign: canAssign && Boolean(entry.disciplineId),
      };
    });
  }, [missingQuery.data, disciplineMap, locationMap, canAssign, t, formatDate, locale]);

  if (!can("schedule.read") || !missingQuery.personalLessonsEnabled) {
    return null;
  }

  if (missingQuery.isLoading) {
    return <LoadingState label={t("schedule.missingTeachers.loading")} />;
  }

  if (missingQuery.isError) {
    return (
      <QueryErrorState
        message={t("schedule.missingTeachers.loadFailed")}
        error={missingQuery.error}
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

  const handleAssign = async (row: (typeof rows)[number]) => {
    const key = entryKey(row.entry);
    const teacherId = selectedTeacherByKey[key];
    if (!teacherId) {
      toast(t("schedule.missingTeachers.selectTeacher"), "error");
      return;
    }

    setAssigningKey(key);
    try {
      if (row.entry.kind === "personal") {
        const res = await updatePersonalLesson.mutateAsync({
          id: row.entry.id,
          lessonDate: row.entry.date,
          teacherMemberId: teacherId,
        });
        if (!res.success) {
          const message = res.error && isI18nKey(res.error) ? t(res.error) : res.error;
          toast(message ?? t("schedule.error.updateFailed"), "error");
          return;
        }
      } else {
        const disciplineId = row.entry.disciplineId;
        if (!disciplineId) {
          toast(t("schedule.missingTeachers.disciplineRequired"), "error");
          return;
        }
        const res = await updateGroupMetadata.mutateAsync({
          slotIds: [row.entry.slotId],
          groupName: row.entry.groupName?.trim() || disciplineMap.get(disciplineId) || "",
          disciplineId,
          teacherMemberId: teacherId,
        });
        if (!res.success) {
          const message = res.error && isI18nKey(res.error) ? t(res.error) : res.error;
          toast(message ?? t("schedule.error.updateFailed"), "error");
          return;
        }
      }

      toast(t("schedule.missingTeachers.assigned"), "success");
      setSelectedTeacherByKey((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      onAssigned?.();
    } catch (err) {
      toast(
        resolveMutationError(
          err instanceof Error ? err.message : undefined,
          "schedule.error.updateFailed",
          t
        ),
        "error"
      );
    } finally {
      setAssigningKey(null);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-violet-200/80 shadow-xs overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-b border-violet-100 bg-violet-50/60">
        <div className="flex items-center gap-2 min-w-0">
          <UserRoundSearch className="w-4 h-4 text-violet-700 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">
              {t("schedule.missingTeachers.title")}
            </h3>
            <p className="text-[11px] text-slate-500">{t("schedule.missingTeachers.subtitle")}</p>
          </div>
        </div>
        <span className="text-sm font-semibold text-violet-700 tabular-nums shrink-0">{countLabel}</span>
      </div>

      <ul className="divide-y divide-slate-100">
        {rows.map((row) => {
          const key = entryKey(row.entry);
          const isAssigning = assigningKey === key;
          const kindLabel =
            row.entry.kind === "personal"
              ? t("schedule.missingTeachers.kindPersonal")
              : t("schedule.missingTeachers.kindGroup");

          return (
            <li
              key={key}
              className="px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-slate-800 truncate">{row.title}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                    {kindLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{row.meta}</p>
                {!row.entry.disciplineId ? (
                  <p className="text-[11px] text-amber-700 mt-1">
                    {t("schedule.missingTeachers.disciplineRequired")}
                  </p>
                ) : null}
              </div>

              {canAssign ? (
                <div className="flex flex-col sm:flex-row sm:items-end gap-2 shrink-0 w-full lg:w-auto">
                  <div className="min-w-[12rem] flex-1 sm:flex-none">
                    <AppSelect
                      label={t("schedule.form.teacher")}
                      value={selectedTeacherByKey[key] ?? ""}
                      onChange={(e) =>
                        setSelectedTeacherByKey((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      disabled={!row.canAssign || isAssigning}
                    >
                      <option value="">{t("common.noTeachers")}</option>
                      {teacherOptions.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.label}
                        </option>
                      ))}
                    </AppSelect>
                  </div>
                  <button
                    type="button"
                    className={`${btnAddCls} w-full sm:w-auto`}
                    disabled={!row.canAssign || isAssigning || !selectedTeacherByKey[key]}
                    onClick={() => void handleAssign(row)}
                  >
                    {isAssigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {t("schedule.missingTeachers.assign")}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
