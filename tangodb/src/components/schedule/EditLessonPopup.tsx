import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Info, MapPin, RotateCcw, Trash2, X } from "lucide-react";
import {
  useAddGroupSchedule,
  useDeleteScheduleSlot,
  useEditGroupSchedule,
  useUpdateGroupScheduleMetadata,
  useUpdateGroupScheduleValidity,
} from "../../hooks/useSchedule";
import { useUpdatePersonalLesson } from "../../hooks/usePersonalLessons";
import { useClients, useClientDirectory } from "../../hooks/useClients";
import { usePrices } from "../../hooks/usePrices";
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
import { useUpdateClassMaxCapacity } from "../../hooks/useGroupWaitlist";
import { useScheduleGroups } from "../../hooks/useScheduleGroups";
import { parseMaxCapacityInput } from "../../lib/groupCapacity";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { pickGroupSlotsForEdit } from "../../lib/scheduleSlotEdit";
import {
  computeSlotValidTo,
  inferGroupRepeatConfig,
  type GroupRepeatConfig,
} from "../../lib/groupLessonRepeat";
import { computeAutoTimeEnd, validateTimeRange } from "../../lib/scheduleTime";
import { durationWarning, lessonDurationMinutes, translateDurationWarning } from "../../lib/personalTariffPricing";
import { addDays, getWeekRange, isScheduleDateLockedForWrite, nextOccurrenceOnOrAfter, toISODateLocal } from "../../lib/scheduleWeek";
import { canReadLessonClients, canShowPaidStatus, maskClientDisplay } from "../../lib/scheduleLessonAccess";
import { useVoidPersonalLessonPayment } from "../../hooks/usePayments";
import { dowFullEntries, jsDayToIsoDow, timesOverlap } from "../../lib/utils";
import { useI18n } from "../../hooks/useI18n";
import type { I18nKey } from "../../lib/i18n/keys";
import type { Client, Discipline, DisplayLesson, GroupDisplayLesson, PersonalDisplayLesson, ScheduleSlot } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { btnAddCls, btnCancelCls, btnOpenCls } from "../ui/buttonStyles";
import ClientAutocomplete from "../ui/ClientAutocomplete";
import DisciplineSelect from "../ui/DisciplineSelect";
import LocationSelect from "../ui/LocationSelect";
import RequirePermission from "../RequirePermission";
import TimeSelect from "../ui/TimeSelect";
import GroupLessonRepeatFields from "./GroupLessonRepeatFields";
import GoogleCalendarSyncStatusBadge from "../integrations/GoogleCalendarSyncStatusBadge";
import GoogleCalendarFreebusyWarning from "../integrations/GoogleCalendarFreebusyWarning";
import { useGoogleCalendarSyncStatus } from "../../hooks/useGoogleCalendarSyncStatus";
import { useGoogleCalendarFreebusy } from "../../hooks/useGoogleCalendarFreebusy";

interface EditLessonPopupProps {
  lesson: GroupDisplayLesson | PersonalDisplayLesson | null;
  locationName?: string;
  locations?: Array<{ id: string; name: string }>;
  /** List view: time, location, discipline, teacher only (no date change). */
  personalListEdit?: boolean;
  disciplines: Discipline[];
  teacherOptions: TeamMemberRow[];
  scheduleSlots: ScheduleSlot[];
  personalLessons: Array<{
    id: string;
    date: string;
    timeStart: string;
    timeEnd: string;
    locationId?: string | null;
  }>;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const readOnlyCls =
  "flex items-center gap-2 h-8 px-3 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700";

const addDayBtnCls =
  "w-full py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer";

const addClientRowBtnCls =
  "w-full py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer";

const MAX_PERSONAL_CLIENTS = 4;

interface BookingClientField {
  query: string;
  id: string;
}

function participantTypeFromCount(count: number): "solo" | "pair" | "trio" | "quad" {
  if (count >= 4) return "quad";
  if (count >= 3) return "trio";
  if (count === 2) return "pair";
  return "solo";
}

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

function clientIdsFromLesson(lesson: PersonalDisplayLesson): string[] {
  return [lesson.clientId1, lesson.clientId2, lesson.clientId3, lesson.clientId4].filter(
    (id): id is string => Boolean(id)
  );
}

function bookingClientsFromLesson(
  lesson: PersonalDisplayLesson,
  directoryClients: Client[]
): BookingClientField[] {
  const ids = clientIdsFromLesson(lesson);
  if (ids.length === 0) {
    return [{ query: lesson.clientDisplay ?? "", id: "" }];
  }
  return ids.map((id) => {
    const client = directoryClients.find((item) => item.id === id);
    return {
      id,
      query: client ? `${client.lastName} ${client.firstName}` : lesson.clientDisplay ?? "",
    };
  });
}

interface GroupSlotRow {
  key: string;
  id?: string;
  dayOfWeek: number;
  timeStart: string;
  timeEnd: string;
}

function dateForDayOfWeekInWeek(baseDate: string, dayOfWeek: number): string {
  const { weekStart } = getWeekRange(new Date(`${baseDate}T12:00:00`));
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(toISODateLocal(weekStart), offset);
    const dow = jsDayToIsoDow(new Date(`${date}T12:00:00`).getDay());
    if (dow === dayOfWeek) return date;
  }
  return baseDate;
}

function makeGroupSlotRow(dayOfWeek = 1, timeStart = "19:00", timeEnd = "20:00"): GroupSlotRow {
  return { key: crypto.randomUUID(), dayOfWeek, timeStart, timeEnd };
}

