import { describe, expect, it } from "vitest";
import type { RentalDisplayLesson } from "../types";
import {
  canOccupancyReleaseLesson,
  isEditionOccupancyLeftover,
  isOrgTimezoneMiniAppBlockError,
  withEditionOccupancyFields,
} from "./scheduleEditionOccupancy";

const rental: RentalDisplayLesson = {
  kind: "rental",
  rentalId: "r1",
  date: "2099-06-01",
  timeStart: "10:00",
  timeEnd: "11:00",
  locationId: null,
  bookingStatus: "confirmed",
};

describe("scheduleEditionOccupancy", () => {
  it("marks leftover rental when hall_rent is closed", () => {
    const allows = (cap: string) => cap !== "hall_rent";
    expect(isEditionOccupancyLeftover(rental, allows)).toBe(true);
    const marked = withEditionOccupancyFields(rental, allows);
    expect(marked.editionOccupancy).toBe(true);
    expect(marked.editionOccupancyUpsell).toBe("pro");
  });

  it("allows release on future leftover rental", () => {
    const marked = { ...rental, editionOccupancy: true };
    expect(canOccupancyReleaseLesson(marked)).toBe(true);
  });

  it("detects Mini App timezone block message", () => {
    expect(
      isOrgTimezoneMiniAppBlockError(
        "timezone cannot change while Mini App slots are awaiting_payment/active/prepaid_charged"
      )
    ).toBe(true);
  });
});
