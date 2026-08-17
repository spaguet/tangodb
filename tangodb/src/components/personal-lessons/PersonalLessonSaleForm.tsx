import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, MapPin, Ticket, Trash2 } from "lucide-react";
import { useClients, useClientDirectory } from "../../hooks/useClients";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useAccessibleLocations } from "../../hooks/useLocations";
import { useAddPersonalLessons, usePersonalLessons } from "../../hooks/usePersonalLessons";
import { useRecordPersonalLessonPayment } from "../../hooks/usePayments";
import { usePrices } from "../../hooks/usePrices";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules, shouldShowLocationPicker } from "../../lib/orgModules";
import { usePermissions } from "../../hooks/usePermissions";
import { memberDisplayName, memberListLabel, type TeamMemberRow } from "../../hooks/useTeamMembers";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../../hooks/useOnlineStatus";
import { findScheduleConflict, formatScheduleConflictToast } from "../../lib/scheduleConflicts";
import type { PersonalLessonRef, ScheduleSlotRef } from "../../lib/scheduleConflicts";
import {
  expandPersonalLessonWeeklySlots,
  expandWeeklyRecurrence,
  expandWeeklyRecurrenceByWeekCount,
  findLessonEntriesBeyondEndDate,
  groupSlotsByTime,
  uniqueWeeklyRecurrenceRows,
  type PersonalLessonSlot,
} from "../../lib/personalLessonDates";
import { computeAutoTimeEnd, validateTimeRange } from "../../lib/scheduleTime";
import { toISODateLocal, addDays } from "../../lib/scheduleWeek";
import {
  billedFromTariff,
  durationHardBlock,
  durationWarning,
  formatLessonDuration,
  lessonDurationMinutes,
  tariffUnitsSnapshot,
  type DurationWarningCode,
} from "../../lib/personalTariffPricing";
import {
  bookingClientsMatchSubscription,
  jsDayToIsoDow,
  formatClientName,
  formatCurrency,
  getPriceLabel,
  getPrivateTariffOptionLabel,
  filterPrivateLessonTariffsForSale,
  getSubscriptionClientIds,
  tariffParticipantType,
} from "../../lib/utils";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import type { I18nKey } from "../../lib/i18n/keys";
import type { Client, Price, Subscription } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";
import ClientAutocomplete from "../ui/ClientAutocomplete";
import DatePickerField from "../ui/DatePickerField";
import DisciplineSelect from "../ui/DisciplineSelect";
import LocationSelect from "../ui/LocationSelect";
import SellPackageModal from "../ui/SellPackageModal";
import TimeSelect from "../ui/TimeSelect";
import type { ScheduleCellPrefill } from "../schedule/AddLessonTypePopup";
import VenueRulePaymentConfirmDialog from "../venue-costs/VenueRulePaymentConfirmDialog";
import { useVenueCostRuleStatus, type VenueCostRuleStatus } from "../../hooks/useVenueCosts";
import { useGoogleCalendarFreebusy } from "../../hooks/useGoogleCalendarFreebusy";
import GoogleCalendarFreebusyWarning from "../integrations/GoogleCalendarFreebusyWarning";

export type PersonalLessonSaleFormMode = "schedule-cell" | "standalone";

interface BookingClientField {
  query: string;
  id: string;
}

interface LessonDateEntry {
  date: string;
  timeStart: string;
  timeEnd: string;
}

function defaultLessonEntry(date: string): LessonDateEntry {
  return { date, timeStart: "14:00", timeEnd: "15:00" };
}

