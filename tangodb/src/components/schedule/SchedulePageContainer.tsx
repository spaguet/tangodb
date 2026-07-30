import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useScheduleForWeek, useSchedule } from "../../hooks/useSchedule";
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
import type { DisplayLesson, EventDisplayLesson, GroupDisplayLesson, PersonalDisplayLesson, RentalDisplayLesson } from "../../types";
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
import ScheduleUpcomingCancellationsBlock from "./ScheduleUpcomingCancellationsBlock";
import TeacherVacationDialog from "./TeacherVacationDialog";
import CreateCalendarEventDialog from "./CreateCalendarEventDialog";
import CreateRentalDialog from "./CreateRentalDialog";
import CreateRentalSeriesDialog from "./CreateRentalSeriesDialog";
import EventInfoPopup from "./EventInfoPopup";
import RentalInfoPopup from "./RentalInfoPopup";
import SellPackageModal from "../ui/SellPackageModal";

const NO_LOCATION_KEY = "__no_location__";

type AddFlow =
  | { mode: "type-select"; prefill: ScheduleCellPrefill }
  | { mode: "group"; prefill: ScheduleCellPrefill }
  | { mode: "personal"; prefill: ScheduleCellPrefill }
  | { mode: "rental"; prefill: ScheduleCellPrefill }
  | { mode: "rental-series"; prefill: ScheduleCellPrefill }
  | null;

