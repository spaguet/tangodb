import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickBestSlotForDay, pickGroupSlotsForEdit } from "./scheduleSlotEdit.ts";
import { inferGroupRepeatConfig } from "./groupLessonRepeat.ts";
import { isScheduleSlotLiveOnDate, successorVersionValidTo } from "./scheduleWeek.ts";
import type { GroupDisplayLesson, ScheduleSlot } from "../types/index.ts";

function slot(partial: Partial<ScheduleSlot> & { id: string; dayOfWeek: number }): ScheduleSlot {
  return {
    time: "17:00",
    timeEnd: "18:30",
    validFrom: "2026-01-07",
    validTo: null,
    ...partial,
  };
}

describe("isScheduleSlotLiveOnDate", () => {
  it("treats a finite series as live on a date inside the range", () => {
    assert.equal(isScheduleSlotLiveOnDate("2026-01-07", "2026-12-30", "2026-09-16"), true);
  });

  it("does not treat a tombstone as live", () => {
    assert.equal(isScheduleSlotLiveOnDate("2026-01-07", "2026-01-06", "2026-01-07"), false);
  });
});

describe("successorVersionValidTo", () => {
  it("keeps the original series end when versioning mid-range", () => {
    assert.equal(successorVersionValidTo("2026-12-30", "2026-09-16"), "2026-12-30");
  });

  it("uses the requested end date when recurrence changed", () => {
    assert.equal(successorVersionValidTo("2026-12-30", "2026-09-16", "2026-10-28"), "2026-10-28");
  });
});

describe("pickBestSlotForDay", () => {
  it("picks a live finite series covering the edited occurrence", () => {
    const chosen = pickBestSlotForDay(
      [slot({ id: "silver-wed", dayOfWeek: 3, validFrom: "2026-01-07", validTo: "2026-12-30" })],
      3,
      "2026-09-16"
    );
    assert.equal(chosen?.id, "silver-wed");
  });

  it("prefers a successor that starts on the edited date over the closed parent", () => {
    const chosen = pickBestSlotForDay(
      [
        slot({ id: "old", dayOfWeek: 3, validFrom: "2026-01-07", validTo: "2026-09-15" }),
        slot({ id: "new", dayOfWeek: 3, validFrom: "2026-09-16", validTo: "2026-12-30" }),
      ],
      3,
      "2026-09-16"
    );
    assert.equal(chosen?.id, "new");
  });
});

describe("pickGroupSlotsForEdit", () => {
  it("edits the covering finite slot, not only open-ended valid_to=null rows", () => {
    const lesson: GroupDisplayLesson = {
      kind: "group",
      slotId: "silver-wed",
      date: "2026-09-16",
      timeStart: "17:00",
      timeEnd: "18:30",
      validFrom: "2026-01-07",
      validTo: "2026-12-30",
      dayOfWeek: 3,
      disciplineId: "ballroom",
      groupName: "Silver",
      scheduleGroupId: "class-1",
      locationId: "hall-1",
      teacherMemberId: "owner",
    };
    const rows = pickGroupSlotsForEdit(
      lesson,
      [
        slot({
          id: "silver-wed",
          dayOfWeek: 3,
          validFrom: "2026-01-07",
          validTo: "2026-12-30",
          scheduleGroupId: "class-1",
          groupName: "Silver",
          disciplineId: "ballroom",
          locationId: "hall-1",
        }),
      ],
      "2026-09-16"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "silver-wed");
  });
});

describe("inferGroupRepeatConfig", () => {
  it("restores until-date mode when valid_to is an occurrence date", () => {
    const inferred = inferGroupRepeatConfig("2026-01-07", "2026-12-30");
    assert.equal(inferred.repeatWeekly, true);
    assert.equal(inferred.endMode, "date");
    assert.equal(inferred.endDate, "2026-12-30");
  });

  it("restores N-weeks mode when valid_to is validFrom + N*7 - 1", () => {
    const inferred = inferGroupRepeatConfig("2026-09-16", "2026-10-13");
    assert.equal(inferred.endMode, "weeks");
    assert.equal(inferred.weekCount, 4);
  });
});