export interface PersonalLessonSaleFormProps {
  mode: PersonalLessonSaleFormMode;
  prefill?: ScheduleCellPrefill | null;
  teacherOptions: TeamMemberRow[];
  scheduleSlots: ScheduleSlotRef[];
  personalLessons: PersonalLessonRef[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onSuccess: () => void;
  /** Закрыть popup (режим schedule-cell). */
  onClose?: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const checkboxCls = "rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";
const addRowBtnCls =
  "w-full py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer";
const MAX_CLIENTS = 4;

function participantTypeFromCount(count: number): "solo" | "pair" | "trio" | "quad" {
  if (count >= 4) return "quad";
  if (count >= 3) return "trio";
  if (count === 2) return "pair";
  return "solo";
}

const WEEK_COUNT_OPTIONS = [2, 3, 4, 6, 8, 12] as const;

function validateBookingClients(
  clients: BookingClientField[],
  t: (key: I18nKey, params?: Record<string, string | number>) => string
): string | null {
  if (!clients[0]?.id) return t("common.selectClientError");
  for (let i = 1; i < clients.length; i += 1) {
    if (!clients[i]?.query || !clients[i]?.id) {
      return t("common.selectClientN", { n: i + 1 });
    }
  }
  return null;
}

interface TariffBilling {
  billed: number;
  lessonMinutes: number;
  warning: DurationWarningCode | null;
  tariffUnits: number | null;
}

function computeTariffBilling(
  tariff: Pick<Price, "price" | "durationMinutes">,
  timeStart: string,
  timeEnd: string
): TariffBilling {
  const lessonMinutes = lessonDurationMinutes(timeStart, timeEnd);
  const billed = billedFromTariff(tariff.price, lessonMinutes, tariff.durationMinutes);
  const warning = durationWarning({
    lessonMinutes,
    tariffDurationMinutes: tariff.durationMinutes,
  });
  const tariffUnits =
    tariff.durationMinutes != null && lessonMinutes > 0
      ? tariffUnitsSnapshot(lessonMinutes, tariff.durationMinutes)
      : null;
  return { billed, lessonMinutes, warning, tariffUnits };
}

function translateDurationWarningCode(
  code: DurationWarningCode,
  t: (key: I18nKey, params?: Record<string, string | number>) => string,
  tariffDurationMinutes: number | null | undefined,
  lessonMinutes: number
): string {
  const tariffDuration =
    tariffDurationMinutes != null ? formatLessonDuration(tariffDurationMinutes, t) : "";
  const lessonDuration = formatLessonDuration(lessonMinutes, t);
  switch (code) {
    case "legacy_no_duration":
      return t("personalTariff.warn.legacyNoDuration");
    case "shorter":
      return t("personalTariff.warn.shorter", { lessonDuration, tariffDuration });
    case "longer_not_multiple":
      return t("personalTariff.warn.longerNotMultiple", { lessonDuration, tariffDuration });
    case "longer_multiple": {
      const multiple =
        tariffDurationMinutes != null && tariffDurationMinutes > 0
          ? Math.floor(lessonMinutes / tariffDurationMinutes)
          : 0;
      return t("personalTariff.warn.longerMultiple", {
        multiple,
        tariffDuration,
        lessonDuration,
      });
    }
    default:
      return "";
  }
}

export default function PersonalLessonSaleForm({
  mode,
  prefill = null,
  teacherOptions,
  scheduleSlots,
  personalLessons,
  toast,
  onSuccess,
  onClose,
}: PersonalLessonSaleFormProps) {
  const { t, locale, formatDate, plural } = useI18n();
  const isScheduleCell = mode === "schedule-cell";
  const todayISO = toISODateLocal(new Date());

  const { memberId, settings } = useOrganization();
  const { role, can } = usePermissions();
  const { connectionState } = useOnlineStatus();
  const { data: activeClients = [] } = useClients();
  const { data: directoryClients = [] } = useClientDirectory();
  const { data: disciplines = [] } = useDisciplines();
  const { data: prices = [] } = usePrices();
  const { data: subscriptions = [] } = useSubscriptions();
  const { locations: accessibleLocations = [] } = useAccessibleLocations();
  const orgModules = normalizeOrgModules(settings?.modules);
  const showLocationInForm = shouldShowLocationPicker(orgModules, accessibleLocations.length);
  const addPersonalLessons = useAddPersonalLessons();
  const recordPersonalLessonPayment = useRecordPersonalLessonPayment();
  const venueStatusQuery = useVenueCostRuleStatus();
  const lessonPaymentIdempotencyKeys = useRef<Record<string, string>>({});
  const bookingInFlightRef = useRef(false);
  const pendingVenueBookingRef = useRef<{ immediatePaid: boolean } | null>(null);

  const getLessonPaymentIdempotencyKey = (lessonId: string): string => {
    const existing = lessonPaymentIdempotencyKeys.current[lessonId];
    if (existing) return existing;
    const key = crypto.randomUUID();
    lessonPaymentIdempotencyKeys.current[lessonId] = key;
    return key;
  };
  const [venueConfirmStatus, setVenueConfirmStatus] = useState<VenueCostRuleStatus | null>(null);
  const [pendingVenuePayment, setPendingVenuePayment] = useState<{
    payments: Array<{ lessonId: string; amount: number; billing: TariffBilling | null }>;
    clientId: string;
    clientDisplay: string;
    tariff: Price | null;
  } | null>(null);

  const isTeacher = role === "teacher";

  const [bookingClients, setBookingClients] = useState<BookingClientField[]>([{ query: "", id: "" }]);
  const [timeStart, setTimeStart] = useState("14:00");
  const [timeEnd, setTimeEnd] = useState("15:00");
  const [manualLessonPrice, setManualLessonPrice] = useState("");
  const [payerClientId, setPayerClientId] = useState("");
  const [billingSplitMode, setBillingSplitMode] = useState<"single_payer" | "equal">("single_payer");
  const [selectedLessonTariffId, setSelectedLessonTariffId] = useState<string | "">("");
  const [linkedSubscriptionId, setLinkedSubscriptionId] = useState("");
  const [disciplineId, setDisciplineId] = useState<string>("");
  const [teacherMemberId, setTeacherMemberId] = useState("");
  const [bookingPaymentMode, setBookingPaymentMode] = useState<"single" | "package" | null>(null);
  const [packageModalOpen, setPackageModalOpen] = useState(false);

  const [locationId, setLocationId] = useState("");
  const [lessonEntries, setLessonEntries] = useState<LessonDateEntry[]>(() => [defaultLessonEntry(todayISO)]);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [weeklyEndMode, setWeeklyEndMode] = useState<"date" | "weeks">("weeks");
  const [weeklyEndDate, setWeeklyEndDate] = useState("");
  const [weeklyWeekCount, setWeeklyWeekCount] = useState(4);

  const effectiveLocationId = isScheduleCell ? (prefill?.locationId ?? "") : locationId;

  const freebusySlots = useMemo(() => {
    if (isScheduleCell) {
      if (!prefill?.date) return [];
      return expandPersonalLessonWeeklySlots(prefill.date, timeStart, timeEnd, {
        repeatWeekly,
        endMode: weeklyEndMode,
        weekCount: weeklyWeekCount,
        endDate: weeklyEndDate,
      }).filter((slot) => slot.date && slot.timeStart && slot.timeEnd);
    }

    return lessonEntries.filter((slot) => slot.date && slot.timeStart && slot.timeEnd);
  }, [
    isScheduleCell,
    prefill?.date,
    timeStart,
    timeEnd,
    repeatWeekly,
    weeklyEndMode,
    weeklyWeekCount,
    weeklyEndDate,
    lessonEntries,
  ]);

  const { hasOverlap: hasGoogleFreebusyOverlap, isChecking: isCheckingGoogleFreebusy } =
    useGoogleCalendarFreebusy({
      teacherMemberId,
      slots: freebusySlots,
    });

  const conflictCheckDateRange = useMemo(() => {
    if (!isScheduleCell || freebusySlots.length === 0) return null;
    let min = freebusySlots[0].date;
    let max = freebusySlots[0].date;
    for (const slot of freebusySlots) {
      if (slot.date < min) min = slot.date;
      if (slot.date > max) max = slot.date;
    }
    return { start: min, end: max };
  }, [isScheduleCell, freebusySlots]);

  const lessonsInRangeQuery = usePersonalLessons({
    dateRange: conflictCheckDateRange ?? undefined,
    excludeCancelled: true,
    enabled: Boolean(conflictCheckDateRange),
  });

  const personalLessonsForConflict = useMemo(() => {
    if (!conflictCheckDateRange) return personalLessons;
    return (lessonsInRangeQuery.data ?? []).map((lesson) => ({
      id: lesson.id,
      date: lesson.date,
      timeStart: lesson.timeStart,
      timeEnd: lesson.timeEnd,
      locationId: lesson.locationId,
    }));
  }, [conflictCheckDateRange, lessonsInRangeQuery.data, personalLessons]);

  const pType = participantTypeFromCount(bookingClients.length);

  const lessonTariffs = useMemo(
    () =>
      filterPrivateLessonTariffsForSale(prices, {
        locationId: effectiveLocationId || null,
        disciplineId: disciplineId || null,
        teacherMemberId: teacherMemberId || null,
      }),
    [prices, effectiveLocationId, disciplineId, teacherMemberId]
  );

  const selectedClientIds = useMemo(
    () => bookingClients.map((c) => c.id).filter(Boolean),
    [bookingClients]
  );

  const showPayerSelect = selectedClientIds.length >= 2;

  const selectedTariff = useMemo(
    () => lessonTariffs.find((tariff) => tariff.id === selectedLessonTariffId) ?? null,
    [lessonTariffs, selectedLessonTariffId]
  );

  const primaryTimeStart = isScheduleCell ? timeStart : (lessonEntries[0]?.timeStart ?? timeStart);
  const primaryTimeEnd = isScheduleCell ? timeEnd : (lessonEntries[0]?.timeEnd ?? timeEnd);

  const primaryBilling = useMemo(() => {
    if (!selectedTariff) return null;
    return computeTariffBilling(selectedTariff, primaryTimeStart, primaryTimeEnd);
  }, [selectedTariff, primaryTimeStart, primaryTimeEnd]);

  const durationWarningMessage = useMemo(() => {
    if (!selectedTariff || !primaryBilling?.warning) return null;
    return translateDurationWarningCode(
      primaryBilling.warning,
      t,
      selectedTariff.durationMinutes,
      primaryBilling.lessonMinutes
    );
  }, [selectedTariff, primaryBilling, t]);

  const clientMap = useMemo(
    () => Object.fromEntries(directoryClients.map((c) => [c.id, c])),
    [directoryClients]
  );

  const availablePrivateSubs = subscriptions.filter(
    (s) => s.category === "private" && s.status === "active" && s.lessonsLeft > 0
  );

  const packageLocked = bookingPaymentMode === "package" && !!linkedSubscriptionId;

  useEffect(() => {
    if (selectedClientIds.length === 0) {
      setPayerClientId("");
      return;
    }
    if (selectedClientIds.length === 1) {
      setPayerClientId(selectedClientIds[0]);
      return;
    }
    if (!payerClientId || !selectedClientIds.includes(payerClientId)) {
      setPayerClientId(selectedClientIds[0]);
    }
  }, [selectedClientIds, payerClientId]);

  useEffect(() => {
    if (isScheduleCell) {
      if (!prefill) return;
      setBookingClients([{ query: "", id: "" }]);
      setTimeStart(prefill.timeStart);
      setTimeEnd(computeAutoTimeEnd(prefill.timeStart, []));
      setManualLessonPrice("");
      setPayerClientId("");
      setSelectedLessonTariffId("");
      setLinkedSubscriptionId("");
      setBookingPaymentMode(null);
      setRepeatWeekly(false);
      setWeeklyEndMode("weeks");
      setWeeklyEndDate("");
      setWeeklyWeekCount(4);
      if (disciplines.length > 0) setDisciplineId(disciplines[0].id);
      if (isTeacher && memberId) {
        setTeacherMemberId(memberId);
      } else if (teacherOptions.length > 0) {
        setTeacherMemberId(teacherOptions[0].id);
      }
      return;
    }

    if (disciplines.length > 0 && !disciplineId) setDisciplineId(disciplines[0].id);
    if (accessibleLocations.length > 0 && !locationId) setLocationId(accessibleLocations[0].id);
    if (isTeacher && memberId) {
      setTeacherMemberId(memberId);
    } else if (teacherOptions.length > 0 && !teacherMemberId) {
      setTeacherMemberId(teacherOptions[0].id);
    }
  }, [
    isScheduleCell,
    prefill,
    disciplines,
    teacherOptions,
    isTeacher,
    memberId,
    accessibleLocations,
  ]);

  useEffect(() => {
    if (lessonTariffs.length > 0 && selectedLessonTariffId === "") {
      setSelectedLessonTariffId(lessonTariffs[0].id!);
    }
  }, [lessonTariffs, selectedLessonTariffId]);

  useEffect(() => {
    if (selectedLessonTariffId && !lessonTariffs.some((tariff) => tariff.id === selectedLessonTariffId)) {
      setSelectedLessonTariffId("");
    }
  }, [lessonTariffs, selectedLessonTariffId]);

  const sameDayLessons = useMemo(() => {
    if (!isScheduleCell || !prefill) return [];
    return personalLessons
      .filter((l) => l.date === prefill.date && l.locationId === prefill.locationId)
      .map((l) => ({ timeStart: l.timeStart, timeEnd: l.timeEnd }));
  }, [isScheduleCell, prefill, personalLessons]);

  const handleTimeStartChange = (next: string) => {
    setTimeStart(next);
    if (isScheduleCell) {
      setTimeEnd(computeAutoTimeEnd(next, sameDayLessons));
    }
  };

  const applyLessonTariff = (tariffId: string) => {
    const tariff = lessonTariffs.find((item) => item.id === tariffId);
    if (!tariff) return;
    setSelectedLessonTariffId(tariffId);
    if (packageLocked) return;
    const participant = tariffParticipantType(tariff);
    const neededFields =
      participant === "solo" ? 1 : participant === "pair" ? 2 : participant === "trio" ? 3 : 4;
    setBookingClients((prev) => {
      const next = [...prev];
      while (next.length < neededFields) next.push({ query: "", id: "" });
      while (next.length > neededFields) next.pop();
      return next;
    });
  };

  const applySubscriptionToBooking = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return;
    const fields: BookingClientField[] = getSubscriptionClientIds(sub).map((id) => {
      const c = clientMap[id];
      return { id, query: c ? formatClientName(c.lastName, c.firstName) : id };
    });
    if (fields.length === 0) fields.push({ query: "", id: "" });
    setBookingClients(fields);
  };

  const resolveLessonSlots = (): PersonalLessonSlot[] | null => {
    if (isScheduleCell) {
      if (!prefill) return null;

      if (repeatWeekly) {
        if (weeklyEndMode === "weeks" && weeklyWeekCount < 1) {
          toast(t("personal.error.weekCount"), "error");
          return null;
        }
        if (weeklyEndMode === "date") {
          if (!weeklyEndDate) {
            toast(t("personal.error.endDate"), "error");
            return null;
          }
          if (weeklyEndDate < prefill.date) {
            toast(t("personal.error.endBeforeStart"), "error");
            return null;
          }
        }
      }

      const slots = expandPersonalLessonWeeklySlots(prefill.date, timeStart, timeEnd, {
        repeatWeekly,
        endMode: weeklyEndMode,
        weekCount: weeklyWeekCount,
        endDate: weeklyEndDate,
      });

      if (repeatWeekly && slots.length === 0) {
        toast(t("personal.error.noDatesGenerated"), "error");
        return null;
      }

      return slots;
    }

    const filteredEntries = lessonEntries.filter((e) => e.date);
    if (filteredEntries.length === 0) {
      toast(t("common.selectDateError"), "error");
      return null;
    }

    if (!repeatWeekly) {
      return filteredEntries.map(({ date, timeStart, timeEnd }) => ({ date, timeStart, timeEnd }));
    }

    const startDate = [...filteredEntries.map((e) => e.date)].sort()[0];
    const rows = uniqueWeeklyRecurrenceRows(
      filteredEntries.map(({ date, timeStart, timeEnd }) => ({
        dayOfWeek: jsDayToIsoDow(new Date(`${date}T12:00:00`).getDay()),
        timeStart,
        timeEnd,
      }))
    );

    if (weeklyEndMode === "weeks") {
      if (weeklyWeekCount < 1) {
        toast(t("personal.error.weekCount"), "error");
        return null;
      }
      const endDate = addDays(startDate, weeklyWeekCount * 7 - 1);
      const beyondEnd = findLessonEntriesBeyondEndDate(filteredEntries, endDate);
      if (beyondEnd.length > 0) {
        toast(
          t("personal.error.datesBeyondEnd", {
            dates: beyondEnd.map((d) => formatDate(d)).join(", "),
            endDate: formatDate(endDate),
          }),
          "error"
        );
        return null;
      }
      return expandWeeklyRecurrenceByWeekCount(startDate, weeklyWeekCount, rows);
    }

    if (!weeklyEndDate) {
      toast(t("personal.error.endDate"), "error");
      return null;
    }
    if (weeklyEndDate < startDate) {
      toast(t("personal.error.endBeforeStart"), "error");
      return null;
    }
    const beyondEnd = findLessonEntriesBeyondEndDate(filteredEntries, weeklyEndDate);
    if (beyondEnd.length > 0) {
      toast(
        t("personal.error.datesBeyondEnd", {
          dates: beyondEnd.map((d) => formatDate(d)).join(", "),
          endDate: formatDate(weeklyEndDate),
        }),
        "error"
      );
      return null;
    }
    const slots = expandWeeklyRecurrence(startDate, weeklyEndDate, rows);
    if (slots.length === 0) {
      toast(t("personal.error.noDatesGenerated"), "error");
      return null;
    }
    return slots;
  };

  const handleBook = async (immediatePaid: boolean, venueRuleAcknowledged = false) => {
    if (bookingInFlightRef.current) return;

    if (!immediatePaid) {
      pendingVenueBookingRef.current = null;
      setPendingVenuePayment(null);
      setVenueConfirmStatus(null);
    }

    if (immediatePaid && !venueRuleAcknowledged) {
      const currentStatus = (await venueStatusQuery.refetch()).data;
      if (currentStatus?.acknowledgementRequired) {
        pendingVenueBookingRef.current = { immediatePaid: true };
        setVenueConfirmStatus(currentStatus);
        return;
      }
    }
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }

    if (!isScheduleCell && !locationId) {
      toast(t("common.selectLocation"), "error");
      return;
    }

    const clientError = validateBookingClients(bookingClients, t);
    if (clientError) {
      toast(clientError, "error");
      return;
    }

    if (!disciplineId) {
      toast(t("common.selectDiscipline"), "error");
      return;
    }

    if (!isScheduleCell && !teacherMemberId) {
      toast(t("common.selectTeacher"), "error");
      return;
    }

    if (bookingPaymentMode === "package" && !linkedSubscriptionId) {
      toast(t("common.selectPackageError"), "error");
      return;
    }

    if (showPayerSelect && !payerClientId) {
      toast(t("personalTariff.payer.required"), "error");
      return;
    }

    const slots = resolveLessonSlots();
    if (!slots?.length) return;

    const manualPriceNum = parseFloat(manualLessonPrice);
    const isPackageBooking = bookingPaymentMode === "package";

    if (!isPackageBooking) {
      if (selectedTariff) {
        for (const slot of slots) {
          const billing = computeTariffBilling(selectedTariff, slot.timeStart, slot.timeEnd);
          const hardBlock = durationHardBlock({
            lessonMinutes: billing.lessonMinutes,
            tariffDurationMinutes: selectedTariff.durationMinutes,
            tariffFound: true,
            billed: billing.billed,
            tariffPaymentMode: true,
          });
          if (hardBlock) {
            toast(`${formatDate(slot.date)}: ${t("common.invalidLessonCost")}`, "error");
            return;
          }
        }
      } else if (lessonTariffs.length === 0) {
        if (Number.isNaN(manualPriceNum) || manualPriceNum < 0) {
          toast(t("common.invalidLessonCost"), "error");
          return;
        }
      } else {
        toast(t("subscriptions.error.selectTariff"), "error");
        return;
      }
    }

    for (const slot of slots) {
      const rangeError = validateTimeRange(slot.timeStart, slot.timeEnd);
      if (rangeError) {
        const msg =
          rangeError.includes("позже") || rangeError.includes("later")
            ? t("schedule.error.endBeforeStart")
            : t("utils.conflict.invalidTime");
        toast(`${formatDate(slot.date)}: ${msg}`, "error");
        return;
      }
    }

    if (linkedSubscriptionId) {
      const linkedSub = subscriptions.find((s) => s.id === linkedSubscriptionId);
      if (!linkedSub) {
        toast(t("common.packageNotFound"), "error");
        return;
      }
      if (
        !bookingClientsMatchSubscription(linkedSub, {
          clientId1: bookingClients[0].id,
          clientId2: bookingClients.length >= 2 ? bookingClients[1].id : "",
          clientId3: bookingClients.length >= 3 ? bookingClients[2].id : "",
          clientId4: bookingClients.length >= 4 ? bookingClients[3].id : "",
        })
      ) {
        toast(t("personal.error.clientsMismatch"), "error");
        return;
      }
    }

    let lessonsForConflict = personalLessonsForConflict;
    if (conflictCheckDateRange) {
      const { data: rangeLessons } = await lessonsInRangeQuery.refetch();
      lessonsForConflict = (rangeLessons ?? []).map((lesson) => ({
        id: lesson.id,
        date: lesson.date,
        timeStart: lesson.timeStart,
        timeEnd: lesson.timeEnd,
        locationId: lesson.locationId,
      }));
    }

    for (const slot of slots) {
      const conflict = findScheduleConflict(
        {
          date: slot.date,
          timeStart: slot.timeStart,
          timeEnd: slot.timeEnd,
          locationId: effectiveLocationId,
        },
        lessonsForConflict,
        scheduleSlots,
        t,
        locale
      );
      if (conflict) {
        toast(formatScheduleConflictToast(slot.date, conflict, t, locale), "error");
        return;
      }
    }

    const payerId = payerClientId || bookingClients[0].id;
    const payerClient = directoryClients.find((c) => c.id === payerId);
    const payerDisplay = payerClient
      ? formatClientName(payerClient.lastName, payerClient.firstName)
      : bookingClients.find((c) => c.id === payerId)?.query || t("common.client");

    const willRecordCashPayments =
      immediatePaid && bookingPaymentMode === "single" && !isPackageBooking;
    const slotGroups = groupSlotsByTime(slots);
    const createdPaymentPlans: Array<{
      lessonId: string;
      amount: number;
      billing: TariffBilling | null;
    }> = [];

    bookingInFlightRef.current = true;
    try {
      for (const group of slotGroups) {
        const groupBilling = selectedTariff
          ? computeTariffBilling(selectedTariff, group.timeStart, group.timeEnd)
          : null;
        const groupPrice = isPackageBooking
          ? 0
          : groupBilling?.billed ?? manualPriceNum;

        const res = await addPersonalLessons.mutateAsync({
          requireScope: true,
          type: pType,
          clientId1: bookingClients[0].id,
          clientId2: bookingClients.length >= 2 ? bookingClients[1].id : "",
          clientId3: bookingClients.length >= 3 ? bookingClients[2].id : "",
          clientId4: bookingClients.length >= 4 ? bookingClients[3].id : "",
          dates: group.dates,
          timeStart: group.timeStart,
          timeEnd: group.timeEnd,
          price: groupPrice,
          paid: willRecordCashPayments ? false : immediatePaid,
          disciplineId,
          locationId: effectiveLocationId,
          teacherMemberId,
          subscriptionId: isPackageBooking ? linkedSubscriptionId || undefined : undefined,
          priceId: isPackageBooking ? null : selectedTariff?.id ?? null,
          payerClientId: payerId,
          billingSplitMode: showPayerSelect ? billingSplitMode : "single_payer",
        });

        if (!res.success) {
          toast(resolveMutationError(res.error, "common.bookFailed", t), "error");
          return;
        }
        if (res.ids) {
          for (const lessonId of res.ids) {
            createdPaymentPlans.push({
              lessonId,
              amount: groupPrice,
              billing: groupBilling,
            });
          }
        }
      }

      if (!immediatePaid) {
        const countLabel =
          createdPaymentPlans.length > 1
            ? t("personal.countSuffix", { count: createdPaymentPlans.length })
            : "";
        toast(
          linkedSubscriptionId && isPackageBooking
            ? t("personal.success.bookedPackage", { count: countLabel })
            : t("personal.success.bookedUnpaid", { count: countLabel }),
          "success"
        );
        onSuccess();
        onClose?.();
        return;
      }

      if (willRecordCashPayments && createdPaymentPlans.length) {
        for (const plan of createdPaymentPlans) {
          if (plan.amount <= 0) continue;
          const paymentRes = await recordPersonalLessonPayment.mutateAsync({
            lessonId: plan.lessonId,
            clientId: payerId,
            clientDisplay: payerDisplay,
            amount: plan.amount,
            method: "cash",
            markPaid: true,
            idempotencyKey: getLessonPaymentIdempotencyKey(plan.lessonId),
            venueRuleAcknowledged,
            priceId: selectedTariff?.id ?? null,
            tariffUnits: plan.billing?.tariffUnits ?? null,
            tariffDurationMinutes: selectedTariff?.durationMinutes ?? null,
            tariffPrice: selectedTariff?.price ?? null,
            tariffLabel: selectedTariff ? getPriceLabel(selectedTariff, t) : null,
            lessonDurationMinutes: plan.billing?.lessonMinutes ?? null,
          });
          if (!paymentRes.success) {
            if (
              "errorCode" in paymentRes &&
              paymentRes.errorCode === "venue_rule_ack_required" &&
              "venueRuleStatus" in paymentRes
            ) {
              setPendingVenuePayment({
                payments: createdPaymentPlans.filter((p) => p.amount > 0),
                clientId: payerId,
                clientDisplay: payerDisplay,
                tariff: selectedTariff,
              });
              setVenueConfirmStatus(paymentRes.venueRuleStatus);
              return;
            }
            toast(resolveMutationError(paymentRes.error, "common.bookedPaymentFailed", t), "error");
            onSuccess();
            onClose?.();
            return;
          }
        }
      }
    } finally {
      bookingInFlightRef.current = false;
    }

    const countLabel =
      createdPaymentPlans.length > 1
        ? t("personal.countSuffix", { count: createdPaymentPlans.length })
        : "";
    toast(
      linkedSubscriptionId && isPackageBooking
        ? t("personal.success.bookedPackage", { count: countLabel })
        : immediatePaid
          ? t("personal.success.bookedPaid", { count: countLabel })
          : t("personal.success.bookedUnpaid", { count: countLabel }),
      "success"
    );
    onSuccess();
    onClose?.();
  };

