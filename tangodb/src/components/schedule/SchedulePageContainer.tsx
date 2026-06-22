import { useCallback, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useScheduleForWeek } from "../../hooks/useSchedule";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useAccessibleLocations } from "../../hooks/useLocations";
import { useTeamMembers, memberDisplayName } from "../../hooks/useTeamMembers";
import { getWeekRange } from "../../lib/scheduleWeek";
import type { DisplayLesson } from "../../types";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import ScheduleToolbar from "./ScheduleToolbar";
import LocationScheduleSection from "./LocationScheduleSection";
import LessonInfoPopup from "./LessonInfoPopup";

const NO_LOCATION_KEY = "__no_location__";

export default function SchedulePageContainer() {
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getWeekRange(new Date()).weekStart);
  const [teacherFilter] = useState<string>("");
  const [selectedLesson, setSelectedLesson] = useState<DisplayLesson | null>(null);

  const { weekEnd } = useMemo(() => getWeekRange(selectedWeekStart), [selectedWeekStart]);

  const scheduleQuery = useScheduleForWeek(selectedWeekStart, weekEnd);
  const locationsQuery = useAccessibleLocations();
  const disciplinesQuery = useDisciplines();
  const teamQuery = useTeamMembers();

  const disciplineMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of disciplinesQuery.data ?? []) {
      map.set(d.id, d.name);
    }
    return map;
  }, [disciplinesQuery.data]);

  const teamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of teamQuery.data ?? []) {
      const name = memberDisplayName(m);
      if (name) map.set(m.id, name);
    }
    return map;
  }, [teamQuery.data]);

  const filteredLessons = useMemo(() => {
    const lessons = scheduleQuery.data?.lessons ?? [];
    if (!teacherFilter) return lessons;
    return lessons.filter((l) => l.teacherMemberId === teacherFilter);
  }, [scheduleQuery.data?.lessons, teacherFilter]);

  const lessonsByLocation = useMemo(() => {
    const grouped = new Map<string, DisplayLesson[]>();
    for (const loc of locationsQuery.locations) {
      grouped.set(loc.id, []);
    }
    grouped.set(NO_LOCATION_KEY, []);

    for (const lesson of filteredLessons) {
      const key = lesson.locationId ?? NO_LOCATION_KEY;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(lesson);
    }

    return grouped;
  }, [filteredLessons, locationsQuery.locations]);

  const getLessonTitle = useCallback(
    (lesson: DisplayLesson): string => {
      if (lesson.kind === "group") {
        const groupLabel = lesson.groupName?.trim();
        if (groupLabel) return groupLabel;
        const disciplineName = lesson.disciplineId
          ? disciplineMap.get(lesson.disciplineId)
          : undefined;
        return disciplineName ?? "Групповой урок";
      }
      const clientLabel = lesson.clientDisplay;
      return clientLabel && clientLabel !== "Клиент не указан" ? clientLabel : "Персональный";
    },
    [disciplineMap]
  );

  const getLessonSubtitle = useCallback(
    (lesson: DisplayLesson): string | undefined => {
      const parts: string[] = [];
      if (lesson.disciplineId) {
        const name = disciplineMap.get(lesson.disciplineId);
        if (name) parts.push(name);
      }
      if (lesson.teacherMemberId) {
        const teacher = teamMap.get(lesson.teacherMemberId);
        if (teacher) parts.push(teacher);
      }
      return parts.length > 0 ? parts.join(" · ") : undefined;
    },
    [disciplineMap, teamMap]
  );

  const handleLessonClick = useCallback((lesson: DisplayLesson) => {
    setSelectedLesson(lesson);
  }, []);

  const selectedLessonMeta = useMemo(() => {
    if (!selectedLesson) return null;

    const locationKey = selectedLesson.locationId ?? NO_LOCATION_KEY;
    const locationName =
      locationKey === NO_LOCATION_KEY
        ? "Без локации"
        : locationsQuery.locations.find((l) => l.id === locationKey)?.name;

    return {
      locationName,
      disciplineName: selectedLesson.disciplineId
        ? disciplineMap.get(selectedLesson.disciplineId)
        : undefined,
      teacherName: selectedLesson.teacherMemberId
        ? teamMap.get(selectedLesson.teacherMemberId)
        : undefined,
    };
  }, [selectedLesson, locationsQuery.locations, disciplineMap, teamMap]);

  const isLoading =
    scheduleQuery.isLoading ||
    locationsQuery.isLoading ||
    disciplinesQuery.isLoading ||
    teamQuery.isLoading;

  const isError =
    scheduleQuery.isError ||
    locationsQuery.isError ||
    disciplinesQuery.isError ||
    teamQuery.isError;

  const error =
    scheduleQuery.error ?? locationsQuery.error ?? disciplinesQuery.error ?? teamQuery.error;

  if (isLoading) {
    return <LoadingState label="Загрузка расписания..." />;
  }

  if (isError) {
    return <QueryErrorState message="Не удалось загрузить расписание" error={error} />;
  }

  const noLocationLessons = lessonsByLocation.get(NO_LOCATION_KEY) ?? [];
  const hasAnyLessons = filteredLessons.length > 0;
  const hasLocations = locationsQuery.locations.length > 0;

  return (
    <div className="panel-page-stack">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-indigo-500 shrink-0" />
          <h2 className="text-base font-semibold text-slate-800 tracking-tight">Расписание</h2>
        </div>
        <ScheduleToolbar weekStart={selectedWeekStart} onWeekChange={setSelectedWeekStart} />
      </div>

      {!hasLocations && noLocationLessons.length === 0 && !hasAnyLessons ? (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs text-center py-20 text-slate-400 space-y-3">
          <CalendarDays className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-sm">Расписание пусто</p>
        </div>
      ) : (
        <div className="space-y-4">
          {locationsQuery.locations.map((location) => (
            <LocationScheduleSection
              key={location.id}
              locationName={location.name}
              weekStart={selectedWeekStart}
              lessons={lessonsByLocation.get(location.id) ?? []}
              getLessonTitle={getLessonTitle}
              getLessonSubtitle={getLessonSubtitle}
              onLessonClick={handleLessonClick}
            />
          ))}

          {noLocationLessons.length > 0 && (
            <LocationScheduleSection
              locationName="Без локации"
              weekStart={selectedWeekStart}
              lessons={noLocationLessons}
              getLessonTitle={getLessonTitle}
              getLessonSubtitle={getLessonSubtitle}
              onLessonClick={handleLessonClick}
            />
          )}
        </div>
      )}

      <LessonInfoPopup
        lesson={selectedLesson}
        locationName={selectedLessonMeta?.locationName}
        disciplineName={selectedLessonMeta?.disciplineName}
        teacherName={selectedLessonMeta?.teacherName}
        onClose={() => setSelectedLesson(null)}
      />
    </div>
  );
}