function resolveTeacherMemberId(
  lessonTeacherId: string | null | undefined,
  teacherOptions: TeamMemberRow[],
  selfMemberId?: string | null
): string {
  if (lessonTeacherId) return lessonTeacherId;
  if (selfMemberId && teacherOptions.some((member) => member.id === selfMemberId)) {
    return selfMemberId;
  }
  return teacherOptions[0]?.id ?? "";
}

function findInternalSlotConflict(
  rows: GroupSlotRow[],
  rowKey: string,
  formDuplicateLabel: string
): string | null {
  const row = rows.find((item) => item.key === rowKey);
  if (!row) return null;

  for (const other of rows) {
    if (other.key === rowKey) continue;
    if (other.dayOfWeek !== row.dayOfWeek) continue;
    if (timesOverlap(row.timeStart, row.timeEnd, other.timeStart, other.timeEnd)) {
      return formDuplicateLabel;
    }
  }

  return null;
}

export default function EditLessonPopup({
  lesson,
  locationName,
  locations,
  personalListEdit = false,
  disciplines,
  teacherOptions,
  scheduleSlots,
  personalLessons,
  toast,
  onClose,
  onSuccess,
}: EditLessonPopupProps) {
  const { t, locale, formatDate } = useI18n();
  const { memberId, settings } = useOrganization();
  const orgModules = normalizeOrgModules(settings?.modules);
  const showLocationInForm = shouldShowLocationPicker(orgModules, locations?.length ?? 0);
  const { role, can, canEditPastSchedule } = usePermissions();
  const { connectionState } = useOnlineStatus();
  const editGroupSchedule = useEditGroupSchedule();
  const updateGroupScheduleMetadata = useUpdateGroupScheduleMetadata();
  const updateGroupScheduleValidity = useUpdateGroupScheduleValidity();
  const addGroupSchedule = useAddGroupSchedule();
  const deleteScheduleSlot = useDeleteScheduleSlot();
  const updatePersonalLesson = useUpdatePersonalLesson();
  const voidPersonalLessonPayment = useVoidPersonalLessonPayment();
  const updateClassMaxCapacity = useUpdateClassMaxCapacity();
  const { data: activeClients = [] } = useClients();
  const { data: directoryClients = [] } = useClientDirectory();
  const { data: scheduleGroups = [] } = useScheduleGroups();
  const googleSyncStatus = useGoogleCalendarSyncStatus(
    lesson?.kind === "personal" ? lesson.lessonId : null,
    { enabled: lesson?.kind === "personal" }
  );

  const isTeacher = role === "teacher";
  const todayISO = toISODateLocal(new Date());

  const [groupName, setGroupName] = useState("");
  const [disciplineId, setDisciplineId] = useState("");
  const [teacherMemberId, setTeacherMemberId] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [timeStart, setTimeStart] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("20:00");
  const [personalDate, setPersonalDate] = useState("");
  const [locationId, setLocationId] = useState("");
  const [bookingClients, setBookingClients] = useState<BookingClientField[]>([{ query: "", id: "" }]);
  const [payerClientId, setPayerClientId] = useState("");
  const [groupSlotRows, setGroupSlotRows] = useState<GroupSlotRow[]>([]);
  const [originalGroupSlots, setOriginalGroupSlots] = useState<GroupSlotRow[]>([]);
  const [repeatConfig, setRepeatConfig] = useState<GroupRepeatConfig>(() =>
    inferGroupRepeatConfig(toISODateLocal(new Date()), toISODateLocal(new Date()))
  );
  const [originalRepeatConfig, setOriginalRepeatConfig] = useState<GroupRepeatConfig>(() =>
    inferGroupRepeatConfig(toISODateLocal(new Date()), toISODateLocal(new Date()))
  );

  const editLessonKey = useMemo(() => {
    if (!lesson) return null;
    return lesson.kind === "group"
      ? `group:${lesson.slotId}:${lesson.date}`
      : `personal:${lesson.lessonId}:${lesson.date}`;
  }, [lesson]);

  const initializedLessonKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lesson || !editLessonKey) {
      initializedLessonKeyRef.current = null;
      return;
    }
    if (initializedLessonKeyRef.current === editLessonKey) return;
    initializedLessonKeyRef.current = editLessonKey;

    const initialTeacherMemberId = resolveTeacherMemberId(
      lesson.teacherMemberId,
      teacherOptions,
      isTeacher ? memberId : null
    );

    if (lesson.kind === "group") {
      setGroupName(lesson.groupName?.trim() ?? "");
      setDisciplineId(lesson.disciplineId ?? "");
      setTeacherMemberId(initialTeacherMemberId);
      setTimeStart(lesson.timeStart);
      setTimeEnd(lesson.timeEnd);

      const rows = pickGroupSlotsForEdit(lesson, scheduleSlots, todayISO);

      setGroupSlotRows(rows);
      setOriginalGroupSlots(rows.map((row) => ({ ...row })));

      const primarySlot = scheduleSlots.find((slot) => slot.id === lesson.slotId);
      const validFrom = primarySlot?.validFrom ?? lesson.date;
      const validTo = primarySlot?.validTo ?? lesson.validTo ?? lesson.date;
      const inferred = inferGroupRepeatConfig(validFrom, validTo);
      setRepeatConfig(inferred);
      setOriginalRepeatConfig(inferred);
    } else {
      setPersonalDate(lesson.date);
      setLocationId(lesson.locationId ?? "");
      setDisciplineId(lesson.disciplineId ?? "");
      setTeacherMemberId(initialTeacherMemberId);
      setTimeStart(lesson.timeStart);
      setTimeEnd(lesson.timeEnd);
      setBookingClients(bookingClientsFromLesson(lesson, directoryClients));
      const initialPayer =
        lesson.payerClientId ??
        lesson.clientId1 ??
        clientIdsFromLesson(lesson)[0] ??
        "";
      setPayerClientId(initialPayer);
    }
  }, [editLessonKey, lesson, scheduleSlots, teacherOptions, memberId, isTeacher, todayISO, directoryClients]);

  useEffect(() => {
    if (!lesson || lesson.kind !== "personal") return;
    setBookingClients((prev) =>
      prev.map((client) => {
        if (!client.id || client.query) return client;
        const directoryClient = directoryClients.find((item) => item.id === client.id);
        return directoryClient
          ? { ...client, query: `${directoryClient.lastName} ${directoryClient.firstName}` }
          : client;
      })
    );
  }, [lesson, directoryClients]);

  useEffect(() => {
    if (!lesson) return;
    setTeacherMemberId((current) => {
      if (current) return current;
      return resolveTeacherMemberId(lesson.teacherMemberId, teacherOptions, isTeacher ? memberId : null);
    });
  }, [lesson, teacherOptions, memberId, isTeacher]);

  useEffect(() => {
    if (!lesson || lesson.kind !== "group") return;
    const canonical = lesson.scheduleGroupId
      ? scheduleGroups.find((group) => group.id === lesson.scheduleGroupId)
      : undefined;
    setMaxCapacity(canonical?.maxCapacity != null ? String(canonical.maxCapacity) : "");
  }, [editLessonKey, lesson, scheduleGroups]);

  const updateGroupSlotRow = (key: string, patch: Partial<GroupSlotRow>) => {
    setGroupSlotRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const handleGroupSlotTimeStartChange = (key: string, next: string) => {
    setGroupSlotRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        return { ...row, timeStart: next, timeEnd: computeAutoTimeEnd(next, []) };
      })
    );
  };

  const handleAddGroupDay = () => {
    setGroupSlotRows((prev) => [...prev, makeGroupSlotRow()]);
  };

  const handleRemoveGroupDay = (key: string) => {
    setGroupSlotRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.key !== key)));
  };

  const groupSlotConflicts = useMemo(() => {
    if (!lesson || lesson.kind !== "group") return new Map<string, string>();

    const conflicts = new Map<string, string>();
    const formDuplicateLabel = t("utils.conflict.formDuplicate");
    for (const row of groupSlotRows) {
      const internal = findInternalSlotConflict(groupSlotRows, row.key, formDuplicateLabel);
      if (internal) {
        conflicts.set(row.key, internal);
        continue;
      }

      const rangeError = validateTimeRange(row.timeStart, row.timeEnd);
      if (rangeError) {
        conflicts.set(
          row.key,
          rangeError.includes("позже") || rangeError.includes("later")
            ? t("schedule.error.endBeforeStart")
            : t("utils.conflict.invalidTime")
        );
        continue;
      }

      const conflictDate = dateForDayOfWeekInWeek(todayISO, row.dayOfWeek);
      const external = findScheduleConflict(
        {
          date: conflictDate,
          timeStart: row.timeStart,
          timeEnd: row.timeEnd,
          locationId: lesson.locationId,
          excludeSlotId: row.id,
        },
        personalLessons,
        scheduleSlots,
        t,
        locale
      );
      if (external) {
        conflicts.set(row.key, `${external.conflictTime}: ${external.message}`);
      }
    }

    return conflicts;
  }, [lesson, groupSlotRows, personalLessons, scheduleSlots, t, locale, todayISO]);

  const hasGroupSlotConflicts = groupSlotConflicts.size > 0;

  useEffect(() => {
    if (!lesson) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lesson, onClose]);

  const permissionContext = useMemo(
    () =>
      lesson
        ? { disciplineId: lesson.disciplineId, locationId: lesson.locationId }
        : undefined,
    [lesson]
  );

  const canReadClients = lesson ? canReadLessonClients(role, lesson, can) : false;

  const maskedClientLabel =
    lesson?.kind === "personal"
      ? maskClientDisplay(lesson.clientDisplay, canReadClients)
      : "";

  const sameDayLessons = useMemo(() => {
    if (!lesson) return [];
    const targetDate = lesson.kind === "personal" ? personalDate : lesson.date;
    const locationId = lesson.locationId;
    const dayOfWeek =
      lesson.kind === "group"
        ? lesson.dayOfWeek
        : jsDayToIsoDow(new Date(`${personalDate}T12:00:00`).getDay());

    const groupIntervals = scheduleSlots
      .filter((s) => {
        if (s.locationId !== locationId) return false;
        if (s.dayOfWeek !== dayOfWeek) return false;
        if (lesson.kind === "group" && s.id === lesson.slotId) return false;
        return true;
      })
      .map((s) => ({ timeStart: s.time, timeEnd: s.timeEnd }));

    const personalIntervals = personalLessons
      .filter((l) => l.date === targetDate && l.locationId === locationId)
      .filter((l) => lesson.kind !== "personal" || l.id !== lesson.lessonId)
      .map((l) => ({ timeStart: l.timeStart, timeEnd: l.timeEnd }));

    return [...groupIntervals, ...personalIntervals];
  }, [lesson, personalDate, scheduleSlots, personalLessons]);

  const freebusySlots = useMemo(() => {
    if (!lesson) return [];
    if (lesson.kind === "personal") {
      const date = personalDate || lesson.date;
      return [{ date, timeStart, timeEnd }];
    }
    return groupSlotRows.map((row) => ({
      date: dateForDayOfWeekInWeek(lesson.date, row.dayOfWeek),
      timeStart: row.timeStart,
      timeEnd: row.timeEnd,
    }));
  }, [lesson, personalDate, timeStart, timeEnd, groupSlotRows]);

  const resolvedTeacherForFreebusy =
    teacherMemberId || lesson?.teacherMemberId || "";

  const { hasOverlap: hasGoogleFreebusyOverlap, isChecking: isCheckingGoogleFreebusy } =
    useGoogleCalendarFreebusy({
      teacherMemberId: resolvedTeacherForFreebusy,
      slots: freebusySlots,
      enabled:
        Boolean(lesson) &&
        !isScheduleDateLockedForWrite(lesson?.date ?? todayISO, canEditPastSchedule),
    });

  const handleTimeStartChange = (next: string) => {
    setTimeStart(next);
    setTimeEnd(computeAutoTimeEnd(next, sameDayLessons));
  };

  const personalLessonContext =
    lesson?.kind === "personal"
      ? {
          priceId: lesson.priceId ?? null,
          subscriptionId: lesson.subscriptionId ?? null,
          paidAmount: lesson.paidAmount ?? 0,
          initialTimeStart: lesson.timeStart,
          initialTimeEnd: lesson.timeEnd,
        }
      : null;

  const selectedClientIds = useMemo(
    () => bookingClients.map((client) => client.id).filter(Boolean),
    [bookingClients]
  );

  const { data: prices = [] } = usePrices();

  const personalTariff = useMemo(() => {
    if (!personalLessonContext?.priceId) return null;
    return prices.find((price) => price.id === personalLessonContext.priceId) ?? null;
  }, [personalLessonContext?.priceId, prices]);

  const personalLessonMinutes = useMemo(() => {
    if (lesson?.kind !== "personal") return 0;
    return lessonDurationMinutes(timeStart, timeEnd);
  }, [lesson, timeStart, timeEnd]);

  const personalHasPayments = (personalLessonContext?.paidAmount ?? 0) > 0;

  const personalSlotChanged =
    lesson?.kind === "personal" &&
    (timeStart !== lesson.timeStart || timeEnd !== lesson.timeEnd);

  const personalDurationWarnMessage = useMemo(() => {
    if (lesson?.kind !== "personal") return null;
    if (personalLessonContext?.subscriptionId) return null;
    if (!personalLessonContext?.priceId || personalHasPayments) return null;
    if (!personalTariff) return null;
    const code = durationWarning(
      personalLessonMinutes,
      personalTariff.durationMinutes ?? null
    );
    if (!code) return null;
    return translateDurationWarning(
      code,
      t,
      personalTariff.durationMinutes ?? null,
      personalLessonMinutes
    );
  }, [
    lesson,
    personalLessonContext,
    personalHasPayments,
    personalTariff,
    personalLessonMinutes,
    t,
  ]);

  useEffect(() => {
    if (lesson?.kind !== "personal") return;
    if (selectedClientIds.length < 2) {
      if (selectedClientIds[0]) setPayerClientId(selectedClientIds[0]);
      return;
    }
    if (payerClientId && selectedClientIds.includes(payerClientId)) return;
    setPayerClientId("");
  }, [lesson, selectedClientIds, payerClientId]);

  const handleSaveGroup = async () => {
    if (!lesson || lesson.kind !== "group") return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (isScheduleDateLockedForWrite(lesson.date, canEditPastSchedule)) {
      toast(t("schedule.error.pastEdit"), "error");
      return;
    }
    if (hasGroupSlotConflicts) {
      toast(t("schedule.error.fixConflicts"), "error");
      return;
    }

    const trimmedGroup = groupName.trim();
    if (!trimmedGroup) {
      toast(t("schedule.error.groupName"), "error");
      return;
    }
    if (!disciplineId) {
      toast(t("schedule.error.discipline"), "error");
      return;
    }
    const resolvedTeacherMemberId = resolveTeacherMemberId(
      teacherMemberId || lesson.teacherMemberId,
      teacherOptions,
      isTeacher ? memberId : null
    );
    if (!resolvedTeacherMemberId) {
      toast(t("schedule.error.teacher"), "error");
      return;
    }

    if (repeatConfig.repeatWeekly && repeatConfig.endMode === "weeks" && repeatConfig.weekCount < 1) {
      toast(t("personal.error.weekCount"), "error");
      return;
    }

    const capacityParsed = parseMaxCapacityInput(maxCapacity);
    if (!capacityParsed.ok) {
      toast(t("groupCapacity.error.invalidCapacity"), "error");
      return;
    }

    const originalCapacity =
      lesson.scheduleGroupId != null
        ? (scheduleGroups.find((group) => group.id === lesson.scheduleGroupId)?.maxCapacity ?? null)
        : null;
    const capacityChanged = capacityParsed.value !== originalCapacity;

    const persistGroupMaxCapacity = async (): Promise<boolean> => {
      if (!lesson.scheduleGroupId || !capacityChanged) return true;
      const res = await updateClassMaxCapacity.mutateAsync({
        classId: lesson.scheduleGroupId,
        maxCapacity: capacityParsed.value,
      });
      if (!res.success) {
        toast(resolveMutationError(res.error, "groupCapacity.error.updateFailed", t), "error");
        return false;
      }
      return true;
    };

    const repeatChanged =
      repeatConfig.repeatWeekly !== originalRepeatConfig.repeatWeekly ||
      repeatConfig.endMode !== originalRepeatConfig.endMode ||
      repeatConfig.weekCount !== originalRepeatConfig.weekCount ||
      repeatConfig.endDate !== originalRepeatConfig.endDate;

    const metadataChanged =
      trimmedGroup !== (lesson.groupName?.trim() ?? "") ||
      disciplineId !== (lesson.disciplineId ?? "") ||
      resolvedTeacherMemberId !== (lesson.teacherMemberId ?? "");

    const currentIds = new Set(groupSlotRows.map((row) => row.id).filter(Boolean));
    const removedSlots = originalGroupSlots.filter((row) => row.id && !currentIds.has(row.id));
    const newRows = groupSlotRows.filter((row) => !row.id);

    const anySlotStructureChanged =
      newRows.length > 0 ||
      removedSlots.length > 0 ||
      groupSlotRows.some((row) => {
        if (!row.id) return true;
        const original = originalGroupSlots.find((item) => item.id === row.id);
        return (
          !original ||
          original.dayOfWeek !== row.dayOfWeek ||
          original.timeStart !== row.timeStart ||
          original.timeEnd !== row.timeEnd
        );
      });

    if (!metadataChanged && !anySlotStructureChanged && !repeatChanged) {
      if (!capacityChanged) {
        onClose();
        return;
      }
      if (!(await persistGroupMaxCapacity())) return;
      toast(t("schedule.success.groupUpdated"), "success");
      onSuccess();
      onClose();
      return;
    }

    if (metadataChanged && !anySlotStructureChanged && !repeatChanged) {
      const slotIds = groupSlotRows.map((row) => row.id).filter((id): id is string => Boolean(id));
      const res = await updateGroupScheduleMetadata.mutateAsync({
        slotIds,
        groupName: trimmedGroup,
        disciplineId,
        teacherMemberId: resolvedTeacherMemberId,
      });

      if (!res.success) {
        toast(res.error ?? t("schedule.error.updateFailed"), "error");
        return;
      }

      if (!(await persistGroupMaxCapacity())) return;

      toast(t("schedule.success.groupUpdated"), "success");
      onSuccess();
      onClose();
      return;
    }

    if (!anySlotStructureChanged && repeatChanged && !metadataChanged) {
      const slotIds = groupSlotRows.map((row) => row.id).filter((id): id is string => Boolean(id));
      const updates = slotIds.map((slotId) => {
        const slot = scheduleSlots.find((item) => item.id === slotId);
        const validFrom = slot?.validFrom ?? lesson.date;
        return {
          slotId,
          validTo: computeSlotValidTo(validFrom, repeatConfig),
        };
      });

      for (const update of updates) {
        const res = await updateGroupScheduleValidity.mutateAsync({
          slotIds: [update.slotId],
          validTo: update.validTo,
        });
        if (!res.success) {
          toast(res.error ?? t("schedule.error.updateFailed"), "error");
          return;
        }
      }

      if (!(await persistGroupMaxCapacity())) return;

      toast(t("schedule.success.groupUpdated"), "success");
      onSuccess();
      onClose();
      return;
    }

    if (metadataChanged && !anySlotStructureChanged && repeatChanged) {
      const slotIds = groupSlotRows.map((row) => row.id).filter((id): id is string => Boolean(id));
      const metaRes = await updateGroupScheduleMetadata.mutateAsync({
        slotIds,
        groupName: trimmedGroup,
        disciplineId,
        teacherMemberId: resolvedTeacherMemberId,
      });
      if (!metaRes.success) {
        toast(metaRes.error ?? t("schedule.error.updateFailed"), "error");
        return;
      }

      for (const slotId of slotIds) {
        const slot = scheduleSlots.find((item) => item.id === slotId);
        const validFrom = slot?.validFrom ?? lesson.date;
        const res = await updateGroupScheduleValidity.mutateAsync({
          slotIds: [slotId],
          validTo: computeSlotValidTo(validFrom, repeatConfig),
        });
        if (!res.success) {
          toast(res.error ?? t("schedule.error.updateFailed"), "error");
          return;
        }
      }

      if (!(await persistGroupMaxCapacity())) return;

      toast(t("schedule.success.groupUpdated"), "success");
      onSuccess();
      onClose();
      return;
    }

    for (const row of groupSlotRows) {
      if (!row.id) continue;
      const original = originalGroupSlots.find((item) => item.id === row.id);
      const slotChanged =
        !original ||
        original.dayOfWeek !== row.dayOfWeek ||
        original.timeStart !== row.timeStart ||
        original.timeEnd !== row.timeEnd;

      if (!slotChanged && !metadataChanged) continue;

      const res = await editGroupSchedule.mutateAsync({
        slotId: row.id,
        editDate: todayISO,
        dayOfWeek: row.dayOfWeek,
        time: row.timeStart,
        timeEnd: row.timeEnd,
        groupName: trimmedGroup,
        disciplineId,
        locationId: lesson.locationId,
        teacherMemberId: resolvedTeacherMemberId,
      });

      if (!res.success) {
        toast(res.error ?? t("schedule.error.updateFailed"), "error");
        return;
      }
    }

    for (const row of removedSlots) {
      if (!row.id) continue;
      const res = await deleteScheduleSlot.mutateAsync({ id: row.id, editDate: todayISO });
      if (!res.success) {
        toast(res.error ?? t("schedule.error.deleteScheduleFailed"), "error");
        return;
      }
    }

    if (newRows.length > 0) {
      const res = await addGroupSchedule.mutateAsync({
        groupName: trimmedGroup,
        disciplineId,
        locationId: lesson.locationId,
        teacherMemberId: resolvedTeacherMemberId,
        days: newRows.map((row) => {
          const validFrom = nextOccurrenceOnOrAfter(lesson.date, row.dayOfWeek);
          return {
            dayOfWeek: row.dayOfWeek,
            time: row.timeStart,
            timeEnd: row.timeEnd,
            validFrom,
            validTo: computeSlotValidTo(validFrom, repeatConfig),
          };
        }),
      });

      if (!res.success) {
        toast(res.error ?? t("schedule.error.addScheduleFailed"), "error");
        return;
      }
    }

    if (repeatChanged) {
      const slotIds = groupSlotRows.map((row) => row.id).filter((id): id is string => Boolean(id));
      for (const slotId of slotIds) {
        const slot = scheduleSlots.find((item) => item.id === slotId);
        const validFrom = slot?.validFrom ?? lesson.date;
        const res = await updateGroupScheduleValidity.mutateAsync({
          slotIds: [slotId],
          validTo: computeSlotValidTo(validFrom, repeatConfig),
        });
        if (!res.success) {
          toast(res.error ?? t("schedule.error.updateFailed"), "error");
          return;
        }
      }
    }

    if (!(await persistGroupMaxCapacity())) return;

    toast(t("schedule.success.groupUpdated"), "success");
    onSuccess();
    onClose();
  };

  const handleSavePersonal = async () => {
    if (!lesson || lesson.kind !== "personal") return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (isScheduleDateLockedForWrite(lesson.date, canEditPastSchedule)) {
      toast(t("schedule.error.pastEditLesson"), "error");
      return;
    }
    const targetDate = personalListEdit ? lesson.date : personalDate;
    if (!personalListEdit) {
      if (!personalDate) {
        toast(t("schedule.error.lessonDate"), "error");
        return;
      }
      if (isScheduleDateLockedForWrite(personalDate, canEditPastSchedule)) {
        toast(t("schedule.error.moveToPast"), "error");
        return;
      }
    }
    if (personalListEdit && !locationId) {
      toast(t("common.selectLocation"), "error");
      return;
    }
    if (!disciplineId) {
      toast(t("common.selectDiscipline"), "error");
      return;
    }
    const resolvedTeacherMemberId = resolveTeacherMemberId(
      teacherMemberId || lesson.teacherMemberId,
      teacherOptions,
      isTeacher ? memberId : null
    );
    if (!resolvedTeacherMemberId) {
      toast(t("common.selectTeacher"), "error");
      return;
    }

    const rangeError = validateTimeRange(timeStart, timeEnd);
    if (rangeError) {
      toast(
        rangeError.includes("позже") || rangeError.includes("later")
          ? t("schedule.error.endBeforeStart")
          : t("utils.conflict.invalidTime"),
        "error"
      );
      return;
    }

    const conflict = findScheduleConflict(
      {
        date: targetDate,
        timeStart,
        timeEnd,
        locationId: personalListEdit ? locationId : lesson.locationId,
        excludeLessonId: lesson.lessonId,
      },
      personalLessons,
      scheduleSlots,
      t,
      locale
    );
    if (conflict) {
      toast(formatScheduleConflictToast(targetDate, conflict, t, locale), "error");
      return;
    }

    let clientPayload: {
      type: "solo" | "pair" | "trio" | "quad";
      clientId1: string;
      clientId2: string;
      clientId3: string;
      clientId4: string;
    } | null = null;

    if (canReadClients) {
      const clientError = validateBookingClients(bookingClients, t);
      if (clientError) {
        toast(clientError, "error");
        return;
      }
      const selectedIds = bookingClients.map((client) => client.id);
      clientPayload = {
        type: participantTypeFromCount(selectedIds.length),
        clientId1: selectedIds[0] ?? "",
        clientId2: selectedIds[1] ?? "",
        clientId3: selectedIds[2] ?? "",
        clientId4: selectedIds[3] ?? "",
      };

      const resolvedPayerId =
        selectedIds.length >= 2
          ? payerClientId
          : selectedIds[0] ?? "";

      if (selectedIds.length >= 2 && !resolvedPayerId) {
        toast(t("personalTariff.payer.required"), "error");
        return;
      }
      if (resolvedPayerId && !selectedIds.includes(resolvedPayerId)) {
        toast(t("personalTariff.payer.required"), "error");
        return;
      }
    }

    const payerPayload =
      canReadClients && clientPayload
        ? {
            payerClientId:
              clientPayload.type === "solo"
                ? clientPayload.clientId1
                : payerClientId || clientPayload.clientId1,
          }
        : {};

    const res = await updatePersonalLesson.mutateAsync({
      id: lesson.lessonId,
      lessonDate: lesson.date,
      ...(personalListEdit ? {} : { date: personalDate }),
      timeStart,
      timeEnd,
      disciplineId,
      teacherMemberId: resolvedTeacherMemberId,
      locationId: personalListEdit ? locationId : lesson.locationId,
      ...(clientPayload ?? {}),
      ...(lesson.priceId != null ? { priceId: lesson.priceId } : {}),
      ...payerPayload,
    });

    if (!res.success) {
      toast(res.error ?? t("common.saveFailed"), "error");
      return;
    }

    toast(t("schedule.success.personalUpdated"), "success");
    onSuccess();
    onClose();
  };

  const groupVersionNote =
    lesson?.kind === "group"
      ? t("schedule.hint.newVersionFrom", { date: formatDate(todayISO) })
      : null;

  const personalEditNote = personalListEdit
    ? t("schedule.hint.personalEditSchedule")
    : t("schedule.hint.personalEditCalendar");

  const handleCancelPersonalPayment = async () => {
    if (!lesson || lesson.kind !== "personal") return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }

    const res = await voidPersonalLessonPayment.mutateAsync(lesson.lessonId);
    if (!res.success) {
      toast(resolveMutationError(res.error, "corrections.error.stornoFailed", t), "error");
      return;
    }

    toast(
      res.alreadyVoid ? t("personal.edit.cancelPaymentAlready") : t("personal.edit.cancelPaymentSuccess"),
      res.alreadyVoid ? "info" : "success"
    );
    onSuccess();
    onClose();
  };

  const savePending =
    editGroupSchedule.isPending ||
    updateGroupScheduleMetadata.isPending ||
    updateGroupScheduleValidity.isPending ||
    addGroupSchedule.isPending ||
    deleteScheduleSlot.isPending ||
    updatePersonalLesson.isPending ||
    updateClassMaxCapacity.isPending ||
    voidPersonalLessonPayment.isPending;
  const readOnly = lesson ? isScheduleDateLockedForWrite(lesson.date, canEditPastSchedule) : false;
  const canCancelPersonalPayment =
    lesson?.kind === "personal" &&
    lesson.paid === "yes" &&
    canShowPaidStatus(role) &&
    !readOnly;

  return (
    <AnimatePresence>
      {lesson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full max-h-[90vh] overflow-y-auto p-4 panel-card-stack"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                  {lesson.kind === "group" ? t("common.groupLesson") : t("common.personalLesson")}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">
                  {t("schedule.popup.edit")}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {readOnly ? (
              <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                {t("schedule.popup.pastReadOnly")}
              </p>
            ) : (
              <div className="panel-form-stack">
                {lesson.kind === "personal" && googleSyncStatus.uiStatus && (
                  <GoogleCalendarSyncStatusBadge
                    status={googleSyncStatus.uiStatus}
                    lastError={googleSyncStatus.row?.last_error}
                    compact
                  />
                )}

                {lesson.kind === "group" && locationName && showLocationInForm && (
                  <div className="field-stack">
                    <label className={labelCls}>{t("schedule.form.location")}</label>
                    <div className={readOnlyCls}>
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                      {locationName}
                    </div>
                  </div>
                )}

                {lesson.kind === "personal" && !personalListEdit && locationName && showLocationInForm && (
                  <div className="field-stack">
                    <label className={labelCls}>{t("schedule.form.location")}</label>
                    <div className={readOnlyCls}>
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                      {locationName}
                    </div>
                  </div>
                )}

                {lesson.kind === "group" ? (
                  <>
                    <div className="field-stack">
                      <label className={labelCls}>{t("schedule.form.currentDate")}</label>
                      <div className={readOnlyCls}>
                        <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                        {formatDate(lesson.date)}
                      </div>
                    </div>

                    <div className="field-stack">
                      <label className={labelCls}>{t("schedule.form.groupName")}</label>
                      <input
                        type="text"
                        required
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className={fieldCls}
                      />
                    </div>

                    <DisciplineSelect
                      disciplines={disciplines}
                      value={disciplineId}
                      onChange={setDisciplineId}
                      toast={toast}
                      alwaysShow
                    />

                    <AppSelect
                      label={t("schedule.form.teacher")}
                      value={teacherMemberId}
                      onChange={(e) => setTeacherMemberId(e.target.value)}
                      required
                    >
                      <option value="">{t("schedule.vacation.selectTeacher")}</option>
                      {teacherOptions.length === 0 ? (
                        <option value="" disabled>
                          {t("common.noTeachers")}
                        </option>
                      ) : (
                        teacherOptions.map((member) => (
                          <option key={member.id} value={member.id}>
                            {memberDisplayName(member) ?? memberListLabel(member)}
                          </option>
                        ))
                      )}
                    </AppSelect>

                    {lesson.scheduleGroupId && (
                      <div className="field-stack">
                        <label className={labelCls} htmlFor="edit-group-max-capacity">
                          {t("groupCapacity.maxCapacityLabel")}
                        </label>
                        <input
                          id="edit-group-max-capacity"
                          type="number"
                          min={1}
                          value={maxCapacity}
                          onChange={(e) => setMaxCapacity(e.target.value)}
                          placeholder={t("groupCapacity.maxCapacityPlaceholder")}
                          className={fieldCls}
                        />
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {t("groupCapacity.maxCapacityHint")}
                        </p>
                      </div>
                    )}

                    <div className="field-stack">
                      <label className={labelCls}>{t("schedule.form.daysAndTime")}</label>
                      <div className="space-y-2">
                        {groupSlotRows.map((row) => {
                          const conflict = groupSlotConflicts.get(row.key);
                          return (
                            <div
                              key={row.key}
                              className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2"
                            >
                              <div className="flex items-start gap-2">
                                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  <AppSelect
                                    value={row.dayOfWeek}
                                    onChange={(e) =>
                                      updateGroupSlotRow(row.key, {
                                        dayOfWeek: parseInt(e.target.value, 10),
                                      })
                                    }
                                    className="text-xs py-2"
                                  >
                                    {dowFullEntries(locale).map(([val, name]) => (
                                      <option key={val} value={val}>
                                        {name}
                                      </option>
                                    ))}
                                  </AppSelect>
                                  <TimeSelect
                                    label=""
                                    value={row.timeStart}
                                    onChange={(next) => handleGroupSlotTimeStartChange(row.key, next)}
                                    required
                                  />
                                  <TimeSelect
                                    label=""
                                    value={row.timeEnd}
                                    onChange={(next) => updateGroupSlotRow(row.key, { timeEnd: next })}
                                    required
                                  />
                                </div>
                                {groupSlotRows.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveGroupDay(row.key)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer shrink-0 mt-1"
                                    title={t("schedule.form.removeDay")}
                                    aria-label={t("schedule.form.removeDay")}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                              {conflict && (
                                <p className="text-[10px] text-rose-600 font-sans">
                                  {t("common.conflict")}: {conflict}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button type="button" onClick={handleAddGroupDay} className={addDayBtnCls}>
                        {t("common.addDay")}
                      </button>
                    </div>

                    <GroupLessonRepeatFields
                      config={repeatConfig}
                      onChange={(patch) => setRepeatConfig((prev) => ({ ...prev, ...patch }))}
                      minEndDate={lesson.date}
                    />

                    {groupVersionNote && (
                      <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>{groupVersionNote}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="field-stack">
                      {canReadClients ? (
                        <>
                          {bookingClients.map((client, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <ClientAutocomplete
                                  label={idx === 0 ? t("common.client") : t("common.clientN", { n: idx + 1 })}
                                  clients={activeClients}
                                  query={client.query}
                                  selectedId={client.id}
                                  showAddClientButton
                                  addClientLinkLabel={t("common.newClient")}
                                  toast={toast}
                                  onQueryChange={(query) => {
                                    setBookingClients((prev) => {
                                      const next = [...prev];
                                      next[idx] = { query, id: "" };
                                      return next;
                                    });
                                  }}
                                  onSelect={(selectedClient: Client) => {
                                    setBookingClients((prev) => {
                                      const next = [...prev];
                                      next[idx] = {
                                        query: `${selectedClient.lastName} ${selectedClient.firstName}`,
                                        id: selectedClient.id,
                                      };
                                      return next;
                                    });
                                  }}
                                />
                              </div>
                              {idx > 0 && (
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
                          {bookingClients.length < MAX_PERSONAL_CLIENTS && (
                            <button
                              type="button"
                              onClick={() => setBookingClients((prev) => [...prev, { query: "", id: "" }])}
                              className={addClientRowBtnCls}
                            >
                              {t("common.addClient")}
                            </button>
                          )}
                          {selectedClientIds.length >= 2 && (
                            <AppSelect
                              label={t("personalTariff.payer.label")}
                              value={payerClientId}
                              onChange={(e) => setPayerClientId(e.target.value)}
                              required
                            >
                              <option value="">{t("personalTariff.payer.required")}</option>
                              {selectedClientIds.map((clientId) => {
                                const client = directoryClients.find((item) => item.id === clientId);
                                const label = client
                                  ? `${client.lastName} ${client.firstName}`
                                  : clientId;
                                return (
                                  <option key={clientId} value={clientId}>
                                    {label}
                                  </option>
                                );
                              })}
                            </AppSelect>
                          )}
                        </>
                      ) : (
                        <>
                          <label className={labelCls}>{t("common.clientsLabel")}</label>
                          <div className={readOnlyCls}>{maskedClientLabel}</div>
                        </>
                      )}
                    </div>

                    {!personalListEdit && (
                      <div className="field-stack">
                        <label className={labelCls} htmlFor="edit-lesson-date">
                          {t("common.date")}
                        </label>
                        <input
                          id="edit-lesson-date"
                          type="date"
                          required
                          min={todayISO}
                          value={personalDate}
                          onChange={(e) => setPersonalDate(e.target.value)}
                          className={fieldCls}
                        />
                      </div>
                    )}

                    {personalListEdit && (
                      <div className="grid grid-cols-2 gap-3">
                        <TimeSelect label={t("common.timeStart")} value={timeStart} onChange={handleTimeStartChange} required />
                        <TimeSelect label={t("common.timeEnd")} value={timeEnd} onChange={setTimeEnd} required />
                      </div>
                    )}

                    {personalListEdit && locations && locations.length > 0 && (
                      <LocationSelect
                        locations={locations}
                        value={locationId}
                        onChange={setLocationId}
                        required
                      />
                    )}

                    <DisciplineSelect
                      disciplines={disciplines}
                      value={disciplineId}
                      onChange={setDisciplineId}
                      toast={toast}
                    />

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

                    {!personalListEdit && (
                      <div className="grid grid-cols-2 gap-3">
                        <TimeSelect label={t("common.timeStart")} value={timeStart} onChange={handleTimeStartChange} required />
                        <TimeSelect label={t("common.timeEnd")} value={timeEnd} onChange={setTimeEnd} required />
                      </div>
                    )}

                    {personalHasPayments && personalSlotChanged ? (
                      <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>{t("personal.edit.slotChangedWithPayments")}</p>
                      </div>
                    ) : null}

                    {personalDurationWarnMessage ? (
                      <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>{personalDurationWarnMessage}</p>
                      </div>
                    ) : null}

                    <p className="text-xs text-slate-500 leading-relaxed">{personalEditNote}</p>
                  </>
                )}
              </div>
            )}

            <GoogleCalendarFreebusyWarning
              visible={hasGoogleFreebusyOverlap}
              checking={isCheckingGoogleFreebusy}
            />

            {canCancelPersonalPayment ? (
              <RequirePermission action="personal_lessons.write" context={permissionContext}>
                <button
                  type="button"
                  onClick={() => void handleCancelPersonalPayment()}
                  disabled={connectionState !== "online" || savePending}
                  title={translateConnectionBlockReason(connectionState, t)}
                  className={`w-full ${btnOpenCls}`}
                >
                  <RotateCcw className="w-4 h-4" />
                  {voidPersonalLessonPayment.isPending
                    ? t("common.saving")
                    : t("personal.edit.cancelPayment")}
                </button>
              </RequirePermission>
            ) : null}

            <div className="flex items-center gap-2 pt-1">
              {!readOnly && (
                <RequirePermission
                  action={lesson.kind === "group" ? "schedule.write" : "personal_lessons.write"}
                  context={permissionContext}
                >
                  <button
                    type="button"
                    onClick={lesson.kind === "group" ? handleSaveGroup : handleSavePersonal}
                    disabled={
                      connectionState !== "online" ||
                      savePending ||
                      (lesson.kind === "group" && hasGroupSlotConflicts)
                    }
                    title={translateConnectionBlockReason(connectionState, t)}
                    className={`flex-1 ${btnAddCls}`}
                  >
                    {savePending ? t("common.savingChanges") : t("common.save")}
                  </button>
                </RequirePermission>
              )}
              <button
                type="button"
                onClick={onClose}
                className={`flex-1 ${btnCancelCls}`}
              >
                {readOnly ? t("common.close") : t("common.cancel")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