  const confirmVenuePayment = async () => {
    if (!pendingVenuePayment) {
      const pendingBooking = pendingVenueBookingRef.current;
      pendingVenueBookingRef.current = null;
      setVenueConfirmStatus(null);
      if (!pendingBooking?.immediatePaid) return;
      void handleBook(true, true);
      return;
    }
    const pending = pendingVenuePayment;
    for (const plan of pending.payments) {
      const paymentRes = await recordPersonalLessonPayment.mutateAsync({
        lessonId: plan.lessonId,
        clientId: pending.clientId,
        clientDisplay: pending.clientDisplay,
        amount: plan.amount,
        method: "cash",
        markPaid: true,
        idempotencyKey: getLessonPaymentIdempotencyKey(plan.lessonId),
        venueRuleAcknowledged: true,
        priceId: pending.tariff?.id ?? null,
        tariffUnits: plan.billing?.tariffUnits ?? null,
        tariffDurationMinutes: pending.tariff?.durationMinutes ?? null,
        tariffPrice: pending.tariff?.price ?? null,
        tariffLabel: pending.tariff ? getPriceLabel(pending.tariff, t) : null,
        lessonDurationMinutes: plan.billing?.lessonMinutes ?? null,
      });
      if (!paymentRes.success) {
        toast(resolveMutationError(paymentRes.error, "common.bookedPaymentFailed", t), "error");
        return;
      }
    }
    setPendingVenuePayment(null);
    setVenueConfirmStatus(null);
    const countLabel =
      pending.payments.length > 1
        ? t("personal.countSuffix", { count: pending.payments.length })
        : "";
    toast(t("personal.success.bookedPaid", { count: countLabel }), "success");
    onSuccess();
    onClose?.();
  };