export default function SchedulePageContainer() {
  const { t } = useI18n();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { role, can, isReadOnly } = usePermissions();
  const { settings, memberId } = useOrganization();
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getWeekRange(new Date()).weekStart);
  const [selectedLesson, setSelectedLesson] = useState<GroupDisplayLesson | PersonalDisplayLesson | null>(null);
  const [editLesson, setEditLesson] = useState<GroupDisplayLesson | PersonalDisplayLesson | null>(null);
  const [addFlow, setAddFlow] = useState<AddFlow>(null);
  const [sellPackageOpen, setSellPackageOpen] = useState(false);
  const [teacherVacationOpen, setTeacherVacationOpen] = useState(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [createRentalOpen, setCreateRentalOpen] = useState(false);
  const [preselectedRenterId, setPreselectedRenterId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventDisplayLesson | null>(null);
  const [selectedRental, setSelectedRental] = useState<RentalDisplayLesson | null>(null);

  const { weekEnd } = useMemo(() => getWeekRange(selectedWeekStart), [selectedWeekStart]);

  const scheduleQuery = useScheduleForWeek(selectedWeekStart, weekEnd);
  const allScheduleQuery = useSchedule({ enabled: teacherVacationOpen });
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

  const canManageTeacherVacation = can("schedule.write");
  const canManageCalendarEvents =
    can("schedule.write") && (role === "owner" || role === "director" || role === "admin");
  const canManageRentals = canManageCalendarEvents;
  const canAddGroup = canOfferGroupLessonAdd(role, can, scheduleGridAddOptions);
  const canAddPersonal = canAddPersonalFromGrid(role, can, scheduleGridAddOptions);
  const canAddRental = canManageRentals;
  const canClickEmpty = canAddGroup || canAddPersonal || canAddRental;

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

  useEffect(() => {
    if (searchParams.get("action") !== "createRental") return;
    if (!canAddRental) return;

    const renterId = searchParams.get("renterId");
    setPreselectedRenterId(renterId);
    setCreateRentalOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("action");
        next.delete("renterId");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams, canAddRental]);

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
    return lessons.filter(
      (l) => l.kind === "event" || l.kind === "rental" || l.teacherMemberId === teacherFilter
    );
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
      } else if (lesson.kind === "event") {
        parts.push(lesson.title);
        if (lesson.guestTeacher) parts.push(lesson.guestTeacher);
      } else if (lesson.kind === "rental") {
        if (lesson.bookingStatus === "cancelled") {
          parts.push(t("schedule.rental.statusCancelled"));
        } else if (lesson.renterName) {
          parts.push(lesson.renterName);
        } else {
          parts.push(t("schedule.rental.blockTitle"));
        }
        if (lesson.purpose) parts.push(lesson.purpose);
        if (lesson.paymentStatus && lesson.renterName) {
          const statusKey =
            lesson.paymentStatus === "paid"
              ? "schedule.rental.paymentPaid"
              : lesson.paymentStatus === "partial"
                ? "schedule.rental.paymentPartial"
                : lesson.paymentStatus === "overpaid"
                  ? "schedule.rental.paymentOverpaid"
                  : "schedule.rental.paymentUnpaid";
          parts.push(t(statusKey));
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

      if (lesson.kind !== "event" && lesson.kind !== "rental" && lesson.teacherMemberId) {
        const teacher = teamMap.get(lesson.teacherMemberId);
        if (teacher) parts.push(teacher);
      }

      return parts.length > 0 ? parts.join(" · ") : undefined;
    },
    [disciplineMap, teamMap, t]
  );

  const handleLessonClick = useCallback((lesson: DisplayLesson) => {
    if (lesson.kind === "event") {
      setSelectedEvent(lesson);
      setSelectedLesson(null);
      setSelectedRental(null);
      return;
    }
    if (lesson.kind === "rental") {
      setSelectedRental(lesson);
      setSelectedLesson(null);
      setSelectedEvent(null);
      return;
    }
    setSelectedLesson(lesson);
    setSelectedEvent(null);
    setSelectedRental(null);
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

      if (canAddGroup && canAddPersonal && canAddRental) {
        setAddFlow({ mode: "type-select", prefill });
      } else if (canAddGroup && canAddPersonal) {
        setAddFlow({ mode: "type-select", prefill });
      } else if (canAddGroup) {
        setAddFlow({ mode: "group", prefill });
      } else if (canAddPersonal) {
        setAddFlow({ mode: "personal", prefill });
      } else if (canAddRental) {
        setAddFlow({ mode: "rental", prefill });
      }
    },
    [role, can, scheduleGridAddOptions, canAddGroup, canAddPersonal, canAddRental, toast, t]
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
  const rentalDialogPrefill = addFlow?.mode === "rental" ? addFlow.prefill : null;
  const rentalSeriesDialogPrefill = addFlow?.mode === "rental-series" ? addFlow.prefill : null;

  const isLoading =
    locationsQuery.isLoading ||
    disciplinesQuery.isLoading ||
    teamQuery.isLoading ||
    (scheduleQuery.isLoading && scheduleQuery.data === undefined);

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
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-[2px] py-1">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs">
          <ScheduleToolbar
            weekStart={selectedWeekStart}
            onWeekChange={setSelectedWeekStart}
            teacherFilter={teacherFilter}
            onTeacherFilterChange={handleTeacherFilterChange}
            teacherFilterOptions={teacherFilterOptions}
            canManageTeacherVacation={canManageTeacherVacation}
            onTeacherVacationClick={() => setTeacherVacationOpen(true)}
            canManageCalendarEvents={canManageCalendarEvents}
            onCreateEventClick={() => setCreateEventOpen(true)}
            canManageRentals={canManageRentals}
            onCreateRentalClick={() => setCreateRentalOpen(true)}
          />
        </div>
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

      <ScheduleUpcomingCancellationsBlock
        disciplineMap={disciplineMap}
        teamMap={teamMap}
        locationMap={locationMap}
      />

      <ScheduleDebtorsBlock
        disciplineMap={disciplineMap}
        teamMap={teamMap}
        locationMap={locationMap}
        locationOrder={locationOrder}
        onPaymentSuccess={handleScheduleRefresh}
      />

      <EventInfoPopup
        lesson={selectedEvent}
        locations={locationsQuery.locations.map((l) => ({ id: l.id, name: l.name }))}
        disciplineMap={disciplineMap}
        teamMap={teamMap}
        toast={toast}
        onClose={() => setSelectedEvent(null)}
        onSuccess={handleScheduleRefresh}
      />

      <RentalInfoPopup
        lesson={selectedRental}
        locations={locationsQuery.locations.map((l) => ({ id: l.id, name: l.name }))}
        toast={toast}
        onClose={() => setSelectedRental(null)}
        onSuccess={handleScheduleRefresh}
      />

      <CreateCalendarEventDialog
        open={createEventOpen}
        locations={locationsQuery.locations.map((l) => ({ id: l.id, name: l.name }))}
        disciplineMap={disciplineMap}
        teamMap={teamMap}
        toast={toast}
        onClose={() => setCreateEventOpen(false)}
        onSuccess={handleScheduleRefresh}
      />

      <CreateRentalDialog
        open={createRentalOpen || !!rentalDialogPrefill}
        prefill={rentalDialogPrefill}
        preselectedRenterId={preselectedRenterId}
        locations={locationsQuery.locations.map((l) => ({ id: l.id, name: l.name }))}
        toast={toast}
        onClose={() => {
          setCreateRentalOpen(false);
          setPreselectedRenterId(null);
          if (addFlow?.mode === "rental") closeAddFlow();
        }}
        onSuccess={handleScheduleRefresh}
      />

      <CreateRentalSeriesDialog
        open={!!rentalSeriesDialogPrefill}
        prefill={rentalSeriesDialogPrefill}
        preselectedRenterId={preselectedRenterId}
        locations={locationsQuery.locations.map((l) => ({ id: l.id, name: l.name }))}
        toast={toast}
        onClose={() => {
          setPreselectedRenterId(null);
          if (addFlow?.mode === "rental-series") closeAddFlow();
        }}
        onSuccess={handleScheduleRefresh}
      />

      <LessonInfoPopup
        lesson={selectedLesson}
        locationName={selectedLessonMeta?.locationName}
        disciplineName={selectedLessonMeta?.disciplineName}
        teacherName={selectedLessonMeta?.teacherName}
        scheduleSlots={scheduleSlots}
        personalLessons={personalLessonRefs}
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
        canOfferRental={canAddRental}
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
        onSelectRental={() => {
          if (addFlow?.mode === "type-select") {
            setAddFlow({ mode: "rental", prefill: addFlow.prefill });
          }
        }}
        onSelectRentalSeries={() => {
          if (addFlow?.mode === "type-select") {
            setAddFlow({ mode: "rental-series", prefill: addFlow.prefill });
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

      <TeacherVacationDialog
        open={teacherVacationOpen}
        initialTeacherMemberId={teacherFilter}
        teacherOptions={teacherFilterOptions}
        scheduleSlots={allScheduleQuery.data ?? scheduleSlots}
        disciplineMap={disciplineMap}
        locationMap={locationMap}
        toast={toast}
        onClose={() => setTeacherVacationOpen(false)}
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
