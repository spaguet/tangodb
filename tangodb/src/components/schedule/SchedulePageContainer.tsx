import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useScheduleForWeek } from "../../hooks/useSchedule";
import { useClients } from "../../hooks/useClients";
import { useDisciplines } from "../../hooks/useDisciplines";
import { usePrices } from "../../hooks/usePrices";
import { useAccessibleLocations } from "../../hooks/useLocations";
import { useTeamMembers, memberDisplayName, memberListLabel } from "../../hooks/useTeamMembers";
import { usePermissions } from "../../hooks/usePermissions";
import { normalizeOrgModules } from "../../lib/orgModules";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import {
  canAddPersonalFromGrid,
  canClickEmptyCell,
  canOfferGroupLessonAdd,
} from "../../lib/scheduleLessonAccess";
import { getWeekRange, isPastDate } from "../../lib/scheduleWeek";
import type { DisplayLesson } from "../../types";
import LoadingState from "../ui/LoadingState";
import AddLocationsInSettingsHint from "../ui/AddLocationsInSettingsHint";
import QueryErrorState from "../ui/QueryErrorState";
import ScheduleToolbar from "./ScheduleToolbar";
import LocationScheduleSection from "./LocationScheduleSection";
import LessonInfoPopup from "./LessonInfoPopup";
import AddLessonTypePopup, { type ScheduleCellPrefill } from "./AddLessonTypePopup";
import AddGroupLessonForm from "./AddGroupLessonForm";
import AddPersonalLessonForm from "./AddPersonalLessonForm";
import EditLessonPopup from "./EditLessonPopup";
import ScheduleDebtorsBlock from "./ScheduleDebtorsBlock";
import SellPackageModal from "../ui/SellPackageModal";

const NO_LOCATION_KEY = "__no_location__";

type AddFlow =
  | { mode: "type-select"; prefill: ScheduleCellPrefill }
  | { mode: "group"; prefill: ScheduleCellPrefill }
  | { mode: "personal"; prefill: ScheduleCellPrefill }
  | null;