  const subscriptionOwnerLabel = (sub: Subscription): string =>
    getSubscriptionClientIds(sub)
      .map((id) => {
        const c = clientMap[id];
        return c ? formatClientName(c.lastName, c.firstName) : id;
      })
      .join(" & ");

  if (isScheduleCell && !prefill) return null;

  const selectedLocationName =
    isScheduleCell && prefill
      ? prefill.locationName
      : accessibleLocations.find((l) => l.id === locationId)?.name ?? "";

  const renderDateSection = () => {
    if (isScheduleCell && prefill) {
      return (
        <div className="field-stack">
          <label className={labelCls}>{t("common.date")}</label>
          <div className="flex items-center gap-2 h-8 px-3 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700">
            <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
            {formatDate(prefill.date)}
          </div>
        </div>
      );
    }

    const updateEntry = (index: number, patch: Partial<LessonDateEntry>) => {
      setLessonEntries((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...patch };
        return next;
      });
    };

    return (
      <>
        {lessonEntries.map((entry, idx) => (
          <div key={idx} className={idx === 0 ? "field-stack" : "flex items-end gap-2"}>
            <div className={`grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 ${idx > 0 ? "flex-1 min-w-0" : ""}`}>
              <DatePickerField
                label={t("common.date")}
                value={entry.date}
                onChange={(val) => updateEntry(idx, { date: val })}
                min={todayISO}
                required
              />
              <TimeSelect
                label={t("common.timeStart")}
                value={entry.timeStart}
                onChange={(val) => updateEntry(idx, { timeStart: val })}
                required
              />
              <TimeSelect
                label={t("common.timeEnd")}
                value={entry.timeEnd}
                onChange={(val) => updateEntry(idx, { timeEnd: val })}
                required
              />
            </div>
            {idx > 0 && (
              <button
                type="button"
                onClick={() => setLessonEntries((prev) => prev.filter((_, i) => i !== idx))}
                aria-label={t("common.removeDate")}
                className="mb-0.5 p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => setLessonEntries((prev) => [...prev, defaultLessonEntry(todayISO)])}
          className={addRowBtnCls}
        >
          {t("common.addDate")}
        </button>
      </>
    );
  };

  const startDate =
    isScheduleCell && prefill
      ? prefill.date
      : lessonEntries
          .filter((e) => e.date)
          .map((e) => e.date)
          .sort()[0] ?? todayISO;

  const renderWeeklyRepeatSection = () => {
    return (
      <>
        <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={repeatWeekly}
            onChange={(e) => setRepeatWeekly(e.target.checked)}
            className={`${checkboxCls} mt-0.5`}
          />
          <span className="text-xs leading-snug font-semibold">{t("common.repeatWeekly")}</span>
        </label>

        {repeatWeekly && (
          <div className="field-stack space-y-3">
            <div className="field-stack">
              <label className={labelCls}>{t("common.endDate")}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWeeklyEndMode("weeks")}
                  className={`py-2 rounded-lg border font-sans text-[10px] font-semibold uppercase tracking-wider cursor-pointer ${
                    weeklyEndMode === "weeks"
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  {t("common.nWeeks")}
                </button>
                <button
                  type="button"
                  onClick={() => setWeeklyEndMode("date")}
                  className={`py-2 rounded-lg border font-sans text-[10px] font-semibold uppercase tracking-wider cursor-pointer ${
                    weeklyEndMode === "date"
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  {t("common.untilDate")}
                </button>
              </div>
            </div>
            {weeklyEndMode === "weeks" ? (
              <AppSelect
                label={t("common.weekCount")}
                value={String(weeklyWeekCount)}
                onChange={(e) => setWeeklyWeekCount(Number(e.target.value) || 2)}
              >
                {WEEK_COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}{" "}
                    {plural(n, [t("common.week.one"), t("common.week.few"), t("common.week.many")])}
                  </option>
                ))}
              </AppSelect>
            ) : (
              <DatePickerField
                label={t("common.endDateLabel")}
                value={weeklyEndDate}
                onChange={setWeeklyEndDate}
                min={startDate || todayISO}
                required
              />
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <>
      <div className="panel-form-stack">
        {can("personal_lessons.sell") && (
          <button
            type="button"
            onClick={() => setPackageModalOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-sans font-semibold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <Ticket className="w-3.5 h-3.5" />
            {t("personal.sell.packageLink")}
          </button>
        )}

        {isScheduleCell && showLocationInForm ? (
          <div className="field-stack">
            <label className={labelCls}>{t("schedule.form.location")}</label>
            <div className="flex items-center gap-2 h-8 px-3 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
              {selectedLocationName}
            </div>
          </div>
        ) : !isScheduleCell ? (
          <div className={`grid grid-cols-1 gap-3 ${showLocationInForm ? "sm:grid-cols-2" : ""}`}>
            <LocationSelect
              locations={accessibleLocations}
              value={locationId}
              onChange={setLocationId}
              required
            />
            <DisciplineSelect
              disciplines={disciplines}
              value={disciplineId}
              onChange={setDisciplineId}
              toast={toast}
            />
          </div>
        ) : null}

        {renderDateSection()}

        {renderWeeklyRepeatSection()}

        {!isTeacher && (
          <AppSelect
            label={t("schedule.form.teacher")}
            value={teacherMemberId}
            onChange={(e) => setTeacherMemberId(e.target.value)}
            required
          >
            {teacherOptions.length === 0 ? (
              <option value="">{t("common.noTeachers")}</option>
            ) : (
              teacherOptions.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberDisplayName(member) ?? memberListLabel(member)}
                </option>
              ))
            )}
          </AppSelect>
        )}

        {isScheduleCell && (
          <DisciplineSelect
            disciplines={disciplines}
            value={disciplineId}
            onChange={setDisciplineId}
            toast={toast}
          />
        )}

        {isScheduleCell && (
          <div className="grid grid-cols-2 gap-3">
            <TimeSelect label={t("common.timeStart")} value={timeStart} onChange={handleTimeStartChange} required />
            <TimeSelect label={t("common.timeEnd")} value={timeEnd} onChange={setTimeEnd} required />
          </div>
        )}

        <div className="field-stack">
          {bookingClients.map((client, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                {packageLocked ? (
                  <div className="field-stack">
                    <label className={labelCls}>
                      {idx === 0 ? t("common.client") : t("common.clientN", { n: idx + 1 })}
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={client.query}
                      className={`${fieldCls} bg-slate-100 text-slate-600 cursor-not-allowed`}
                    />
                  </div>
                ) : (
                  <ClientAutocomplete
                    label={idx === 0 ? t("common.client") : t("common.clientN", { n: idx + 1 })}
                    clients={activeClients}
                    query={client.query}
                    selectedId={client.id}
                    showAddClientButton
                    addClientLinkLabel={t("common.newClient")}
                    toast={toast}
                    onQueryChange={(q) => {
                      if (packageLocked) return;
                      setBookingClients((prev) => {
                        const next = [...prev];
                        next[idx] = { query: q, id: "" };
                        return next;
                      });
                    }}
                    onSelect={(c: Client) => {
                      if (packageLocked) return;
                      setBookingClients((prev) => {
                        const next = [...prev];
                        next[idx] = { query: `${c.lastName} ${c.firstName}`, id: c.id };
                        return next;
                      });
                    }}
                  />
                )}
              </div>
              {!packageLocked && idx > 0 && (
                <button
                  type="button"
                  onClick={() => setBookingClients((prev) => prev.filter((_, i) => i !== idx))}
                  className="mt-6 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer shrink-0"
                  title={t("common.removeClient")}
                  aria-label={t("common.removeClient")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {!packageLocked && bookingClients.length < MAX_CLIENTS && (
            <button
              type="button"
              onClick={() => setBookingClients((prev) => [...prev, { query: "", id: "" }])}
              className={addRowBtnCls}
            >
              {t("common.addClient")}
            </button>
          )}
        </div>

        <GoogleCalendarFreebusyWarning
          visible={hasGoogleFreebusyOverlap}
          checking={isCheckingGoogleFreebusy}
        />

        {showPayerSelect && bookingPaymentMode === "single" && (
          <>
            <AppSelect
              label={t("personalTariff.billing.label")}
              value={billingSplitMode}
              onChange={(e) =>
                setBillingSplitMode(e.target.value === "equal" ? "equal" : "single_payer")
              }
            >
              <option value="single_payer">{t("personalTariff.billing.singlePayer")}</option>
              <option value="equal">{t("personalTariff.billing.equalSplit")}</option>
            </AppSelect>
            <AppSelect
              label={
                billingSplitMode === "equal"
                  ? t("personalTariff.billing.firstPayer")
                  : t("personalTariff.payer.label")
              }
              value={payerClientId}
              onChange={(e) => setPayerClientId(e.target.value)}
              required
            >
              {bookingClients
                .filter((client) => client.id)
                .map((client, idx) => (
                  <option key={client.id} value={client.id}>
                    {client.query || t("common.clientN", { n: idx + 1 })}
                  </option>
                ))}
            </AppSelect>
          </>
        )}

        <div className="field-stack">
          <label className={labelCls}>{t("common.paymentMethod")}</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setBookingPaymentMode("single");
                setLinkedSubscriptionId("");
                if (lessonTariffs.length > 0) {
                  const tariffId = selectedLessonTariffId || lessonTariffs[0].id!;
                  applyLessonTariff(tariffId);
                }
              }}
              className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                bookingPaymentMode === "single"
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                  : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
              }`}
            >
              {t("common.singleLessonOption")}
            </button>
            <button
              type="button"
              onClick={() => {
                setBookingPaymentMode("package");
                setLinkedSubscriptionId("");
              }}
              className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider leading-snug transition-colors cursor-pointer ${
                bookingPaymentMode === "package"
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                  : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
              }`}
            >
              {t("common.chargePackage")}
            </button>
          </div>
        </div>

        {bookingPaymentMode === "single" && (
          <>
            {durationWarningMessage && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2 leading-relaxed">
                {durationWarningMessage}
              </p>
            )}
            {lessonTariffs.length > 0 && (
              <div className="flex flex-nowrap items-end gap-3 w-full">
                <div className="min-w-0 flex-1">
                  <AppSelect
                    label={t("common.tariffPerLesson")}
                    value={selectedLessonTariffId}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) applyLessonTariff(id);
                    }}
                  >
                    {lessonTariffs.map((tariff) => (
                      <option key={tariff.id} value={tariff.id!}>
                        {getPrivateTariffOptionLabel(tariff, t)}
                      </option>
                    ))}
                  </AppSelect>
                </div>
                <div className="field-stack w-[7.5rem] shrink-0">
                  <label className={labelCls}>{t("common.lessonCost")}</label>
                  <div
                    className={`${fieldCls} font-semibold bg-slate-50 text-slate-800 cursor-default`}
                    aria-readonly
                  >
                    {primaryBilling != null
                      ? formatCurrency(primaryBilling.billed)
                      : "—"}
                  </div>
                </div>
              </div>
            )}
            {lessonTariffs.length === 0 && (
              <div className="field-stack">
                <label className={labelCls}>{t("common.lessonCost")}</label>
                <input
                  type="number"
                  placeholder="0"
                  value={manualLessonPrice}
                  onChange={(e) => setManualLessonPrice(e.target.value)}
                  className={`${fieldCls} font-semibold`}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleBook(true)}
                disabled={connectionState !== "online" || addPersonalLessons.isPending}
                title={translateConnectionBlockReason(connectionState, t)}
                className={btnAddCls}
              >
                {t("common.withPayment")}
              </button>
              <button
                type="button"
                onClick={() => handleBook(false)}
                disabled={connectionState !== "online" || addPersonalLessons.isPending}
                title={translateConnectionBlockReason(connectionState, t)}
                className={btnCancelCls}
              >
                {t("common.withoutPayment")}
              </button>
            </div>
          </>
        )}

        {bookingPaymentMode === "package" && (
          <>
            {availablePrivateSubs.length === 0 ? (
              <p className="text-xs text-slate-500 font-sans leading-relaxed">
                {t("common.noPackages")}{" "}
                <button
                  type="button"
                  onClick={() => setPackageModalOpen(true)}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold underline-offset-2 hover:underline cursor-pointer"
                >
                  {t("common.packageSale")}
                </button>
                .
              </p>
            ) : (
              <AppSelect
                label={t("common.package")}
                value={linkedSubscriptionId}
                onChange={(e) => {
                  const subId = e.target.value;
                  setLinkedSubscriptionId(subId);
                  if (subId) applySubscriptionToBooking(subId);
                }}
              >
                <option value="">{t("common.selectPackage")}</option>
                {availablePrivateSubs.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {subscriptionOwnerLabel(sub)} — {t("common.remaining")} {sub.lessonsLeft}
                  </option>
                ))}
              </AppSelect>
            )}
            <button
              type="button"
              onClick={() => handleBook(false)}
              disabled={
                connectionState !== "online" ||
                addPersonalLessons.isPending ||
                availablePrivateSubs.length === 0 ||
                !linkedSubscriptionId
              }
              title={translateConnectionBlockReason(connectionState, t)}
              className={`w-full ${btnAddCls}`}
            >
              {t("common.book")}
            </button>
          </>
        )}
      </div>

      <SellPackageModal
        open={packageModalOpen}
        onClose={() => setPackageModalOpen(false)}
        toast={toast}
        clients={activeClients}
        disciplines={disciplines}
        prices={prices}
        stackLayer={isScheduleCell ? "above" : undefined}
      />
      <VenueRulePaymentConfirmDialog
        status={venueConfirmStatus}
        pending={addPersonalLessons.isPending || recordPersonalLessonPayment.isPending}
        onConfirm={() => {
          void confirmVenuePayment();
        }}
        onCancel={() => {
          setVenueConfirmStatus(null);
          setPendingVenuePayment(null);
          pendingVenueBookingRef.current = null;
        }}
      />
    </>
  );
}
