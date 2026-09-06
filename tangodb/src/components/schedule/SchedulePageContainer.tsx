import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { formatCurrency } from "../../lib/utils";
import { rentalRemainingAmount } from "../../lib/rentalAmount";
import { canAddPersonalFromGrid, canClickEmptyCell, canOfferGroupLessonAdd, isLessonInTeacherScope } from "../../lib/scheduleLessonAccess";
import { canManageMiniAppRentals } from "../../lib/permissions";
import { isMiniAppRentalChannel } from "../../lib/rentalMiniAppDisplay";
import {
  buildSchedulePngFilename,
  exportSchedulePng,
} from "../../lib/exportSchedulePng";
import { canUseTelegramFileDownload } from "../../lib/telegram";
import { getWeekRange, isPastDate, toISODateLocal, formatWeekRangeLabel } from "../../lib/scheduleWeek";
import { parseScheduleFocusParams, weekStartFromFocusDate } from "../../lib/scheduleFocus";
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
import ScheduleMissingTeachersBlock from "./ScheduleMissingTeachersBlock";
import ScheduleUpcomingCancellationsBlock from "./ScheduleUpcomingCancellationsBlock";
import TeacherVacationDialog from "./TeacherVacationDialog";
import CreateCalendarEventDialog from "./CreateCalendarEventDialog";
import CreateRentalDialog from "./CreateRentalDialog";
import CreateRentalSeriesDialog from "./CreateRentalSeriesDialog";
import CreateMiniAppBookingDialog from "./CreateMiniAppBookingDialog";
import CreateRentalChannelDialog, { type RentalChannelChoice } from "./CreateRentalChannelDialog";
import EventInfoPopup from "./EventInfoPopup";
import RentalInfoPopup from "./RentalInfoPopup";
import MiniAppRentalInfoPopup from "./MiniAppRentalInfoPopup";
import SchedulePngExportDialog from "./SchedulePngExportDialog";
import SellPackageModal from "../ui/SellPackageModal";

const NO_LOCATION_KEY = "__no_location__";

type AddFlow =
  | { mode: "type-select"; prefill: ScheduleCellPrefill }
  | { mode: "group"; prefill: ScheduleCellPrefill }
  | { mode: "personal"; prefill: ScheduleCellPrefill }
  | { mode: "rental"; prefill: ScheduleCellPrefill }
  | { mode: "rental-series"; prefill: ScheduleCellPrefill }
  | { mode: "miniapp"; prefill: ScheduleCellPrefill }
  | null;

