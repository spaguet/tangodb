import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  X,
  Snowflake,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Ticket,
  MapPin,
  ArrowLeft,
  ShieldCheck,
  Coins,
} from "lucide-react";
import {
  attendanceQueryKey,
  useMarkAttendance,
  useScheduleDates,
  countPresentAttendeesFromSubs,
  useSubsForDate,
} from "../hooks/useAttendance";
import { useUndoAttendanceCorrection } from "../hooks/usePaymentCorrections";
import AttendanceCorrectionDialog, {
  isWithinAttendanceUndoWindow,
  type AttendanceCorrectionTarget,
} from "./attendance/AttendanceCorrectionDialog";
import { ATTENDANCE_UNDO_WINDOW_MS } from "../lib/paymentCorrection";
import { usePaymentFormIdempotency } from "../hooks/usePaymentFormIdempotency";
import { useSubscriptionGroups } from "../hooks/useSubscriptionGroups";
import { usePersonalLessons, useMarkPersonalLessonAttendance, personalLessonsQueryKey } from "../hooks/usePersonalLessons";
import { useClientDirectory } from "../hooks/useClients";
import { singleVisitsQueryKey, useRecordSingleVisit, useSingleVisits } from "../hooks/useSingleVisits";
import VenueRulePaymentConfirmDialog from "./venue-costs/VenueRulePaymentConfirmDialog";
import {
  useActiveGroupLessonClosure,
  useCloseGroupLessonOccurrence,
  useReopenLessonOccurrenceClosure,
  type VenueCostRuleStatus,
} from "../hooks/useVenueCosts";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { usePermissions } from "../hooks/usePermissions";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  canViewGroupAttendanceLesson,
  canViewPersonalAttendanceLesson,
} from "../lib/teacherAttendanceAccess";
import { usePersonalLessonsModuleEnabled } from "../hooks/useOrgModules";
import { PAYMENT_METHOD_KEYS } from "../hooks/usePayments";
import { useSettings } from "../settings/SettingsProvider";
import {
  canApplyFreeze,
  freezeAlreadyUsedMessage,
  freezeUnavailableMessage,
} from "../lib/freezePolicy";
import { usePrices } from "../hooks/usePrices";
import { useAccessibleLocations } from "../hooks/useLocations";
import {
  formatCurrency,
  formatMonthTitle,
  getDowLabels,
  filterSingleVisitTariffsForSale,
  getPriceLabel,
  getSubscriptionDaysLeft,
  getSubscriptionTariffLabel,
  isMonthlyUnlimitedSubscription,
  jsDayToIsoDow,
  shiftMonth,
} from "../lib/utils";
import { formatReopenLessonError } from "../lib/venueCostDraftErrors";
import { useI18n } from "../hooks/useI18n";
import { useUIStore } from "../store/ui";
import QueryErrorState from "./ui/QueryErrorState";
import LoadingState from "./ui/LoadingState";
import OfflineLimitedState from "./offline/OfflineLimitedState";
import OfflineScopeNotice from "./offline/OfflineScopeNotice";
import AddLocationsInSettingsHint from "./ui/AddLocationsInSettingsHint";
import VirtualList from "./ui/VirtualList";
import AppSelect, { fieldCls } from "./ui/AppSelect";
import { btnAddCls, btnOpenCls } from "./ui/buttonStyles";
import ClientAutocomplete from "./ui/ClientAutocomplete";
import PayPersonalLessonModal, { type PayPersonalLessonTarget } from "./schedule/PayPersonalLessonModal";
import type { ToastType } from "../App";
import type { PersonalLesson, SubForDate } from "../types";
import { scheduleDatesFromSnapshot } from "../lib/offline/buildSnapshot";
import { mergeSubsWithOfflineOps } from "../lib/offline/mergeSubs";
import {
  useCaptureShiftSnapshot,
  useEnqueueOfflineAttendance,
  useOfflineShiftMeta,
  useSaveOfflinePaymentDraft,
} from "../hooks/useOfflineShift";

function parseSingleVisitAmountInput(amount: string): number | null {
  const trimmed = amount.trim();
  if (trimmed === "") return null;
  const num = parseFloat(trimmed);
  if (Number.isNaN(num) || num < 0) return null;
  return num;
}

function canSubmitSingleVisitForm(clientId: string, priceId: string, amount: string): boolean {
  if (!clientId) return false;
  if (priceId) return true;
  const parsed = parseSingleVisitAmountInput(amount);
  return parsed !== null && parsed > 0;
}

interface AttendancePanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

const ATTENDANCE_MARK_KEYS = [
  { labelKey: "common.present" as const, hintKey: "attendance.legend.presentHint" as const, status: "present" as const },
  { labelKey: "common.absent" as const, hintKey: "attendance.legend.absentHint" as const, status: "absent" as const },
  { labelKey: "common.freeze" as const, hintKey: "attendance.legend.freezeHint" as const, status: "freeze" as const },
  { labelKey: "common.excusedShort" as const, hintKey: "attendance.legend.excusedHint" as const, status: "excused" as const },
];

const SINGLE_VISIT_PAYMENT_METHODS = ["cash", "transfer", "card", "other"] as const;

function attendanceStatusLabel(
  status: "present" | "absent" | "freeze" | "excused",
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (status === "present") return t("attendance.status.present");
  if (status === "absent") return t("attendance.status.absent");
  if (status === "freeze") return t("attendance.status.freeze");
  return t("attendance.status.excused");
}

function AttendanceMarkLegend({
  showFreeze,
  t,
}: {
  showFreeze: boolean;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const items = showFreeze
    ? ATTENDANCE_MARK_KEYS
    : ATTENDANCE_MARK_KEYS.filter((item) => item.status !== "freeze");

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 space-y-1.5 mb-4">
      <p className="text-[10px] font-sans font-semibold uppercase tracking-wider text-slate-500">
        {t("attendance.legend.title")}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <p key={item.status} className="text-[11px] text-slate-500 font-sans leading-snug">
            <span className="font-semibold text-slate-700">{t(item.labelKey)}</span>
            {" — "}
            {t(item.hintKey)}
          </p>
        ))}
      </div>
    </div>
  );
}

type DayLessonEntry =
  | {
      kind: "group";
      key: string;
      slotId?: string;
      start: string;
      time: string;
      timeEnd: string;
      label: string;
      disciplineId?: string | null;
      locationId?: string | null;
      scheduleGroupId?: string | null;
      teacherMemberId?: string | null;
    }
  | { kind: "personal"; key: string; start: string; lesson: PersonalLesson; label: string };

function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isDateMarkable(dateStr: string): boolean {
  return dateStr <= todayDateStr();
}

