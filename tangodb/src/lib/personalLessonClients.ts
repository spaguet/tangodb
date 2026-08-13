import type { Client, PersonalDisplayLesson } from "../types";
import { formatClientName } from "./utils";

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
    return [{ id: null, label: "Клиент" }];
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
  if (!display || display === "Клиент не указан") {
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