export default function SchedulePageContainer() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { role, can, isReadOnly, canEditPastSchedule, options, scope } = usePermissions();
  const { settings, memberId } = useOrganization();
  const urlFocus = parseScheduleFocusParams(searchParams);
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => weekStartFromFocusDate(urlFocus.date));
  const [selectedLesson, setSelectedLesson] = useState<GroupDisplayLesson | PersonalDisplayLesson | null>(null);
  const [editLesson, setEditLesson] = useState<GroupDisplayLesson | PersonalDisplayLesson | null>(null);
  const [addFlow, setAddFlow] = useState<AddFlow>(null);
  const [sellPackageOpen, setSellPackageOpen] = useState(false);
  const [teacherVacationOpen, setTeacherVacationOpen] = useState(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [createRentalOpen, setCreateRentalOpen] = useState(false);
  const [createRentalSeriesOpen, setCreateRentalSeriesOpen] = useState(false);
  const [createMiniAppOpen, setCreateMiniAppOpen] = useState(false);
  const [rentalChannelOpen, setRentalChannelOpen] = useState(false);
  const [rentalChannelPrefill, setRentalChannelPrefill] = useState<ScheduleCellPrefill | null>(null);
  const [preselectedRenterId, setPreselectedRenterId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventDisplayLesson | null>(null);
  const [selectedRental, setSelectedRental] = useState<RentalDisplayLesson | null>(null);
  const [focusLocationId, setFocusLocationId] = useState<string | null>(urlFocus.location);
  const [focusLessonId, setFocusLessonId] = useState<string | null>(urlFocus.lesson);
  const [focusRentalId, setFocusRentalId] = useState<string | null>(urlFocus.rental);
  const appliedFocusKeyRef = useRef<string | null>(null);
  const [exportingPng, setExportingPng] = useState(false);
  const [pngExportPickerOpen, setPngExportPickerOpen] = useState(false);

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
      teachersCanAddGroupLessons: settings?.teachers_can_add_group_lessons ?? false,
    }),
    [isReadOnly, settings?.modules, settings?.teachers_can_add_group_lessons]
  );

  const canManageTeacherVacation = can("schedule.write");
  const canManageRentals = can("rentals.write");
  const canManageCalendarEvents =
    can("schedule.write") && (role === "owner" || role === "director" || role === "admin");
  const canAddGroup = canOfferGroupLessonAdd(role, can, scheduleGridAddOptions);
  const canAddPersonal = canAddPersonalFromGrid(role, can, scheduleGridAddOptions);
  const canAddRental = canManageRentals;
  const canAddMiniApp = canManageMiniAppRentals(role, options);
  const canAddRentalChannel = canAddRental || canAddMiniApp;
  const canClickEmpty = canAddGroup || canAddPersonal || canAddRentalChannel;

  const openRentalChannel = useCallback((prefill: ScheduleCellPrefill | null) => {
    setRentalChannelPrefill(prefill);
    setRentalChannelOpen(true);
  }, []);

  const handleRentalChannelSelect = useCallback(
    (choice: RentalChannelChoice) => {
      setRentalChannelOpen(false);
      const prefill = rentalChannelPrefill;
      if (choice === "cashier-once") {
        if (prefill) setAddFlow({ mode: "rental", prefill });
        else setCreateRentalOpen(true);
      } else if (choice === "cashier-series") {
        if (prefill) setAddFlow({ mode: "rental-series", prefill });
        else setCreateRentalSeriesOpen(true);
      } else if (prefill) {
        setAddFlow({ mode: "miniapp", prefill });
      } else {
        setCreateMiniAppOpen(true);
      }
      setRentalChannelPrefill(null);
    },
    [rentalChannelPrefill]
  );

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
    if (!canAddRentalChannel) return;

    const renterId = searchParams.get("renterId");
    setPreselectedRenterId(renterId);
    setRentalChannelPrefill(null);
    setRentalChannelOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("action");
        next.delete("renterId");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams, canAddRentalChannel]);

  useEffect(() => {
    const focus = parseScheduleFocusParams(searchParams);
    if (!focus.date && !focus.lesson && !focus.rental) return;
    setSelectedWeekStart(weekStartFromFocusDate(focus.date));
    if (focus.location) setFocusLocationId(focus.location);
    if (focus.lesson) setFocusLessonId(focus.lesson);
    if (focus.rental) setFocusRentalId(focus.rental);
  }, [searchParams]);

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
      (l) =>
        l.scheduleRestricted ||
        l.kind === "event" ||
        l.kind === "rental" ||
        l.teacherMemberId === teacherFilter
    );
  }, [scheduleQuery.data?.lessons, teacherFilter]);

  const displayLessons = useMemo(() => {
    if (role !== "teacher") return filteredLessons;
    return filteredLessons.map((lesson) => {
      if (isLessonInTeacherScope(role, memberId, lesson, scope)) return lesson;
      return { ...lesson, scheduleRestricted: true };
    });
  }, [filteredLessons, role, memberId, scope]);

  const highlightedLesson = useMemo(() => {
    if (focusLessonId) {
      return displayLessons.find((item) => item.kind === "personal" && item.lessonId === focusLessonId) ?? null;
    }
    if (focusRentalId) {
      return displayLessons.find((item) => item.kind === "rental" && item.rentalId === focusRentalId) ?? null;
    }
    return null;
  }, [displayLessons, focusLessonId, focusRentalId]);

  const lessonsByLocation = useMemo(() => {
    const grouped = new Map<string, DisplayLesson[]>();
    for (const loc of locationsQuery.locations) {
      grouped.set(loc.id, []);
    }
    grouped.set(NO_LOCATION_KEY, []);

    for (const lesson of displayLessons) {
      const key = lesson.locationId ?? NO_LOCATION_KEY;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(lesson);
    }

    return grouped;
  }, [displayLessons, locationsQuery.locations]);

  const scheduleSlots = scheduleQuery.data?.slots ?? [];
  const personalLessonRefs = useMemo(
    () =>
      (scheduleQuery.data?.personalLessons ?? []).map((l) => ({
        id: l.lessonId,
        date: l.date,
        timeStart: l.timeStart,
        timeEnd: l.timeEnd,
        locationId: l.locationId,
        clientDisplay: l.clientDisplay,
      })),
    [scheduleQuery.data?.personalLessons]
  );

  const getLessonTitle = useCallback((lesson: DisplayLesson): string => {
    if (lesson.scheduleRestricted) return t("schedule.occupied");
    return `${lesson.timeStart}–${lesson.timeEnd}`;
  }, [t]);

  const getLessonSubtitle = useCallback(
    (lesson: DisplayLesson): string | undefined => {
      if (lesson.scheduleRestricted) return undefined;
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
        if (lesson.paymentStatus && lesson.renterName && !isMiniAppRentalChannel(lesson)) {
          const statusKey =
            lesson.paymentStatus === "paid"
              ? "schedule.rental.paymentPaid"
              : lesson.paymentStatus === "partial"
                ? "schedule.rental.paymentPartial"
                : lesson.paymentStatus === "overpaid"
                  ? "schedule.rental.paymentOverpaid"
                  : "schedule.rental.paymentUnpaid";
          parts.push(t(statusKey));
          if (
            can("rentals.payments.write") &&
            lesson.bookingStatus === "confirmed" &&
            (lesson.paymentStatus === "unpaid" || lesson.paymentStatus === "partial")
          ) {
            const remaining = rentalRemainingAmount(lesson.fixedAmount, lesson.paidAmount);
            if (remaining > 0) {
              parts.push(formatCurrency(remaining));
            }
          }
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
    [disciplineMap, teamMap, t, can]
  );

  const handleLessonClick = useCallback((lesson: DisplayLesson) => {
    if (lesson.scheduleRestricted) return;
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

  useEffect(() => {
    const focus = parseScheduleFocusParams(searchParams);
    if (!focus.lesson && !focus.rental) return;
    if (scheduleQuery.isLoading || scheduleQuery.data === undefined) return;

    if (focus.date) {
      const { weekStart, weekEnd } = getWeekRange(selectedWeekStart);
      const start = toISODateLocal(weekStart);
      const end = toISODateLocal(weekEnd);
      if (focus.date < start || focus.date > end) return;
    }

    const key = `${focus.date}|${focus.lesson}|${focus.rental}|${focus.location}`;
    if (appliedFocusKeyRef.current === key) return;

    const lessons = scheduleQuery.data.lessons ?? [];
    const found = focus.lesson
      ? lessons.find((item) => item.kind === "personal" && item.lessonId === focus.lesson)
      : lessons.find((item) => item.kind === "rental" && item.rentalId === focus.rental);

    appliedFocusKeyRef.current = key;

    if (found) {
      setFocusLocationId(found.locationId ?? NO_LOCATION_KEY);
      setFocusLessonId(found.kind === "personal" ? found.lessonId : null);
      setFocusRentalId(found.kind === "rental" ? found.rentalId : null);
    } else {
      toast(t("schedule.error.focusNotFound"), "error");
      setFocusLessonId(null);
      setFocusRentalId(null);
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("date");
        next.delete("lesson");
        next.delete("rental");
        next.delete("location");
        return next;
      },
      { replace: true }
    );
  }, [
    searchParams,
    scheduleQuery.isLoading,
    scheduleQuery.data,
    selectedWeekStart,
    setSearchParams,
    toast,
    t,
  ]);

  const closeAddFlow = useCallback(() => setAddFlow(null), []);

  const handleScheduleRefresh = useCallback(() => {
    void scheduleQuery.refetch();
  }, [scheduleQuery]);

  const handleExportPng = useCallback(
    async (locationKey: string) => {
      if (exportingPng) return;

      const locationLabel =
        locationKey === NO_LOCATION_KEY
          ? t("utils.noLocation")
          : locationsQuery.locations.find((loc) => loc.id === locationKey)?.name ?? locationKey;

      const { weekStart, weekEnd } = getWeekRange(selectedWeekStart);
      const weekStartISO = toISODateLocal(weekStart);
      const weekEndISO = toISODateLocal(weekEnd);
      const filename = buildSchedulePngFilename(weekStartISO, weekEndISO, locationLabel);
      const lessons = lessonsByLocation.get(locationKey) ?? [];

      setPngExportPickerOpen(false);
      setExportingPng(true);

      try {
        const result = await exportSchedulePng({
          filename,
          title: t("schedule.title"),
          locationLabel,
          weekLabel: formatWeekRangeLabel(weekStart, weekEnd, locale),
          weekStart: selectedWeekStart,
          lessons,
          getLessonTitle,
          getLessonSubtitle,
          locale,
          emptyLabel: t("common.noLessonsWeek"),
        });
        if (result === "failed") {
          toast(
            t(canUseTelegramFileDownload() ? "schedule.export.pngTelegramFailed" : "schedule.export.pngFailed"),
            "error"
          );
        } else if (result === "cancelled") {
          return;
        } else if (result === "telegram") {
          toast(t("export.status.telegramDownload"), "success");
        } else {
          toast(t("schedule.export.pngSuccess"), "success");
        }
      } catch {
        toast(
          t(canUseTelegramFileDownload() ? "schedule.export.pngTelegramFailed" : "schedule.export.pngFailed"),
          "error"
        );
      } finally {
        setExportingPng(false);
      }
    },
    [
      exportingPng,
      selectedWeekStart,
      locationsQuery.locations,
      lessonsByLocation,
      getLessonTitle,
      getLessonSubtitle,
      locale,
      toast,
      t,
    ]
  );

  const pngExportLocationOptions = useMemo(() => {
    const options: { id: string; label: string }[] = locationsQuery.locations.map((loc) => ({
      id: loc.id,
      label: loc.name,
    }));
    const noLocationLessons = lessonsByLocation.get(NO_LOCATION_KEY) ?? [];
    if (noLocationLessons.length > 0) {
      options.push({ id: NO_LOCATION_KEY, label: t("utils.noLocation") });
    }
    return options;
  }, [locationsQuery.locations, lessonsByLocation, t]);

  const handleEmptyCellClick = useCallback(
    (locationId: string, locationName: string, dateISO: string, dayOfWeek: number, timeStart: string) => {
      if (!canClickEmptyCell(role, can, scheduleGridAddOptions, { locationId })) return;

      if (isPastDate(dateISO) && !canEditPastSchedule) {
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

      const offers = [canAddGroup, canAddPersonal, canAddRentalChannel].filter(Boolean).length;
      if (offers > 1) {
        setAddFlow({ mode: "type-select", prefill });
      } else if (canAddGroup) {
        setAddFlow({ mode: "group", prefill });
      } else if (canAddPersonal) {
        setAddFlow({ mode: "personal", prefill });
      } else if (canAddRentalChannel) {
        openRentalChannel(prefill);
      }
    },
    [role, can, scheduleGridAddOptions, canAddGroup, canAddPersonal, canAddRentalChannel, canEditPastSchedule, openRentalChannel, toast, t]
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
  const miniAppDialogPrefill = addFlow?.mode === "miniapp" ? addFlow.prefill : null;

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
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="panel-card-stack">
          <h2 className="text-base font-semibold tracking-tight text-slate-800">{t("schedule.title")}</h2>
        </div>
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
          onCreateRentalClick={() => openRentalChannel(null)}
          onExportPngClick={() => setPngExportPickerOpen(true)}
          exportingPng={exportingPng}
          exportPngDisabled={pngExportLocationOptions.length === 0}
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
              forceExpanded={focusLocationId === location.id}
              highlightedLesson={highlightedLesson}
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
              forceExpanded={focusLocationId === NO_LOCATION_KEY}
              highlightedLesson={highlightedLesson}
            />
          )}
        </div>
      )}

      {exportingPng ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white/75 backdrop-blur-[1px]"
          aria-live="polite"
        >
          <p className="text-sm font-medium text-slate-700">{t("schedule.export.pngInProgress")}</p>
        </div>
      ) : null}

      <ScheduleUpcomingCancellationsBlock
        disciplineMap={disciplineMap}
        teamMap={teamMap}
        locationMap={locationMap}
      />

      <ScheduleMissingTeachersBlock
        disciplineMap={disciplineMap}
        locationMap={locationMap}
        teacherOptions={teacherFilterOptions}
        onAssigned={handleScheduleRefresh}
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
        lesson={selectedRental && !isMiniAppRentalChannel(selectedRental) ? selectedRental : null}
        locations={locationsQuery.locations.map((l) => ({ id: l.id, name: l.name }))}
        toast={toast}
        onClose={() => setSelectedRental(null)}
        onSuccess={handleScheduleRefresh}
      />

      <MiniAppRentalInfoPopup
        lesson={selectedRental && isMiniAppRentalChannel(selectedRental) ? selectedRental : null}
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
        open={createRentalSeriesOpen || !!rentalSeriesDialogPrefill}
        prefill={rentalSeriesDialogPrefill}
        preselectedRenterId={preselectedRenterId}
        locations={locationsQuery.locations.map((l) => ({ id: l.id, name: l.name }))}
        toast={toast}
        onClose={() => {
          setCreateRentalSeriesOpen(false);
          setPreselectedRenterId(null);
          if (addFlow?.mode === "rental-series") closeAddFlow();
        }}
        onSuccess={handleScheduleRefresh}
      />

      <CreateMiniAppBookingDialog
        open={createMiniAppOpen || !!miniAppDialogPrefill}
        prefill={miniAppDialogPrefill}
        preselectedRenterId={preselectedRenterId}
        locations={locationsQuery.locations.map((l) => ({ id: l.id, name: l.name }))}
        toast={toast}
        onClose={() => {
          setCreateMiniAppOpen(false);
          setPreselectedRenterId(null);
          if (addFlow?.mode === "miniapp") closeAddFlow();
        }}
        onSuccess={handleScheduleRefresh}
      />

      <CreateRentalChannelDialog
        open={rentalChannelOpen}
        contextLabel={
          rentalChannelPrefill
            ? `${rentalChannelPrefill.locationName} · ${rentalChannelPrefill.date} · ${rentalChannelPrefill.timeStart}`
            : undefined
        }
        canCashier={canAddRental}
        canMiniApp={canAddMiniApp}
        onClose={() => {
          setRentalChannelOpen(false);
          setRentalChannelPrefill(null);
        }}
        onSelect={handleRentalChannelSelect}
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
        canOfferRental={canAddRentalChannel}
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
            openRentalChannel(addFlow.prefill);
            closeAddFlow();
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

      <SchedulePngExportDialog
        open={pngExportPickerOpen}
        options={pngExportLocationOptions}
        initialLocationId={focusLocationId}
        onClose={() => setPngExportPickerOpen(false)}
        onExport={(locationId) => void handleExportPng(locationId)}
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