export default function AttendancePanel({ toast }: AttendancePanelProps) {
  const { t, locale, plural, formatDate } = useI18n();

  const formatAttendanceDate = (dateStr: string): string => {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (!y || !m || !d) return dateStr;
    const date = new Date(y, m - 1, d);
    const dowLabels = getDowLabels(locale);
    const monthDay = formatDate(date, { day: "numeric", month: "long" });
    const dow = dowLabels[jsDayToIsoDow(date.getDay())] ?? "";
    return `${monthDay} (${dow})`;
  };

  const weekdayLabels = useMemo(() => {
    const labels = getDowLabels(locale);
    return [1, 2, 3, 4, 5, 6, 7].map((dow) => labels[dow]);
  }, [locale]);

  const queryClient = useQueryClient();
  const { connectionState } = useOnlineStatus();
  const { isOfflineMode, snapshot, queue, snapshotMeta } = useOfflineShiftMeta(connectionState);
  const captureShiftSnapshot = useCaptureShiftSnapshot();
  const enqueueOfflineMark = useEnqueueOfflineAttendance();
  const saveOfflinePaymentDraft = useSaveOfflinePaymentDraft();
  const offlineBlocked =
    isOfflineMode && (!snapshotMeta.hasSnapshot || snapshotMeta.isExpired);
  const canMarkOffline =
    isOfflineMode && snapshotMeta.hasSnapshot && !snapshotMeta.isExpired;
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const selectedMonth = useUIStore((s) => s.selectedMonth);
  const setSelectedMonth = useUIStore((s) => s.setSelectedMonth);
  const {
    locations,
    isLoading: locationsLoading,
    isError: locationsError,
    error: locationsErr,
  } = useAccessibleLocations();

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) ?? null;

  const {
    dates: monthScheduleDates = [],
    isLoading: scheduleLoading,
    isError: scheduleError,
    error: scheduleErr,
  } = useScheduleDates(selectedLocationId ? selectedMonth : undefined, selectedLocationId);

  const effectiveMonthScheduleDates = useMemo(() => {
    if (!isOfflineMode || !snapshot) return monthScheduleDates;
    return scheduleDatesFromSnapshot(snapshot, selectedLocationId, selectedMonth).map((e) => ({
      date: e.date,
      time: e.time,
      timeEnd: e.timeEnd ?? e.time,
      slotId: e.slotId,
      disciplineId: e.disciplineId ?? null,
      locationId: e.locationId ?? null,
      scheduleGroupId: e.scheduleGroupId ?? null,
      teacherMemberId: e.teacherMemberId ?? null,
      groupName: e.label,
    }));
  }, [monthScheduleDates, isOfflineMode, snapshot, selectedLocationId, selectedMonth]);
  const {
    data: personalLessons = [],
    isLoading: personalLoading,
    isError: personalError,
    error: personalErr,
  } = usePersonalLessons({
    yearMonth: selectedLocationId ? selectedMonth : undefined,
    enabled: selectedLocationId != null && personalLessonsEnabled,
  });
  const { data: prices = [], isLoading: pricesLoading, isError: pricesError, error: pricesErr } = usePrices();
  const { groupsBySubId } = useSubscriptionGroups();
  const clientsQuery = useClientDirectory();
  const singleVisitsQuery = useSingleVisits({
    yearMonth: selectedLocationId ? selectedMonth : undefined,
    enabled: selectedLocationId != null,
  });

  const [selectedDate, setSelectedDate] = useState(todayDateStr);
  const [selectedLesson, setSelectedLesson] = useState<DayLessonEntry | null>(null);
  const [payTarget, setPayTarget] = useState<PayPersonalLessonTarget | null>(null);
  const [singleVisitOpen, setSingleVisitOpen] = useState(false);
  const [singleVisitClientQuery, setSingleVisitClientQuery] = useState("");
  const [singleVisitClientId, setSingleVisitClientId] = useState("");
  const [singleVisitPriceId, setSingleVisitPriceId] = useState("");
  const [singleVisitAmount, setSingleVisitAmount] = useState("");
  const [singleVisitMethod, setSingleVisitMethod] = useState<"cash" | "transfer" | "card" | "other">("cash");
  const [venueConfirmStatus, setVenueConfirmStatus] = useState<VenueCostRuleStatus | null>(null);
  const [closeAttendeeCount, setCloseAttendeeCount] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const closeGroupLesson = useCloseGroupLessonOccurrence();
  const reopenLessonClosure = useReopenLessonOccurrenceClosure();

  useEffect(() => {
    if (selectedLocationId != null || locations.length !== 1) return;
    setSelectedLocationId(locations[0].id);
  }, [locations, selectedLocationId]);

  useEffect(() => {
    setSelectedLesson(null);
    setSingleVisitOpen(false);
  }, [selectedLocationId]);

  useEffect(() => {
    const today = todayDateStr();
    const todayMonth = today.slice(0, 7);
    if (selectedMonth !== todayMonth) {
      setSelectedMonth(todayMonth);
    }
    setSelectedDate(today);
  }, []);

  useEffect(() => {
    if (selectedDate.slice(0, 7) !== selectedMonth) {
      setSelectedMonth(selectedDate.slice(0, 7));
    }
  }, [selectedDate, selectedMonth, setSelectedMonth]);

  useEffect(() => {
    if (!selectedLesson) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedLesson(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLesson]);

  useEffect(() => {
    setSingleVisitOpen(false);
    setSingleVisitClientQuery("");
    setSingleVisitClientId("");
    setSingleVisitPriceId("");
    setSingleVisitMethod("cash");
  }, [selectedLesson]);

  const groupLessonsForDay = useMemo(
    () => effectiveMonthScheduleDates.filter((item) => item.date === selectedDate),
    [effectiveMonthScheduleDates, selectedDate]
  );

  const locationPersonalLessons = useMemo(
    () =>
      personalLessons.filter((lesson) => (lesson.locationId ?? null) === selectedLocationId),
    [personalLessons, selectedLocationId]
  );

  const personalForDay = useMemo(
    () =>
      locationPersonalLessons
        .filter((l) => l.date === selectedDate)
        .sort((a, b) => a.timeStart.localeCompare(b.timeStart)),
    [locationPersonalLessons, selectedDate]
  );

  const { can, isReadOnly } = usePermissions();
  const { role, memberId, scope, settings: orgSettings } = useOrganization();
  const attendanceAccessOptions = useMemo(
    () => ({ directorsCanMarkAttendance: orgSettings?.directors_can_mark_attendance ?? true }),
    [orgSettings?.directors_can_mark_attendance]
  );

  const accessibleGroupLessonsForDay = useMemo(
    () =>
      groupLessonsForDay.filter((slot) =>
        canViewGroupAttendanceLesson(
          role,
          memberId,
          scope,
          { scheduleGroupId: slot.scheduleGroupId, teacherMemberId: slot.teacherMemberId },
          attendanceAccessOptions
        )
      ),
    [groupLessonsForDay, role, memberId, scope, attendanceAccessOptions]
  );

  const accessiblePersonalForDay = useMemo(
    () =>
      personalForDay.filter((lesson) =>
        canViewPersonalAttendanceLesson(role, memberId, lesson, attendanceAccessOptions)
      ),
    [personalForDay, role, memberId, attendanceAccessOptions]
  );

  const accessibleMonthGroupDates = useMemo(
    () =>
      effectiveMonthScheduleDates.filter((slot) =>
        canViewGroupAttendanceLesson(
          role,
          memberId,
          scope,
          { scheduleGroupId: slot.scheduleGroupId, teacherMemberId: slot.teacherMemberId },
          attendanceAccessOptions
        )
      ),
    [effectiveMonthScheduleDates, role, memberId, scope, attendanceAccessOptions]
  );

  const accessibleLocationPersonalLessons = useMemo(
    () =>
      locationPersonalLessons.filter((lesson) =>
        canViewPersonalAttendanceLesson(role, memberId, lesson, attendanceAccessOptions)
      ),
    [locationPersonalLessons, role, memberId, attendanceAccessOptions]
  );

  const dayScheduleEntries = useMemo((): DayLessonEntry[] => {
    const entries: DayLessonEntry[] = [
      ...accessibleGroupLessonsForDay
        .filter((slot) => slot.scheduleGroupId)
        .map((slot) => ({
        kind: "group" as const,
        slotId: slot.slotId,
        start: slot.time,
        key: `g-${slot.date}|${slot.time}|${slot.scheduleGroupId}`,
        time: slot.time,
        timeEnd: slot.timeEnd,
        disciplineId: slot.disciplineId ?? null,
        locationId: slot.locationId ?? null,
        scheduleGroupId: slot.scheduleGroupId ?? null,
        teacherMemberId: slot.teacherMemberId ?? null,
        label: slot.groupName
          ? `${slot.groupName} · ${slot.time} – ${slot.timeEnd}`
          : t("attendance.groupLessonTime", { time: slot.time, timeEnd: slot.timeEnd }),
      })),
      ...(isOfflineMode
        ? []
        : accessiblePersonalForDay.map((lesson) => ({
            kind: "personal" as const,
            start: lesson.timeStart,
            key: `p-${lesson.id}`,
            lesson,
            label: `${lesson.clientDisplay} · ${lesson.timeStart} – ${lesson.timeEnd}`,
          }))),
    ];
    return entries.sort((a, b) => a.start.localeCompare(b.start));
  }, [accessibleGroupLessonsForDay, accessiblePersonalForDay, isOfflineMode, t]);

  const subsOptions = useMemo(() => {
    if (!selectedLesson) return undefined;
    if (selectedLesson.kind === "group") {
      if (!selectedLesson.scheduleGroupId) return { subscriptionIds: [] as string[] };
      return {
        category: "group" as const,
        disciplineId: selectedLesson.disciplineId ?? null,
        scheduleGroupId: selectedLesson.scheduleGroupId,
        groupsBySubId,
      };
    }
    if (selectedLesson.lesson.subscriptionId) {
      return { subscriptionIds: [selectedLesson.lesson.subscriptionId] };
    }
    return { subscriptionIds: [] as string[] };
  }, [selectedLesson, groupsBySubId]);

  const { subs: modalSubs = [], isLoading: subsLoading, isError: subsError, error: subsErr, getSubsForDate } = useSubsForDate(
    selectedLesson && !isOfflineMode ? selectedDate : undefined,
    subsOptions,
    selectedMonth
  );

  const effectiveModalSubs = useMemo(() => {
    if (!isOfflineMode || !snapshot || !selectedLesson || selectedLesson.kind !== "group") {
      return modalSubs;
    }
    const scheduleGroupId = selectedLesson.scheduleGroupId;
    if (!scheduleGroupId) return [];
    const base = (snapshot.subsByDate[selectedDate] ?? []).filter((sub) =>
      (groupsBySubId[sub.subId] ?? []).some((g) => g.scheduleGroupId === scheduleGroupId)
    );
    return mergeSubsWithOfflineOps(base, queue?.operations ?? [], selectedDate, scheduleGroupId);
  }, [
    isOfflineMode,
    snapshot,
    selectedLesson,
    modalSubs,
    selectedDate,
    groupsBySubId,
    queue?.operations,
  ]);

  const markAttendance = useMarkAttendance();
  const markPersonalAttendance = useMarkPersonalLessonAttendance();
  const recordSingleVisit = useRecordSingleVisit();
  const undoAttendance = useUndoAttendanceCorrection();
  const singleVisitIdempotencyKey = usePaymentFormIdempotency(singleVisitOpen);
  const [attendanceCorrectionTarget, setAttendanceCorrectionTarget] =
    useState<AttendanceCorrectionTarget | null>(null);
  const [pendingUndo, setPendingUndo] = useState<{
    correctionId: string;
    expiresAt: number;
    clientDisplay: string;
  } | null>(null);
  const [lastAttendanceChangeAt, setLastAttendanceChangeAt] = useState<Record<string, number>>({});
  const { freezePolicy } = useSettings();
  const isLoading =
    !isOfflineMode &&
    (locationsLoading ||
      (selectedLocationId != null &&
        (scheduleLoading ||
          (personalLessonsEnabled && personalLoading) ||
          pricesLoading ||
          clientsQuery.isLoading ||
          singleVisitsQuery.isLoading)));
  const isError =
    !isOfflineMode &&
    (locationsError ||
      (selectedLocationId != null &&
        (scheduleError ||
          (personalLessonsEnabled && personalError) ||
          pricesError ||
          clientsQuery.isError ||
          singleVisitsQuery.isError)));
  const error =
    locationsErr ??
    scheduleErr ??
    (personalLessonsEnabled ? personalErr : null) ??
    pricesErr ??
    clientsQuery.error ??
    singleVisitsQuery.error;
  const canMarkAttendance = isDateMarkable(selectedDate) && can("attendance.write");
  const canMarkSelectedLesson = useMemo(() => {
    if (!canMarkAttendance || !selectedLesson) return canMarkAttendance;
    if (selectedLesson.kind === "group") {
      return canViewGroupAttendanceLesson(
        role,
        memberId,
        scope,
        {
          scheduleGroupId: selectedLesson.scheduleGroupId,
          teacherMemberId: selectedLesson.teacherMemberId,
        },
        attendanceAccessOptions
      );
    }
    return canViewPersonalAttendanceLesson(
      role,
      memberId,
      selectedLesson.lesson,
      attendanceAccessOptions
    );
  }, [canMarkAttendance, selectedLesson, role, memberId, scope, attendanceAccessOptions]);

  const calendarCells = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    if (!year || !month) return [];

    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startOffset = (jsDayToIsoDow(firstDay.getDay()) + 6) % 7;

    const groupDates = new Set(accessibleMonthGroupDates.map((d) => d.date));
    const personalDates = new Set(
      accessibleLocationPersonalLessons.filter((l) => l.date.startsWith(selectedMonth)).map((l) => l.date)
    );

    const cells: Array<{
      date: string | null;
      day: number | null;
      hasGroup: boolean;
      hasPersonal: boolean;
      isToday: boolean;
    }> = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({ date: null, day: null, hasGroup: false, hasPersonal: false, isToday: false });
    }

    const today = todayDateStr();
    for (let day = 1; day <= daysInMonth; day++) {
      const dd = String(day).padStart(2, "0");
      const mm = String(month).padStart(2, "0");
      const date = `${year}-${mm}-${dd}`;
      cells.push({
        date,
        day,
        hasGroup: groupDates.has(date),
        hasPersonal: !isOfflineMode && personalDates.has(date),
        isToday: date === today,
      });
    }

    return cells;
  }, [selectedMonth, accessibleMonthGroupDates, accessibleLocationPersonalLessons, isOfflineMode]);

  const handleMonthNav = (delta: number) => {
    const nextMonth = shiftMonth(selectedMonth, delta);
    setSelectedMonth(nextMonth);
    const [y, m] = nextMonth.split("-").map(Number);
    const currentDay = parseInt(selectedDate.split("-")[2], 10);
    const daysInNext = new Date(y, m, 0).getDate();
    const day = Math.min(currentDay, daysInNext);
    setSelectedDate(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    setSelectedLesson(null);
  };

  useEffect(() => {
    if (!pendingUndo) return;
    const ms = pendingUndo.expiresAt - Date.now();
    if (ms <= 0) {
      setPendingUndo(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingUndo(null), ms);
    return () => window.clearTimeout(timer);
  }, [pendingUndo]);

  useEffect(() => {
    if (isOfflineMode || offlineBlocked) return;
    if (!selectedLocationId || locations.length === 0) return;
    if (scheduleLoading || subsLoading) return;

    void captureShiftSnapshot({
      todayStr: todayDateStr(),
      locations: locations.map((loc) => ({ id: loc.id, name: loc.name })),
      scheduleDates: effectiveMonthScheduleDates.map((item) => ({
        date: item.date,
        time: item.time,
        timeEnd: item.timeEnd,
        slotId: item.slotId,
        disciplineId: item.disciplineId ?? null,
        locationId: item.locationId ?? null,
        scheduleGroupId: item.scheduleGroupId ?? null,
        teacherMemberId: item.teacherMemberId ?? null,
      })),
      getSubsForDate: (dateStr) => getSubsForDate(dateStr, { category: "group" }),
    });
  }, [
    isOfflineMode,
    offlineBlocked,
    selectedLocationId,
    locations,
    scheduleLoading,
    subsLoading,
    effectiveMonthScheduleDates,
    captureShiftSnapshot,
    getSubsForDate,
  ]);

  const handleMark = async (
    subId: string,
    status: "present" | "absent" | "freeze" | "excused",
    student: SubForDate & { offlinePending?: boolean; projectedLessonsLeft?: number }
  ) => {
    if (connectionState !== "online" && !canMarkOffline) {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!canMarkSelectedLesson) {
      toast(t("attendance.error.pastOnly"), "error");
      return;
    }

    if (status === "freeze" && !isMonthlyUnlimitedSubscription(student)) {
      if (!canApplyFreeze(student.lessonsTotal, student.freezeUsed, freezePolicy)) {
        toast(freezeUnavailableMessage(freezePolicy), "error");
        return;
      }
      if (student.freezeUsed >= freezePolicy.freezeMaxCount && student.currentStatus !== "freeze") {
        toast(freezeAlreadyUsedMessage(freezePolicy), "error");
        return;
      }
    }

    const disciplineId =
      selectedLesson?.kind === "group" ? selectedLesson.disciplineId ?? null : null;
    const scheduleGroupId =
      selectedLesson?.kind === "group" ? selectedLesson.scheduleGroupId ?? null : null;

    if (!scheduleGroupId) {
      toast(t("attendance.error.groupUnknown"), "error");
      return;
    }

    const changeKey = `${subId}:${selectedDate}:${scheduleGroupId}`;
    const oldStatus = student.currentStatus ?? null;

    if (
      oldStatus != null &&
      oldStatus !== status &&
      !isWithinAttendanceUndoWindow(lastAttendanceChangeAt[changeKey]) &&
      connectionState === "online"
    ) {
      setAttendanceCorrectionTarget({
        dateStr: selectedDate,
        subId,
        scheduleGroupId,
        disciplineId,
        clientDisplay: student.client1 + (student.client2 ? ` & ${student.client2}` : ""),
        oldStatus,
        newStatus: status,
        lastChangedAt: lastAttendanceChangeAt[changeKey],
      });
      return;
    }

    if (canMarkOffline) {
      const res = await enqueueOfflineMark({
        dateStr: selectedDate,
        subId,
        scheduleGroupId,
        disciplineId,
        expectedOldStatus: oldStatus,
        newStatus: status,
        snapshotLessonsLeft: student.lessonsLeft,
        snapshotFreezeUsed: student.freezeUsed,
        clientDisplay: student.client1 + (student.client2 ? ` & ${student.client2}` : ""),
      });
      if (!res.ok) {
        toast(t("common.saveFailed"), "error");
        return;
      }
      setLastAttendanceChangeAt((prev) => ({ ...prev, [changeKey]: Date.now() }));
      toast(t("offline.mark.savedLocally"), "success");
      return;
    }

    const res = await markAttendance.mutateAsync({
      dateStr: selectedDate,
      subId,
      status,
      disciplineId,
      scheduleGroupId,
      oldStatus,
      reasonCode: oldStatus != null && oldStatus !== status ? "misclick" : undefined,
    });
    if (!res.success) {
      toast(res.error || t("common.saveMarkFailed"), "error");
    } else {
      setLastAttendanceChangeAt((prev) => ({ ...prev, [changeKey]: Date.now() }));
      if (res.isCorrection && res.correctionId) {
        setPendingUndo({
          correctionId: res.correctionId,
          expiresAt: Date.now() + ATTENDANCE_UNDO_WINDOW_MS,
          clientDisplay: student.client1,
        });
      }
      toast(t("attendance.success.marked", { status: attendanceStatusLabel(status, t) }), "success");
    }
  };

  const handleAttendanceCorrectionSuccess = (result: {
    correctionId?: string;
    clientDisplay: string;
  }) => {
    if (!attendanceCorrectionTarget) return;
    const { subId, scheduleGroupId, newStatus } = attendanceCorrectionTarget;
    const changeKey = `${subId}:${selectedDate}:${scheduleGroupId}`;
    setLastAttendanceChangeAt((prev) => ({ ...prev, [changeKey]: Date.now() }));
    if (result.correctionId) {
      setPendingUndo({
        correctionId: result.correctionId,
        expiresAt: Date.now() + ATTENDANCE_UNDO_WINDOW_MS,
        clientDisplay: result.clientDisplay,
      });
    }
    toast(
      t("attendance.success.marked", { status: attendanceStatusLabel(newStatus, t) }),
      "success"
    );
  };

  const handleUndoAttendance = async () => {
    if (!pendingUndo) return;
    const res = await undoAttendance.mutateAsync({ correctionId: pendingUndo.correctionId });
    if (!res.success) {
      toast(res.error || t("corrections.error.undoFailed"), "error");
      return;
    }
    setPendingUndo(null);
    toast(t("corrections.attendance.undoSuccess"), "success");
  };

  const handleMarkPersonal = async (
    lessonId: string,
    status: "present" | "absent" | "excused"
  ) => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!canMarkSelectedLesson) {
      toast(t("attendance.error.pastOnly"), "error");
      return;
    }

    const res = await markPersonalAttendance.mutateAsync({ lessonId, status });
    if (!res.success) {
      toast(res.error || t("common.saveMarkFailed"), "error");
    } else {
      toast(t("attendance.success.marked", { status: attendanceStatusLabel(status, t) }), "success");
    }
  };

  const selectedGroupLesson = selectedLesson?.kind === "group" ? selectedLesson : null;
  const groupClosureQuery = useActiveGroupLessonClosure(
    selectedGroupLesson?.slotId,
    selectedGroupLesson ? selectedDate : null
  );
  const activeGroupClosure = groupClosureQuery.data ?? null;
  const canCloseGroupOccurrence =
    !isReadOnly &&
    (can("attendance.write", {
      disciplineId: selectedGroupLesson?.disciplineId ?? null,
      locationId: selectedGroupLesson?.locationId ?? null,
    }) ||
      can("finance.read"));
  const canReopenGroupClosure = can("finance.read");
  const singleVisitTariffs = useMemo(
    () =>
      selectedGroupLesson
        ? filterSingleVisitTariffsForSale(prices, {
            locationId: selectedLocationId,
            disciplineId: selectedGroupLesson.disciplineId ?? null,
          })
        : [],
    [prices, selectedGroupLesson, selectedLocationId]
  );
  const selectedClient = (clientsQuery.data ?? []).find((client) => client.id === singleVisitClientId) ?? null;
  const groupSingleVisits = useMemo(
    () =>
      selectedGroupLesson
        ? (singleVisitsQuery.data ?? [])
            .filter(
              (visit) =>
                visit.visitDate === selectedDate &&
                visit.scheduleSlotId === selectedGroupLesson.slotId
            )
            .sort((a, b) => a.clientDisplay.localeCompare(b.clientDisplay, locale))
        : [],
    [singleVisitsQuery.data, selectedDate, selectedGroupLesson, locale]
  );
  const canRecordSingleVisit =
    !!selectedGroupLesson &&
    !!selectedGroupLesson.slotId &&
    !isReadOnly &&
    isDateMarkable(selectedDate) &&
    can("single_visits.record", {
      disciplineId: selectedGroupLesson.disciplineId ?? null,
      locationId: selectedGroupLesson.locationId ?? null,
    });

  const handleSaveSingleVisitDraft = async () => {
    if (!selectedGroupLesson) return;
    const label = t("offline.draft.singleVisitReminder", {
      lesson: selectedGroupLesson.label,
      date: selectedDate,
    });
    const saved = await saveOfflinePaymentDraft({
      kind: "single_visit",
      reminderLabel: label,
      targetRef: selectedGroupLesson.slotId ?? selectedGroupLesson.scheduleGroupId ?? "unknown",
      dateStr: selectedDate,
    });
    toast(saved ? t("offline.draft.paymentSaved") : t("common.saveFailed"), saved ? "info" : "error");
  };

  const handleRecordSingleVisit = async (venueRuleAcknowledged = false) => {
    if (!selectedGroupLesson?.slotId) {
      toast(t("attendance.error.groupUnknown"), "error");
      return;
    }
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!canRecordSingleVisit) {
      toast(t("attendance.singleVisit.error.noAccess"), "error");
      return;
    }
    if (!singleVisitClientId || !selectedClient) {
      toast(t("attendance.singleVisit.error.clientRequired"), "error");
      return;
    }
    const amountNum = parseSingleVisitAmountInput(singleVisitAmount);
    if (!singleVisitPriceId) {
      if (amountNum === null || amountNum <= 0) {
        toast(t("attendance.singleVisit.error.amountOrTariffRequired"), "error");
        return;
      }
    } else if (singleVisitAmount.trim() !== "" && amountNum === null) {
      toast(t("attendance.singleVisit.error.invalidAmount"), "error");
      return;
    }

    const res = await recordSingleVisit.mutateAsync({
      visitDate: selectedDate,
      scheduleSlotId: selectedGroupLesson.slotId,
      clientId: singleVisitClientId,
      priceId: singleVisitPriceId || null,
      method: singleVisitMethod,
      amount: amountNum ?? undefined,
      idempotencyKey: singleVisitIdempotencyKey || crypto.randomUUID(),
      venueRuleAcknowledged,
    });
    if (!res.success) {
      if ("errorCode" in res && res.errorCode === "venue_rule_ack_required") {
        setVenueConfirmStatus(res.venueRuleStatus);
        return;
      }
      toast(res.error || t("attendance.singleVisit.error.recordFailed"), "error");
      return;
    }

    if (res.alreadyApplied) {
      toast(t("corrections.payment.alreadyApplied"), "info");
    } else {
      toast(t("attendance.singleVisit.success.recorded"), "success");
    }
    setVenueConfirmStatus(null);
    setSingleVisitOpen(false);
    setSingleVisitClientQuery("");
    setSingleVisitClientId("");
    setSingleVisitPriceId("");
    setSingleVisitAmount("");
    void queryClient.invalidateQueries({ queryKey: singleVisitsQueryKey });
  };

  const handleCloseGroupLesson = async () => {
    if (!selectedGroupLesson?.slotId) {
      toast(t("attendance.error.groupUnknown"), "error");
      return;
    }
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const presentFromMarks = countPresentAttendeesFromSubs(effectiveModalSubs, groupSingleVisits.length);
    const presentCount =
      closeAttendeeCount.trim() === "" ? presentFromMarks : Number(closeAttendeeCount);
    if (!Number.isFinite(presentCount) || presentCount < 0) {
      toast(t("venueCosts.closeLesson.error", { error: "invalid_attendees" }), "error");
      return;
    }
    const res = await closeGroupLesson.mutateAsync({
      scheduleSlotId: selectedGroupLesson.slotId,
      occurrenceDate: selectedDate,
      confirmedAttendeeCount: presentCount,
    });
    if (res.success === false) {
      toast(t("venueCosts.closeLesson.error", { error: res.error }), "error");
      return;
    }
    if (res.amount != null) {
      toast(
        `${t("venueCosts.closeLesson.success")} · ${t("venueCosts.closeLesson.amount", {
          amount: formatCurrency(res.amount),
        })}`,
        "success"
      );
    } else {
      toast(t("venueCosts.closeLesson.success"), "success");
    }
  };

  const handleReopenGroupLesson = async () => {
    if (!activeGroupClosure) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!reopenReason.trim()) {
      toast(formatReopenLessonError("reason_required", t), "error");
      return;
    }
    const res = await reopenLessonClosure.mutateAsync({
      closureId: activeGroupClosure.id,
      reason: reopenReason.trim(),
    });
    if (!res.success) {
      toast(formatReopenLessonError(res.error, t), "error");
      return;
    }
    setReopenReason("");
    toast(t("venueCosts.reopenLesson.success"), "success");
  };

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
    void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
    void queryClient.invalidateQueries({ queryKey: singleVisitsQueryKey });
    toast(t("attendance.info.refreshed"), "info");
  };

  const renderAttendanceRow = (
    st: SubForDate & { offlinePending?: boolean; projectedLessonsLeft?: number },
    showExtendedMarks: boolean
  ) => {
    const isMonthly = isMonthlyUnlimitedSubscription(st);
    const daysLeft = isMonthly ? getSubscriptionDaysLeft(st.expiresAt, selectedDate) : null;
    const confirmedLessonsLeft = st.lessonsLeft;
    const displayLessonsLeft =
      st.offlinePending && st.projectedLessonsLeft != null ? st.projectedLessonsLeft : confirmedLessonsLeft;
    const hasLowCredits = isMonthly ? (daysLeft ?? 0) <= 2 : displayLessonsLeft <= 2;
    const fullname = [st.client1, st.client2, st.client3].filter(Boolean).join(" & ");
    const freezeLocked = !st.canFreeze && st.currentStatus !== "freeze";
    const tariffLabel = getSubscriptionTariffLabel(st, prices);
    const connectionTitle = translateConnectionBlockReason(connectionState, t);
    const showFreeze = showExtendedMarks && !isMonthly && freezePolicy.freezeEnabled;
    const showExcused = showExtendedMarks && !isMonthly;
    const canMarkNow =
      (connectionState === "online" || canMarkOffline) && canMarkSelectedLesson && !markAttendance.isPending;

    return (
      <div
        key={st.subId}
        className="py-4 flex flex-col gap-3 border-b border-slate-100 last:border-0"
      >
        <div className="space-y-1.5">
          <p className="text-[11px] font-sans font-semibold text-indigo-700 leading-snug">{tariffLabel}</p>
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-slate-800 leading-tight">{fullname}</h4>
            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400 font-sans">
              <span>{isMonthly ? t("attendance.balance.remaining") : t("attendance.balance.label")}</span>
              <strong className={`font-semibold ${hasLowCredits ? "text-rose-600" : "text-slate-700"}`}>
                {isMonthly
                  ? `${daysLeft ?? 0} ${plural(daysLeft ?? 0, [t("common.day.one"), t("common.day.few"), t("common.day.many")])}`
                  : `${displayLessonsLeft} ${t("common.of")} ${st.lessonsTotal}`}
              </strong>
              {st.offlinePending && !isMonthly ? (
                <span className="text-amber-700 font-semibold">
                  · {t("offline.mark.notSynced")} ({t("offline.projectedBalance", {
                    count: displayLessonsLeft,
                    confirmed: confirmedLessonsLeft,
                  })})
                </span>
              ) : null}
              <span>· {t("common.from")} {st.activationDate}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-50">
          <button
            type="button"
            onClick={() => handleMark(st.subId, "present", st)}
            disabled={!canMarkNow}
            title={
              connectionTitle ??
              (isMonthly ? t("common.present") : t("attendance.titlePresentDeduct"))
            }
            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
              st.currentStatus === "present"
                ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            {t("common.present")}
          </button>

          <button
            type="button"
            onClick={() => handleMark(st.subId, "absent", st)}
            disabled={!canMarkNow}
            title={
              connectionTitle ??
              (isMonthly ? t("common.absent") : t("attendance.titleAbsentDeduct"))
            }
            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
              st.currentStatus === "absent"
                ? "bg-rose-600 border-rose-600 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:bg-rose-50"
            }`}
          >
            <X className="w-3.5 h-3.5" />
            {t("common.absent")}
          </button>

          {showFreeze && (
            <button
              type="button"
              onClick={() => handleMark(st.subId, "freeze", st)}
              disabled={!canMarkNow || freezeLocked}
              title={
                connectionTitle ??
                (freezeLocked
                  ? t("attendance.titleHintFreezeOnce")
                  : t("attendance.titleFreezeNoDeduct"))
              }
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border disabled:opacity-60 ${
                st.currentStatus === "freeze"
                  ? "bg-sky-600 border-sky-600 text-white shadow-xs cursor-pointer"
                  : freezeLocked
                    ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                    : "bg-white border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50 cursor-pointer"
              }`}
            >
              <Snowflake className="w-3.5 h-3.5" />
              {t("common.freeze")}
            </button>
          )}

          {showExcused && (
            <button
              type="button"
              onClick={() => handleMark(st.subId, "excused", st)}
            disabled={!canMarkNow}
            title={connectionTitle ?? t("attendance.titleExcusedNoDeduct")}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
              st.currentStatus === "excused"
                ? "bg-slate-600 border-slate-600 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {t("common.excusedShort")}
          </button>
          )}
        </div>
      </div>
    );
  };

  const modalTitle =
    selectedLesson?.kind === "group"
      ? t("attendance.modalGroupTitle", {
          time: selectedLesson.time,
          timeEnd: selectedLesson.timeEnd,
        })
      : selectedLesson?.label ?? t("common.lessonDefault");

  const activePersonalLesson =
    selectedLesson?.kind === "personal"
      ? locationPersonalLessons.find((l) => l.id === selectedLesson.lesson.id) ?? selectedLesson.lesson
      : null;

  const isPersonalOneOffView =
    selectedLesson?.kind === "personal" &&
    !selectedLesson.lesson.subscriptionId &&
    !!activePersonalLesson;

  const isPersonalPackageView =
    selectedLesson?.kind === "personal" &&
    !!selectedLesson.lesson.subscriptionId &&
    !!activePersonalLesson;

  const isPersonalAttendanceView = isPersonalOneOffView || isPersonalPackageView;
  const canPayActivePersonalLesson =
    !!activePersonalLesson &&
    activePersonalLesson.paid === "no" &&
    !isReadOnly &&
    can("payments.write", {
      disciplineId: activePersonalLesson.disciplineId ?? null,
      locationId: activePersonalLesson.locationId ?? null,
    });

  const isSubsListView =
    !!selectedLesson &&
    !isPersonalAttendanceView &&
    !subsError &&
    !(subsLoading && !isOfflineMode) &&
    effectiveModalSubs.length > 0;

  const useVirtualSubsList = isSubsListView && effectiveModalSubs.length >= 20;

  const openPayPersonalLesson = async (lesson: PersonalLesson) => {
    if (connectionState !== "online") {
      const saved = await saveOfflinePaymentDraft({
        kind: "personal_lesson",
        reminderLabel: `${lesson.clientDisplay} · ${lesson.date} ${lesson.timeStart}`,
        targetRef: lesson.id,
        dateStr: lesson.date,
      });
      toast(saved ? t("offline.draft.paymentSaved") : t("common.saveFailed"), saved ? "info" : "error");
      return;
    }
    setPayTarget({
      lessonId: lesson.id,
      date: lesson.date,
      timeStart: lesson.timeStart,
      timeEnd: lesson.timeEnd,
      clientId1: lesson.clientId1,
      clientId2: lesson.clientId2,
      clientId3: lesson.clientId3,
      clientDisplay: lesson.clientDisplay,
      price: lesson.price,
      paidAmount: lesson.paidAmount,
      locationId: lesson.locationId ?? null,
      disciplineId: lesson.disciplineId ?? null,
    });
  };

  const renderSingleVisitPanel = () => {
    if (!selectedGroupLesson) return null;

    if (isOfflineMode && canRecordSingleVisit) {
      return (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
          <p className="text-[11px] text-amber-800 font-sans leading-relaxed">
            {t("offline.restrictions.singleVisit")}
          </p>
          <button
            type="button"
            onClick={() => void handleSaveSingleVisitDraft()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 border border-amber-300 bg-white hover:bg-amber-50 text-amber-900 rounded-lg text-[11px] font-sans font-semibold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <Ticket className="w-3.5 h-3.5" />
            {t("offline.draft.saveReminder")}
          </button>
        </div>
      );
    }

    return (
      <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-3">
        {canRecordSingleVisit && (
          <button
            type="button"
            onClick={() => setSingleVisitOpen((value) => !value)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 border border-dashed border-slate-300 hover:border-indigo-300 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 rounded-lg text-[11px] font-sans font-semibold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <Ticket className="w-3.5 h-3.5" />
            {t("attendance.singleVisit.button")}
          </button>
        )}

        {singleVisitOpen && canRecordSingleVisit && (
          <div className="space-y-3 pt-1">
            <ClientAutocomplete
              label={t("common.client")}
              clients={clientsQuery.data ?? []}
              query={singleVisitClientQuery}
              selectedId={singleVisitClientId}
              onQueryChange={(value) => {
                setSingleVisitClientQuery(value);
                setSingleVisitClientId("");
              }}
              onSelect={(client) => {
                setSingleVisitClientId(client.id);
                setSingleVisitClientQuery(`${client.lastName} ${client.firstName}`.trim());
              }}
              showAddClientButton
              addClientLinkLabel={t("common.newClient")}
              modalSubmitLabel={t("clients.form.addSubmit")}
              toast={toast}
            />

            <AppSelect
              label={t("attendance.singleVisit.tariffOptional")}
              value={singleVisitPriceId}
              onChange={(e) => {
                const id = e.target.value;
                setSingleVisitPriceId(id);
                const tariff = singleVisitTariffs.find((price) => price.id === id);
                if (tariff) setSingleVisitAmount(tariff.price.toString());
              }}
            >
              <option value="">{t("attendance.singleVisit.tariffPlaceholder")}</option>
              {singleVisitTariffs.map((tariff) => (
                <option key={tariff.id} value={tariff.id!}>
                  {getPriceLabel(tariff, t)} · {formatCurrency(tariff.price)}
                </option>
              ))}
            </AppSelect>

            {singleVisitTariffs.length === 0 && (
              <p className="text-[11px] text-amber-600 font-sans">
                {t("attendance.singleVisit.noTariffs")}{" "}
                <Link to="/prices" className="font-semibold text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline">
                  {t("attendance.singleVisit.openPrices")}
                </Link>
              </p>
            )}

            <AppSelect
              label={t("common.method")}
              value={singleVisitMethod}
              onChange={(e) => setSingleVisitMethod(e.target.value as typeof singleVisitMethod)}
            >
              {SINGLE_VISIT_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {t(PAYMENT_METHOD_KEYS[method])}
                </option>
              ))}
            </AppSelect>

            <div className="field-stack">
              <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
                {t("common.amount")}
              </label>
              <input
                type="number"
                placeholder="0"
                value={singleVisitAmount}
                onChange={(e) => setSingleVisitAmount(e.target.value)}
                className={`${fieldCls} font-semibold`}
              />
            </div>

            <button
              type="button"
              onClick={() => void handleRecordSingleVisit()}
              disabled={
                recordSingleVisit.isPending ||
                connectionState !== "online" ||
                !canSubmitSingleVisitForm(singleVisitClientId, singleVisitPriceId, singleVisitAmount)
              }
              className={`w-full ${btnAddCls}`}
            >
              {recordSingleVisit.isPending ? t("common.saving") : t("attendance.singleVisit.record")}
            </button>
          </div>
        )}

        {selectedGroupLesson.slotId &&
          connectionState === "online" &&
          (canCloseGroupOccurrence || (Boolean(activeGroupClosure) && canReopenGroupClosure)) && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-slate-800 uppercase tracking-wider">
              {t("venueCosts.closeLesson")}
            </p>
            {activeGroupClosure ? (
              <>
                <p className="text-xs text-slate-800 font-semibold">{t("venueCosts.closeLesson.closed")}</p>
                {activeGroupClosure.confirmedAttendeeCount != null && (
                  <p className="text-[11px] text-slate-600">
                    {t("venueCosts.closeLesson.attendeesConfirmed", {
                      count: activeGroupClosure.confirmedAttendeeCount,
                    })}
                  </p>
                )}
                {canReopenGroupClosure && (
                  <>
                    <label className="block space-y-1">
                      <span className="text-[10px] text-slate-500 font-sans uppercase tracking-wider">
                        {t("venueCosts.reopenLesson.reason")}
                      </span>
                      <input
                        type="text"
                        value={reopenReason}
                        onChange={(e) => setReopenReason(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-amber-400"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleReopenGroupLesson()}
                      disabled={reopenLessonClosure.isPending}
                      className={`w-full ${btnOpenCls}`}
                    >
                      {reopenLessonClosure.isPending ? t("common.saving") : t("venueCosts.reopenLesson")}
                    </button>
                  </>
                )}
              </>
            ) : canCloseGroupOccurrence ? (
              <>
                <label className="block space-y-1">
                  <span className="text-[10px] text-slate-500 font-sans uppercase tracking-wider">
                    {t("venueCosts.closeLesson.attendees")}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={closeAttendeeCount}
                    placeholder={String(
                      countPresentAttendeesFromSubs(effectiveModalSubs, groupSingleVisits.length)
                    )}
                    onChange={(e) => setCloseAttendeeCount(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-amber-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleCloseGroupLesson()}
                  disabled={closeGroupLesson.isPending}
                  className={`w-full ${btnAddCls}`}
                >
                  {closeGroupLesson.isPending ? t("common.saving") : t("venueCosts.closeLesson.confirm")}
                </button>
              </>
            ) : null}
          </div>
        )}

        {groupSingleVisits.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t("attendance.singleVisit.recordedTitle")}
            </p>
            {groupSingleVisits.map((visit) => (
              <div key={visit.id} className="flex items-center justify-between gap-2 text-xs font-sans">
                <span className="text-slate-700 truncate">{visit.clientDisplay}</span>
                <span className="text-indigo-700 font-semibold whitespace-nowrap">{formatCurrency(visit.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  if (isError) {
    return (
      <div id="panel-attendance" className="panel-page-stack">
        <QueryErrorState error={error} onRetry={handleRefresh} />
      </div>
    );
  }

  if (selectedLocationId && offlineBlocked) {
    return (
      <div id="panel-attendance" className="panel-page-stack">
        <OfflineLimitedState
          reason={snapshotMeta.isExpired ? "expired" : "missing"}
          windowStart={snapshotMeta.windowStart}
          windowEnd={snapshotMeta.windowEnd}
          locations={snapshot?.locations}
        />
      </div>
    );
  }

  if (!selectedLocationId) {
    return (
      <div id="panel-attendance" className="panel-page-stack">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
          <div className="panel-card-stack">
            <h2 className="text-base font-semibold tracking-tight text-slate-800">{t("attendance.title")}</h2>
            <p className="text-xs text-slate-400">{t("attendance.hint.selectLocation")}</p>
          </div>

          {isLoading ? (
            <LoadingState label={t("attendance.loadingLocations")} />
          ) : locations.length === 0 ? (
            <div className="text-center py-16 text-slate-400 space-y-3">
              <MapPin className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm">{t("attendance.noLocations")}</p>
              <AddLocationsInSettingsHint />
            </div>
          ) : (
            <div className="space-y-2">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setSelectedLocationId(loc.id)}
                  className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-all cursor-pointer text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{loc.name}</p>
                    {loc.address ? (
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{loc.address}</p>
                    ) : (
                      <p className="text-[11px] text-slate-300 italic mt-0.5">{t("common.noAddress")}</p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div id="panel-attendance" className="panel-page-stack">
        <LoadingState label={t("attendance.loading")} />
      </div>
    );
  }

  return (
    <div id="panel-attendance" className="panel-page-stack">
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="panel-card-stack">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedLocationId(null);
                  setSelectedLesson(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t("attendance.allLocations")}
              </button>
              <h2 className="text-base font-semibold tracking-tight text-slate-800">
                {t("attendance.title")}
              </h2>
              {selectedLocation && (
                <p className="text-xs text-slate-500 font-sans flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  {selectedLocation.name}
                </p>
              )}
            </div>
            <button
              onClick={handleRefresh}
              className="shrink-0 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("common.refresh")}
            </button>
          </div>
          <p className="w-full text-xs text-slate-400">
            {t("attendance.hint.selectDay")}
          </p>
          {isOfflineMode && snapshotMeta.hasSnapshot && snapshotMeta.isStale ? (
            <p className="text-xs text-amber-700 font-semibold">{t("offline.snapshot.stale")}</p>
          ) : null}
          {isOfflineMode && snapshotMeta.windowStart && snapshotMeta.windowEnd ? (
            <p className="text-[11px] text-slate-400">
              {t("offline.snapshot.window", {
                start: snapshotMeta.windowStart,
                end: snapshotMeta.windowEnd,
              })}
            </p>
          ) : null}
        </div>

        {isOfflineMode && snapshotMeta.hasSnapshot && !snapshotMeta.isExpired ? (
          <OfflineScopeNotice />
        ) : null}

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-200">
            <button
              type="button"
              onClick={() => handleMonthNav(-1)}
              className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">{formatMonthTitle(selectedMonth, locale)}</span>
            <button
              type="button"
              onClick={() => handleMonthNav(1)}
              className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 bg-slate-50/50">
            {weekdayLabels.map((label) => (
              <div key={label} className="text-center text-[10px] font-sans font-semibold text-slate-400 uppercase py-2">
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-slate-200 p-px">
            {calendarCells.map((cell, idx) => {
              if (!cell.date || cell.day === null) {
                return <div key={`empty-${idx}`} className="bg-white min-h-[52px]" />;
              }

              const isSelected = cell.date === selectedDate;
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => {
                    setSelectedDate(cell.date!);
                    setSelectedLesson(null);
                  }}
                  className={`min-h-[52px] bg-white p-1.5 flex flex-col items-center justify-start gap-1 transition-colors cursor-pointer ${
                    isSelected ? "ring-2 ring-inset ring-indigo-500 bg-indigo-50/60" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`text-sm font-semibold leading-none ${
                      cell.isToday
                        ? "w-6 h-6 flex items-center justify-center rounded-full bg-indigo-600 text-white"
                        : isSelected
                          ? "text-indigo-700"
                          : "text-slate-700"
                    }`}
                  >
                    {cell.day}
                  </span>
                  <div className="flex items-center gap-0.5 min-h-[6px]">
                    {cell.hasGroup && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" title={t("common.groupLesson")} />
                    )}
                    {cell.hasPersonal && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-700" title={t("common.personalLesson")} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-4 text-[10px] text-slate-500 font-sans">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-500" /> {t("common.groupShort")}
            </span>
            {personalLessonsEnabled && !isOfflineMode ? (
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-indigo-700" /> {t("common.personalShort")}
              </span>
            ) : null}
          </div>
        </div>

        <p className="text-xs text-slate-500 font-sans leading-relaxed">
          {t("attendance.editSchedule")}{" "}
          <Link to="/schedule" className="text-indigo-600 hover:text-indigo-800 font-semibold underline-offset-2 hover:underline">
            {t("attendance.scheduleLink")}
          </Link>
          .
        </p>

        {selectedDate && (
          <div className="panel-card-stack">
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
              <p className="text-xs font-semibold text-slate-700">{formatAttendanceDate(selectedDate)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-sans">{t("attendance.daySchedule")}</p>
              {!canMarkAttendance && (
                <p className="text-[10px] text-amber-600 mt-1 font-sans">
                  {t("attendance.error.pastOnly")}
                </p>
              )}
            </div>

            {dayScheduleEntries.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{t("attendance.lessonJournal")}</h3>
                {dayScheduleEntries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setSelectedLesson(entry)}
                    className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border transition-all cursor-pointer text-left ${
                      entry.kind === "group"
                        ? "bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                        : "bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <p
                        className={`text-[10px] font-sans font-semibold uppercase tracking-wider ${
                          entry.kind === "group" ? "text-indigo-600" : "text-indigo-700"
                        }`}
                      >
                        {entry.kind === "group" ? t("common.groupLabel") : t("common.personalLabel")}
                        {entry.kind === "personal" && entry.lesson.subscriptionId ? t("common.packageSuffix") : ""}
                      </p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{entry.label}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-sans text-center py-6">{t("attendance.noLessonsDay")}</p>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedLesson && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLesson(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-lg w-full max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 shrink-0">
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-slate-900">{modalTitle}</h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-sans">{formatDate(selectedDate)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLesson(null)}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div
                className={`px-4 py-3 flex-1 min-h-0 ${useVirtualSubsList ? "" : "overflow-y-auto"}`}
              >
                {isPersonalAttendanceView && activePersonalLesson ? (
                  <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-800">{activePersonalLesson.clientDisplay}</p>
                      {isPersonalPackageView ? (
                        <p className="text-xs text-slate-500 font-sans">{t("common.packagePaid")}</p>
                      ) : (
                        <>
                          <p className="text-xs text-slate-500 font-sans">
                            {t("common.singleLesson")} · {formatCurrency(activePersonalLesson.price)}
                          </p>
                          <p className="text-xs font-sans">
                            {t("common.paymentLabel")}:{" "}
                            <span
                              className={
                                activePersonalLesson.paid === "yes"
                                  ? "text-indigo-600 font-semibold"
                                  : "text-rose-600 font-semibold"
                              }
                            >
                              {activePersonalLesson.paid === "yes"
                                ? t("common.paidStatus")
                                : t("common.unpaidStatus")}
                            </span>
                          </p>
                          {activePersonalLesson.paid === "no" && activePersonalLesson.paidAmount > 0 && (
                            <p className="text-xs font-sans text-slate-500">
                              {t("personal.pay.paidSoFar")}: {formatCurrency(activePersonalLesson.paidAmount)}
                              {" · "}
                              <span className="text-rose-600 font-semibold">
                                {t("common.debt")}:{" "}
                                {formatCurrency(
                                  Math.max(activePersonalLesson.price - activePersonalLesson.paidAmount, 0)
                                )}
                              </span>
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {!canMarkSelectedLesson ? (
                      <p className="text-[11px] text-amber-600 font-sans">
                        {t("attendance.error.pastOnly")}
                      </p>
                    ) : isOfflineMode ? (
                      <div className="space-y-2">
                        <p className="text-[11px] text-amber-700 font-sans leading-relaxed">
                          {t("offline.restrictions.personalAttendance")}
                        </p>
                        {canPayActivePersonalLesson ? (
                          <button
                            type="button"
                            onClick={() => void openPayPersonalLesson(activePersonalLesson)}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border bg-amber-100 border-amber-300 text-amber-900 cursor-pointer"
                          >
                            <Coins className="w-3.5 h-3.5" />
                            {t("offline.draft.saveReminder")}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <AttendanceMarkLegend showFreeze={false} t={t} />
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {canPayActivePersonalLesson ? (
                            <button
                              type="button"
                              onClick={() => openPayPersonalLesson(activePersonalLesson)}
                              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border bg-indigo-600 border-indigo-600 text-white shadow-xs cursor-pointer"
                            >
                              <Coins className="w-3.5 h-3.5" />
                              {t("common.pay")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleMarkPersonal(activePersonalLesson.id, "present")}
                            disabled={connectionState !== "online" || markPersonalAttendance.isPending}
                            title={translateConnectionBlockReason(connectionState, t) ?? t("attendance.titlePresentDeduct")}
                            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
                              activePersonalLesson.attendanceStatus === "present"
                                ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                                : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            {t("common.present")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkPersonal(activePersonalLesson.id, "absent")}
                            disabled={connectionState !== "online" || markPersonalAttendance.isPending}
                            title={translateConnectionBlockReason(connectionState, t) ?? t("attendance.titleAbsentDeduct")}
                            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
                              activePersonalLesson.attendanceStatus === "absent"
                                ? "bg-rose-600 border-rose-600 text-white shadow-xs"
                                : "bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:bg-rose-50"
                            }`}
                          >
                            <X className="w-3.5 h-3.5" />
                            {t("common.absent")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkPersonal(activePersonalLesson.id, "excused")}
                            disabled={connectionState !== "online" || markPersonalAttendance.isPending}
                            title={translateConnectionBlockReason(connectionState, t) ?? t("attendance.titleExcusedNoDeduct")}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
                              activePersonalLesson.attendanceStatus === "excused"
                                ? "bg-slate-600 border-slate-600 text-white shadow-xs"
                                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            {t("common.excusedShort")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : subsError ? (
                  <QueryErrorState error={subsErr} onRetry={handleRefresh} />
                ) : subsLoading ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                    <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
                    <p className="text-xs">{t("attendance.loadingSubscriptions")}</p>
                  </div>
                ) : effectiveModalSubs.length === 0 ? (
                  <div>
                    {renderSingleVisitPanel()}
                    <div className="text-center py-20 text-slate-400 space-y-3">
                      <Ticket className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="text-sm">{t("attendance.noSubscriptions")}</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    {renderSingleVisitPanel()}
                    {!canMarkSelectedLesson && (
                      <p className="text-[11px] text-amber-600 font-sans mb-3">
                        {t("attendance.error.pastOnly")}
                      </p>
                    )}
                    <AttendanceMarkLegend
                      showFreeze={selectedLesson?.kind === "group" && freezePolicy.freezeEnabled}
                      t={t}
                    />
                    <p className="text-[10px] font-sans bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-semibold inline-block mb-3 tabular-nums">
                      {effectiveModalSubs.length}{" "}
                      {plural(effectiveModalSubs.length, [
                        t("common.subscription.one"),
                        t("common.subscription.few"),
                        t("common.subscription.many"),
                      ])}
                    </p>
                    {useVirtualSubsList ? (
                      <VirtualList
                        items={effectiveModalSubs}
                        estimateSize={96}
                        maxHeight="min(60vh, 480px)"
                        getKey={(st) => st.subId}
                        renderItem={(st) =>
                          renderAttendanceRow(st, selectedLesson.kind === "group")
                        }
                      />
                    ) : (
                      effectiveModalSubs.map((st) =>
                        renderAttendanceRow(st, selectedLesson.kind === "group")
                      )
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 px-4 py-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedLesson(null)}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans text-xs rounded-lg transition-colors cursor-pointer"
                >
                  {t("common.close")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <PayPersonalLessonModal
        lesson={payTarget}
        toast={toast}
        onClose={() => setPayTarget(null)}
        onSuccess={() => {
          setPayTarget(null);
          setSelectedLesson(null);
        }}
      />

      {pendingUndo && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800 text-white text-sm shadow-lg">
          <span>{t("corrections.attendance.undoHint", { client: pendingUndo.clientDisplay })}</span>
          <button
            type="button"
            onClick={() => void handleUndoAttendance()}
            disabled={undoAttendance.isPending}
            className="px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-semibold text-xs"
          >
            {t("corrections.attendance.undo")}
          </button>
        </div>
      )}

      <AttendanceCorrectionDialog
        target={attendanceCorrectionTarget}
        open={attendanceCorrectionTarget != null}
        onClose={() => setAttendanceCorrectionTarget(null)}
        onSuccess={handleAttendanceCorrectionSuccess}
        toast={toast}
      />

      <VenueRulePaymentConfirmDialog
        status={venueConfirmStatus}
        pending={recordSingleVisit.isPending}
        onConfirm={() => void handleRecordSingleVisit(true)}
        onCancel={() => setVenueConfirmStatus(null)}
      />
    </div>
  );
}
