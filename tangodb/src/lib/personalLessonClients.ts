import type { Client, PersonalDisplayLesson } from "../types";
import { t } from "./i18n";
import { formatClientName } from "./utils";

export interface BookingClientField {
  query: string;
  id: string;
}

export function filledBookingClientIds(fields: BookingClientField[]): string[] {
  return fields.map((field) => field.id).filter(Boolean);
}

export function participantTypeFromClientCount(count: number): "solo" | "pair" | "trio" | "quad" {
  if (count >= 4) return "quad";
  if (count >= 3) return "trio";
  if (count === 2) return "pair";
  return "solo";
}

/** Add empty slots for tariff minimum; never drop already selected clients. */
export function syncBookingClientFieldsForTariff(
  prev: BookingClientField[],
  neededFields: number
): BookingClientField[] {
  const next = [...prev];
  while (next.length < neededFields) {
    next.push({ query: "", id: "" });
  }
  while (next.length > neededFields && !next[next.length - 1]?.id) {
    next.pop();
  }
  return next;
}

export function clientIdsFromPersonalLesson(lesson: PersonalDisplayLesson): string[] {
  return [lesson.clientId1, lesson.clientId2, lesson.clientId3, lesson.clientId4].filter(
    (id): id is string => Boolean(id)
  );
}

export type PersonalLessonClientEntry = {
  id: string | null;
  label: string;
  client?: Client;
};

export function personalLessonClientEntries(
  lesson: PersonalDisplayLesson,
  directoryClients: Client[],
  canReadClients: boolean,
  clientNotSpecifiedLabel: string
): PersonalLessonClientEntry[] {
  if (!canReadClients) {
    return [{ id: null, label: t(null, "common.client") }];
  }

  const ids = clientIdsFromPersonalLesson(lesson);
  if (ids.length > 0) {
    return ids.map((id) => {
      const client = directoryClients.find((c) => c.id === id);
      return {
        id,
        label: client ? formatClientName(client.lastName, client.firstName) : id,
        client,
      };
    });
  }

  const display = lesson.clientDisplay?.trim();
  if (
    !display ||
    display === "schedule.lessonInfo.clientNotSpecified" ||
    display === clientNotSpecifiedLabel
  ) {
    return [{ id: null, label: clientNotSpecifiedLabel }];
  }

  if (display.includes("&")) {
    return display.split("&").map((part) => ({
      id: null,
      label: part.trim(),
    }));
  }

  return [{ id: null, label: display }];
}
