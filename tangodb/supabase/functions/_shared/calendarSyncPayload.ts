/**
 * Google Calendar event payload helpers for calendar-sync-worker.
 */

export type PrivacyMode = "full_name" | "initials" | "hidden";

export type GoogleEventPrivateProps = {
  managedBy: string;
  organizationId: string;
  sourceType: string;
  sourceId: string;
  occurrenceKey?: string;
};

export type GoogleCalendarEventResource = {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  transparency: "opaque" | "transparent";
  visibility: "private" | "default";
  reminders: { useDefault: boolean };
  extendedProperties: { private: GoogleEventPrivateProps };
};

export function googleEventIdFromUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

export function normalizeTimeHm(time: string): string {
  const trimmed = time.trim();
  if (trimmed.length >= 5) return trimmed.slice(0, 5);
  return trimmed;
}

export function toGoogleDateTime(
  date: string,
  time: string,
  timeZone: string
): { dateTime: string; timeZone: string } {
  const hm = normalizeTimeHm(time);
  return { dateTime: `${date}T${hm}:00`, timeZone };
}

export function formatClientLabel(
  firstName: string | null,
  lastName: string | null,
  privacyMode: PrivacyMode
): string {
  const fn = (firstName ?? "").trim();
  const ln = (lastName ?? "").trim();
  if (privacyMode === "hidden") return "Клиент";
  if (!fn && !ln) return "Клиент";
  if (privacyMode === "initials") {
    if (ln) return `${fn} ${ln.charAt(0).toUpperCase()}.`;
    return fn;
  }
  if (ln) return `${fn} ${ln}`;
  return fn;
}

export function buildPersonalLessonSummary(disciplineName: string | null): string {
  const discipline = (disciplineName ?? "").trim();
  if (discipline) return `Персональный урок · ${discipline}`;
  return "Персональный урок";
}

export function buildPersonalLessonDescription(input: {
  clientLabels: string[];
  organizationName: string;
  scheduleUrl: string;
}): string {
  const clientLine =
    input.clientLabels.length > 0
      ? `Клиент: ${input.clientLabels.join(", ")}`
      : "Клиент: —";
  return [
    clientLine,
    `Организация: ${input.organizationName}`,
    `Открыть в CRM: ${input.scheduleUrl}`,
    "Управляется TangoDB. Изменяйте урок в CRM.",
  ].join("\n");
}

export function buildPersonalLessonGoogleEvent(input: {
  lessonId: string;
  organizationId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  timeZone: string;
  disciplineName: string | null;
  locationName: string | null;
  clientLabels: string[];
  organizationName: string;
  scheduleUrl: string;
  cancelledMark?: boolean;
}): GoogleCalendarEventResource {
  let summary = buildPersonalLessonSummary(input.disciplineName);
  if (input.cancelledMark) {
    summary = `Отменено: ${summary}`;
  }

  return {
    summary,
    description: buildPersonalLessonDescription({
      clientLabels: input.clientLabels,
      organizationName: input.organizationName,
      scheduleUrl: input.scheduleUrl,
    }),
    location: input.locationName?.trim() || undefined,
    start: toGoogleDateTime(input.date, input.timeStart, input.timeZone),
    end: toGoogleDateTime(input.date, input.timeEnd, input.timeZone),
    transparency: input.cancelledMark ? "transparent" : "opaque",
    visibility: "private",
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        managedBy: "tangodb",
        organizationId: input.organizationId,
        sourceType: "personal_lesson",
        sourceId: input.lessonId,
      },
    },
  };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortValue(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export async function hashGoogleEventPayload(
  payload: GoogleCalendarEventResource
): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(payload));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildGroupOccurrenceSummary(
  groupName: string | null,
  disciplineName: string | null
): string {
  const group = (groupName ?? "").trim();
  if (group) return group;
  const discipline = (disciplineName ?? "").trim();
  if (discipline) return discipline;
  return "Групповой урок";
}

