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
  useSubsForDate,
} from "../hooks/useAttendance";
import { useSubscriptionGroups } from "../hooks/useSubscriptionGroups";
import { usePersonalLessons, useMarkPersonalLessonAttendance, personalLessonsQueryKey } from "../hooks/usePersonalLessons";
import { useClientDirectory } from "../hooks/useClients";
import { singleVisitsQueryKey, useRecordSingleVisit, useSingleVisits } from "../hooks/useSingleVisits";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { usePermissions } from "../hooks/usePermissions";
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
import { useI18n } from "../hooks/useI18n";
import { useUIStore } from "../store/ui";
import QueryErrorState from "./ui/QueryErrorState";
import LoadingState from "./ui/LoadingState";
import AddLocationsInSettingsHint from "./ui/AddLocationsInSettingsHint";
import VirtualList from "./ui/VirtualList";
import AppSelect from "./ui/AppSelect";
import ClientAutocomplete from "./ui/ClientAutocomplete";
import PayPersonalLessonModal, { type PayPersonalLessonTarget } from "./schedule/PayPersonalLessonModal";
import type { ToastType } from "../App";
import type { PersonalLesson, SubForDate } from "../types";

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
  const {
    data: personalLessons = [],
    isLoading: personalLoading,
    isError: personalError,
    error: personalErr,
  } = usePersonalLessons({
    yearMonth: selectedLocationId ? selectedMonth : undefined,
    enabled: selectedLocationId != null,
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
  const [singleVisitMethod, setSingleVisitMethod] = useState<"cash" | "transfer" | "card" | "other">("cash");

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
    () => monthScheduleDates.filter((item) => item.date === selectedDate),
    [monthScheduleDates, selectedDate]
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

  const dayScheduleEntries = useMemo((): DayLessonEntry[] => {
    const entries: DayLessonEntry[] = [
      ...groupLessonsForDay
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
        label: slot.groupName
          ? `${slot.groupName} · ${slot.time} – ${slot.timeEnd}`
          : t("attendance.groupLessonTime", { time: slot.time, timeEnd: slot.timeEnd }),
      })),
      ...personalForDay.map((lesson) => ({
        kind: "personal" as const,
        start: lesson.timeStart,
        key: `p-${lesson.id}`,
        lesson,
        label: `${lesson.clientDisplay} · ${lesson.timeStart} – ${lesson.timeEnd}`,
      })),
    ];
    return entries.sort((a, b) => a.start.localeCompare(b.start));
  }, [groupLessonsForDay, personalForDay, t]);

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

  const { subs: modalSubs = [], isLoading: subsLoading, isError: subsError, error: subsErr } = useSubsForDate(
    selectedLesson ? selectedDate : undefined,
    subsOptions,
    selectedMonth
  );

  const markAttendance = useMarkAttendance();
  const markPersonalAttendance = useMarkPersonalLessonAttendance();
  const recordSingleVisit = useRecordSingleVisit();
  const { can, isReadOnly } = usePermissions();
  const { freezePolicy } = useSettings();
  const isLoading =
    locationsLoading ||
    (selectedLocationId != null && (scheduleLoading || personalLoading || pricesLoading || clientsQuery.isLoading || singleVisitsQuery.isLoading));
  const isError =
    locationsError ||
    (selectedLocationId != null && (scheduleError || personalError || pricesError || clientsQuery.isError || singleVisitsQuery.isError));
  const error = locationsErr ?? scheduleErr ?? personalErr ?? pricesErr ?? clientsQuery.error ?? singleVisitsQuery.error;
  const canMarkAttendance = isDateMarkable(selectedDate) && can("attendance.write");

  const calendarCells = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    if (!year || !month) return [];

    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startOffset = (jsDayToIsoDow(firstDay.getDay()) + 6) % 7;

    const groupDates = new Set(monthScheduleDates.map((d) => d.date));
    const personalDates = new Set(
      locationPersonalLessons.filter((l) => l.date.startsWith(selectedMonth)).map((l) => l.date)
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
        hasPersonal: personalDates.has(date),
        isToday: date === today,
      });
    }

    return cells;
  }, [selectedMonth, monthScheduleDates, locationPersonalLessons]);

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

  const handleMark = async (
    subId: string,
    status: "present" | "absent" | "freeze" | "excused",
    student: SubForDate
  ) => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!canMarkAttendance) {
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

    const res = await markAttendance.mutateAsync({
      dateStr: selectedDate,
      subId,
      status,
      disciplineId,
      scheduleGroupId,
    });
    if (!res.success) {
      toast(res.error || t("common.saveMarkFailed"), "error");
    } else {
      toast(t("attendance.success.marked", { status: attendanceStatusLabel(status, t) }), "success");
    }
  };

  const handleMarkPersonal = async (
    lessonId: string,
    status: "present" | "absent" | "excused"
  ) => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!canMarkAttendance) {
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
  const selectedSingleVisitPrice = singleVisitTariffs.find((price) => price.id === singleVisitPriceId) ?? null;
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

  const handleRecordSingleVisit = async () => {
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
    if (!singleVisitPriceId) {
      toast(t("attendance.singleVisit.error.tariffRequired"), "error");
      return;
    }

    const res = await recordSingleVisit.mutateAsync({
      visitDate: selectedDate,
      scheduleSlotId: selectedGroupLesson.slotId,
      clientId: singleVisitClientId,
      priceId: singleVisitPriceId,
      method: singleVisitMethod,
    });
    if (!res.success) {
      toast(res.error || t("attendance.singleVisit.error.recordFailed"), "error");
      return;
    }

    toast(t("attendance.singleVisit.success.recorded"), "success");
    setSingleVisitOpen(false);
    setSingleVisitClientQuery("");
    setSingleVisitClientId("");
    setSingleVisitPriceId("");
    void queryClient.invalidateQueries({ queryKey: singleVisitsQueryKey });
  };

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
    void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
    void queryClient.invalidateQueries({ queryKey: singleVisitsQueryKey });
    toast(t("attendance.info.refreshed"), "info");
  };

  const renderAttendanceRow = (st: SubForDate, showExtendedMarks: boolean) => {
    const isMonthly = isMonthlyUnlimitedSubscription(st);
    const daysLeft = isMonthly ? getSubscriptionDaysLeft(st.expiresAt, selectedDate) : null;
    const hasLowCredits = isMonthly ? (daysLeft ?? 0) <= 2 : st.lessonsLeft <= 2;
    const fullname = [st.client1, st.client2, st.client3].filter(Boolean).join(" & ");
    const freezeLocked = !st.canFreeze && st.currentStatus !== "freeze";
    const tariffLabel = getSubscriptionTariffLabel(st, prices);
    const connectionTitle = translateConnectionBlockReason(connectionState, t);
    const showFreeze = showExtendedMarks && !isMonthly;
    const showExcused = showExtendedMarks && !isMonthly;

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
                  : `${st.lessonsLeft} ${t("common.of")} ${st.lessonsTotal}`}
              </strong>
              <span>· {t("common.from")} {st.activationDate}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-50">
          <button
            type="button"
            onClick={() => handleMark(st.subId, "present", st)}
            disabled={connectionState !== "online" || !canMarkAttendance || markAttendance.isPending}
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
            disabled={connectionState !== "online" || !canMarkAttendance || markAttendance.isPending}
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
              disabled={connectionState !== "online" || !canMarkAttendance || markAttendance.isPending || freezeLocked}
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
            disabled={connectionState !== "online" || !canMarkAttendance || markAttendance.isPending}
            title={connectionTitle ?? t("attendance.titleExcusedNoDeduct")}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
              st.currentStatus === "excused"
                ? "bg-amber-600 border-amber-600 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-600 hover:border-amber-300 hover:bg-amber-50"
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
    !!selectedLesson && !isPersonalAttendanceView && !subsError && !subsLoading && modalSubs.length > 0;

  const useVirtualSubsList = isSubsListView && modalSubs.length >= 20;

  const openPayPersonalLesson = (lesson: PersonalLesson) => {
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
      locationId: lesson.locationId ?? null,
      disciplineId: lesson.disciplineId ?? null,
    });
  };

  const renderSingleVisitPanel = () => {
    if (!selectedGroupLesson) return null;

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
              label={t("attendance.singleVisit.tariff")}
              value={singleVisitPriceId}
              onChange={(e) => setSingleVisitPriceId(e.target.value)}
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

            <div className="flex items-center justify-between gap-3 rounded-lg bg-white border border-slate-100 px-3 py-2">
              <span className="text-xs text-slate-500 font-sans">{t("common.amount")}</span>
              <span className="text-sm font-semibold text-slate-800">
                {selectedSingleVisitPrice ? formatCurrency(selectedSingleVisitPrice.price) : "—"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleRecordSingleVisit}
              disabled={
                recordSingleVisit.isPending ||
                connectionState !== "online" ||
                !singleVisitClientId ||
                !singleVisitPriceId
              }
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-60"
            >
              {recordSingleVisit.isPending ? t("common.saving") : t("attendance.singleVisit.record")}
            </button>
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
        <QueryErrorState error={error} />
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
        </div>

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
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-700" /> {t("common.personalShort")}
            </span>
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
                        </>
                      )}
                    </div>

                    {!canMarkAttendance ? (
                      <p className="text-[11px] text-amber-600 font-sans">
                        {t("attendance.error.pastOnly")}
                      </p>
                    ) : (
                      <>
                        <AttendanceMarkLegend showFreeze={false} t={t} />
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {canPayActivePersonalLesson ? (
                            <button
                              type="button"
                              onClick={() => openPayPersonalLesson(activePersonalLesson)}
                              disabled={connectionState !== "online"}
                              title={translateConnectionBlockReason(connectionState, t)}
                              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border bg-indigo-600 border-indigo-600 text-white shadow-xs cursor-pointer disabled:opacity-60"
                            >
                              <Coins className="w-3.5 h-3.5" />
                              {t("common.markPaid")}
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
                                ? "bg-amber-600 border-amber-600 text-white shadow-xs"
                                : "bg-white border-slate-200 text-slate-600 hover:border-amber-300 hover:bg-amber-50"
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
                  <QueryErrorState error={subsErr} />
                ) : subsLoading ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                    <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
                    <p className="text-xs">{t("attendance.loadingSubscriptions")}</p>
                  </div>
                ) : modalSubs.length === 0 ? (
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
                    {!canMarkAttendance && (
                      <p className="text-[11px] text-amber-600 font-sans mb-3">
                        {t("attendance.error.pastOnly")}
                      </p>
                    )}
                    <AttendanceMarkLegend showFreeze={selectedLesson?.kind === "group"} t={t} />
                    <p className="text-[10px] font-sans bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-semibold inline-block mb-3 tabular-nums">
                      {modalSubs.length}{" "}
                      {plural(modalSubs.length, [
                        t("common.subscription.one"),
                        t("common.subscription.few"),
                        t("common.subscription.many"),
                      ])}
                    </p>
                    {useVirtualSubsList ? (
                      <VirtualList
                        items={modalSubs}
                        estimateSize={96}
                        maxHeight="min(60vh, 480px)"
                        getKey={(st) => st.subId}
                        renderItem={(st) =>
                          renderAttendanceRow(st, selectedLesson.kind === "group")
                        }
                      />
                    ) : (
                      modalSubs.map((st) =>
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
    </div>
  );
}