export default function SchedulePageContainer() {
  const { t } = useI18n();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { role, can, isReadOnly } = usePermissions();
  const { settings, memberId } = useOrganization();
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getWeekRange(new Date()).weekStart);
  const [selectedLesson, setSelectedLesson] = useState<DisplayLesson | null>(null);
  const [editLesson, setEditLesson] = useState<DisplayLesson | null>(null);
  const [addFlow, setAddFlow] = useState<AddFlow>(null);
  const [sellPackageOpen, setSellPackageOpen] = useState(false);

  const { weekEnd } = useMemo(() => getWeekRange(selectedWeekStart), [selectedWeekStart]);

  const scheduleQuery = useScheduleForWeek(selectedWeekStart, weekEnd);
  const locationsQuery = useAccessibleLocations();
  const disciplinesQuery = useDisciplines();
  const teamQuery = useTeamMembers();
  const { data: activeClients = [] } = useClients();
  const { data: prices = [] } = usePrices();

  const scheduleGridAddOptions = useMemo(
    () => ({
      isReadOnly,
      modules: normalizeOrgModules(settings?.modules),
      teachersCanSellSubscriptions: settings?.teachers_can_sell_subscriptions ?? false,
    }),
    [isReadOnly, settings?.modules, settings?.teachers_can_sell_subscriptions]
  );

  const canAddGroup = canOfferGroupLessonAdd(role, can, scheduleGridAddOptions);
  const canAddPersonal = canAddPersonalFromGrid(role, can, scheduleGridAddOptions);
  const canClickEmpty = canAddGroup || canAddPersonal;

  const teachersCanViewFullSchedule = settings?.teachers_can_view_full_schedule ?? true;
  const selfMemberId = memberId;

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

  const teacherFilterOptions = useMemo(() => {
    const scoped =
      role === "teacher" && !teachersCanViewFullSchedule && selfMemberId
        ? teacherOptions.filter((member) => member.id === selfMemberId)
        : teacherOptions;

    return scoped.map((member) => ({
      id: member.id,
      label: memberListLabel(member),
    }));
  }, [teacherOptions, role, teachersCanViewFullSchedule, selfMemberId]);

  const allowedTeacherFilterIds = useMemo(
    () => new Set(teacherFilterOptions.map((option) => option.id)),
    [teacherFilterOptions]
  );

  const teacherFilter = useMemo(() => {
    const fromUrl = searchParams.get("teacher") ?? "";
    if (!fromUrl) return "";
    return allowedTeacherFilterIds.has(fromUrl) ? fromUrl : "";
  }, [searchParams, allowedTeacherFilterIds]);

  useEffect(() => {
    const fromUrl = searchParams.get("teacher");
    if (fromUrl && fromUrl !== teacherFilter) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("teacher");
          return next;
        },
        { replace: true }
      );
    }
  }, [searchParams, teacherFilter, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("action") !== "sell") return;
    if (!can("personal_lessons.sell")) return;

    setSellPackageOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("action");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams, can]);

  const handleTeacherFilterChange = useCallback(
    (teacherId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (teacherId) {
            next.set("teacher", teacherId);
          } else {
            next.delete("teacher");
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

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

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locationsQuery.locations) {
      map.set(loc.id, loc.name);
    }
    return map;
  }, [locationsQuery.locations]);

  const locationOrder = useMemo(
    () => locationsQuery.locations.map((loc) => loc.id),
    [locationsQuery.locations]
  );

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

  const scheduleSlots = scheduleQuery.data?.slots ?? [];
  const personalLessonRefs = useMemo(
    () =>
      (scheduleQuery.data?.personalLessons ?? []).map((l) => ({
        id: l.lessonId,
        date: l.date,
        timeStart: l.timeStart,
        timeEnd: l.timeEnd,
        locationId: l.locationId,
      })),
    [scheduleQuery.data?.personalLessons]
  );

  const getLessonTitle = useCallback((lesson: DisplayLesson): string => {
    return `${lesson.timeStart}–${lesson.timeEnd}`;
  }, []);

  const getLessonSubtitle = useCallback(
    (lesson: DisplayLesson): string | undefined => {
      const parts: string[] = [];

      if (lesson.kind === "group") {
        const groupLabel = lesson.groupName?.trim();
        if (groupLabel) {
          parts.push(groupLabel);
        } else {
          const disciplineName = lesson.disciplineId
            ? disciplineMap.get(lesson.disciplineId)
            : undefined;
          parts.push(disciplineName ?? t("common.groupLesson"));
        }
      } else {
        const clientLabel = lesson.clientDisplay;
        parts.push(
          clientLabel && clientLabel !== t("schedule.lessonInfo.clientNotSpecified")
            ? clientLabel
            : t("common.personalLabel")
        );
        if (lesson.disciplineId) {
          const disciplineName = disciplineMap.get(lesson.disciplineId);
          if (disciplineName) parts.push(disciplineName);
        }
      }

      if (lesson.teacherMemberId) {
        const teacher = teamMap.get(lesson.teacherMemberId);
        if (teacher) parts.push(teacher);
      }

      return parts.length > 0 ? parts.join(" · ") : undefined;
    },
    [disciplineMap, teamMap, t]
  );

  const handleLessonClick = useCallback((lesson: DisplayLesson) => {
    setSelectedLesson(lesson);
  }, []);

  const closeAddFlow = useCallback(() => setAddFlow(null), []);

  const handleScheduleRefresh = useCallback(() => {
    void scheduleQuery.refetch();
  }, [scheduleQuery]);

  const handleEmptyCellClick = useCallback(
    (locationId: string, locationName: string, dateISO: string, dayOfWeek: number, timeStart: string) => {
      if (!canClickEmptyCell(role, can, scheduleGridAddOptions, { locationId })) return;

      if (isPastDate(dateISO)) {
        toast(t("schedule.error.pastAdd"), "error");
        return;
      }

      const prefill: ScheduleCellPrefill = {
        locationId,
        locationName,
        date: dateISO,
        dayOfWeek,
        timeStart,
      };

      if (canAddGroup && canAddPersonal) {
        setAddFlow({ mode: "type-select", prefill });
      } else if (canAddGroup) {
        setAddFlow({ mode: "group", prefill });
      } else if (canAddPersonal) {
        setAddFlow({ mode: "personal", prefill });
      }
    },
    [role, can, scheduleGridAddOptions, canAddGroup, canAddPersonal, toast, t]
  );

  const resolveLocationName = useCallback(
    (lesson: DisplayLesson | null) => {
      if (!lesson) return undefined;
      const locationKey = lesson.locationId ?? NO_LOCATION_KEY;
      if (locationKey === NO_LOCATION_KEY) return t("utils.noLocation");
      return locationsQuery.locations.find((l) => l.id === locationKey)?.name;
    },
    [locationsQuery.locations, t]
  );

  const selectedLessonMeta = useMemo(() => {
    if (!selectedLesson) return null;

    return {
      locationName: resolveLocationName(selectedLesson),
      disciplineName: selectedLesson.disciplineId
        ? disciplineMap.get(selectedLesson.disciplineId)
        : undefined,
      teacherName: selectedLesson.teacherMemberId
        ? teamMap.get(selectedLesson.teacherMemberId)
        : undefined,
    };
  }, [selectedLesson, resolveLocationName, disciplineMap, teamMap]);

  const editLessonMeta = useMemo(() => resolveLocationName(editLesson), [editLesson, resolveLocationName]);

  const typeSelectPrefill = addFlow?.mode === "type-select" ? addFlow.prefill : null;
  const groupPrefill = addFlow?.mode === "group" ? addFlow.prefill : null;
  const personalPrefill = addFlow?.mode === "personal" ? addFlow.prefill : null;

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
    return <LoadingState label={t("schedule.loading")} />;
  }

  if (isError) {
    return <QueryErrorState message={t("schedule.error.loadFailed")} error={error} />;
  }

  const noLocationLessons = lessonsByLocation.get(NO_LOCATION_KEY) ?? [];
  const hasAnyLessons = filteredLessons.length > 0;
  const hasLocations = locationsQuery.locations.length > 0;

  return (
    <div className="panel-page-stack">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-indigo-500 shrink-0" />
          <h2 className="text-base font-semibold text-slate-800 tracking-tight">{t("schedule.title")}</h2>
        </div>
        <ScheduleToolbar
          weekStart={selectedWeekStart}
          onWeekChange={setSelectedWeekStart}
          teacherFilter={teacherFilter}
          onTeacherFilterChange={handleTeacherFilterChange}
          teacherFilterOptions={teacherFilterOptions}
        />
      </div>

      {!hasLocations && noLocationLessons.length === 0 && !hasAnyLessons ? (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs text-center py-20 text-slate-400 space-y-3">
          <CalendarDays className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-sm">{t("schedule.empty")}</p>
          <AddLocationsInSettingsHint />
        </div>
      ) : (
        <div className="space-y-4">
          {locationsQuery.locations.map((location) => (
            <LocationScheduleSection
              key={location.id}
              locationId={location.id}
              locationName={location.name}
              weekStart={selectedWeekStart}
              lessons={lessonsByLocation.get(location.id) ?? []}
              getLessonTitle={getLessonTitle}
              getLessonSubtitle={getLessonSubtitle}
              onLessonClick={handleLessonClick}
              canClickEmpty={canClickEmpty}
              onEmptyCellClick={(dateISO, dayOfWeek, timeStart) =>
                handleEmptyCellClick(location.id, location.name, dateISO, dayOfWeek, timeStart)
              }
            />
          ))}

          {noLocationLessons.length > 0 && (
            <LocationScheduleSection
              locationName={t("utils.noLocation")}
              weekStart={selectedWeekStart}
              lessons={noLocationLessons}
              getLessonTitle={getLessonTitle}
              getLessonSubtitle={getLessonSubtitle}
              onLessonClick={handleLessonClick}
            />
          )}
        </div>
      )}

      <ScheduleDebtorsBlock
        disciplineMap={disciplineMap}
        teamMap={teamMap}
        locationMap={locationMap}
        locationOrder={locationOrder}
        onPaymentSuccess={handleScheduleRefresh}
      />

      <LessonInfoPopup
        lesson={selectedLesson}
        locationName={selectedLessonMeta?.locationName}
        disciplineName={selectedLessonMeta?.disciplineName}
        teacherName={selectedLessonMeta?.teacherName}
        onClose={() => setSelectedLesson(null)}
        onSuccess={handleScheduleRefresh}
        onPaymentSuccess={handleScheduleRefresh}
        onEdit={(lesson) => {
          setSelectedLesson(null);
          setEditLesson(lesson);
        }}
      />

      <EditLessonPopup
        lesson={editLesson}
        locationName={editLessonMeta}
        disciplines={disciplinesQuery.data ?? []}
        teacherOptions={teacherOptions}
        scheduleSlots={scheduleSlots}
        personalLessons={personalLessonRefs}
        toast={toast}
        onClose={() => setEditLesson(null)}
        onSuccess={handleScheduleRefresh}
      />

      <AddLessonTypePopup
        prefill={typeSelectPrefill}
        canOfferGroup={canAddGroup}
        canOfferPersonal={canAddPersonal}
        onClose={closeAddFlow}
        onSelectGroup={() => {
          if (addFlow?.mode === "type-select") {
            setAddFlow({ mode: "group", prefill: addFlow.prefill });
          }
        }}
        onSelectPersonal={() => {
          if (addFlow?.mode === "type-select") {
            setAddFlow({ mode: "personal", prefill: addFlow.prefill });
          }
        }}
      />

      <AddGroupLessonForm
        prefill={groupPrefill}
        disciplines={disciplinesQuery.data ?? []}
        teacherOptions={teacherOptions}
        scheduleSlots={scheduleSlots}
        personalLessons={personalLessonRefs}
        toast={toast}
        onClose={closeAddFlow}
        onSuccess={handleScheduleRefresh}
      />

      <AddPersonalLessonForm
        prefill={personalPrefill}
        teacherOptions={teacherOptions}
        scheduleSlots={scheduleSlots}
        personalLessons={personalLessonRefs}
        toast={toast}
        onClose={closeAddFlow}
        onSuccess={handleScheduleRefresh}
      />

      <SellPackageModal
        open={sellPackageOpen}
        onClose={() => setSellPackageOpen(false)}
        toast={toast}
        clients={activeClients}
        disciplines={disciplinesQuery.data ?? []}
        prices={prices}
      />
    </div>
  );
}