export function buildGroupOccurrenceDescription(input: {
  organizationName: string;
  scheduleUrl: string;
}): string {
  return [
    `Организация: ${input.organizationName}`,
    `Открыть в CRM: ${input.scheduleUrl}`,
    "Управляется TangoDB. Изменяйте урок в CRM.",
  ].join("\n");
}

export function buildGroupOccurrenceGoogleEvent(input: {
  slotId: string;
  organizationId: string;
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  timeZone: string;
  groupName: string | null;
  disciplineName: string | null;
  locationName: string | null;
  organizationName: string;
  scheduleUrl: string;
}): GoogleCalendarEventResource {
  return {
    summary: buildGroupOccurrenceSummary(input.groupName, input.disciplineName),
    description: buildGroupOccurrenceDescription({
      organizationName: input.organizationName,
      scheduleUrl: input.scheduleUrl,
    }),
    location: input.locationName?.trim() || undefined,
    start: toGoogleDateTime(input.occurrenceDate, input.timeStart, input.timeZone),
    end: toGoogleDateTime(input.occurrenceDate, input.timeEnd, input.timeZone),
    transparency: "opaque",
    visibility: "default",
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        managedBy: "tangodb",
        organizationId: input.organizationId,
        sourceType: "group_occurrence",
        sourceId: input.slotId,
        occurrenceKey: input.occurrenceDate,
      },
    },
  };
}

export function googleEventIdForGroupOccurrence(
  slotId: string,
  occurrenceDate: string
): string {
  return googleEventIdFromUuid(`${slotId}-${occurrenceDate}`);
}

export function buildEventSessionDescription(input: {
  eventType: string;
  guestTeacher: string | null;
  organizer: string | null;
  comment: string | null;
  organizationName: string;
  scheduleUrl: string;
}): string {
  const lines: string[] = [];
  const typeLabel =
    input.eventType === "master_class" ? "Мастер-класс" : "Открытый урок";
  lines.push(`Тип: ${typeLabel}`);

  if (input.guestTeacher?.trim()) {
    lines.push(`Гостевой преподаватель: ${input.guestTeacher.trim()}`);
  }
  if (input.organizer?.trim()) {
    lines.push(`Организатор: ${input.organizer.trim()}`);
  }
  if (input.comment?.trim()) {
    lines.push(`Комментарий: ${input.comment.trim()}`);
  }

  lines.push(`Организация: ${input.organizationName}`);
  lines.push(`Открыть в CRM: ${input.scheduleUrl}`);
  lines.push("Управляется TangoDB. Изменяйте мероприятие в CRM.");
  return lines.join("\n");
}

export function buildEventSessionGoogleEvent(input: {
  sessionId: string;
  organizationId: string;
  sessionDate: string;
  timeStart: string;
  timeEnd: string;
  timeZone: string;
  title: string;
  eventType: string;
  guestTeacher: string | null;
  organizer: string | null;
  comment: string | null;
  locationName: string | null;
  organizationName: string;
  scheduleUrl: string;
}): GoogleCalendarEventResource {
  const summary = (input.title ?? "").trim() || "Мероприятие";

  return {
    summary,
    description: buildEventSessionDescription({
      eventType: input.eventType,
      guestTeacher: input.guestTeacher,
      organizer: input.organizer,
      comment: input.comment,
      organizationName: input.organizationName,
      scheduleUrl: input.scheduleUrl,
    }),
    location: input.locationName?.trim() || undefined,
    start: toGoogleDateTime(input.sessionDate, input.timeStart, input.timeZone),
    end: toGoogleDateTime(input.sessionDate, input.timeEnd, input.timeZone),
    transparency: "opaque",
    visibility: "default",
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        managedBy: "tangodb",
        organizationId: input.organizationId,
        sourceType: "event_session",
        sourceId: input.sessionId,
      },
    },
  };
}
