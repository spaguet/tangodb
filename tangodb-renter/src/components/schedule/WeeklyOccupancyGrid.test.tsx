import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OccupancyData } from "../../lib/types";
import WeeklyOccupancyGrid from "./WeeklyOccupancyGrid";

const WEEK = [
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-19",
  "2026-09-20",
];

const occupancy: OccupancyData = {
  window: { from: "2026-09-14", to: "2026-10-04" },
  from: "2026-09-14",
  to: "2026-10-04",
  busy: [{ date: "2026-09-14", time_start: "10:00", time_end: "12:00" }],
  mine: [
    {
      id: "mine-1",
      date: "2026-09-14",
      time_start: "14:00",
      time_end: "16:00",
      lifecycle: "active",
    },
  ],
};

describe("WeeklyOccupancyGrid", () => {
  it("renders CRM-style blocks and keeps free/mine click handlers", async () => {
    const user = userEvent.setup();
    const onFreeCell = vi.fn();
    const onMineCell = vi.fn();

    render(
      <WeeklyOccupancyGrid
        locale="ru"
        timezone="Europe/Moscow"
        serverNow="2026-09-10T08:00:00.000Z"
        weekDays={WEEK}
        occupancy={occupancy}
        addonActive
        onFreeCell={onFreeCell}
        onMineCell={onMineCell}
      />
    );

    expect(screen.getByText("Занято")).toBeTruthy();
    expect(screen.getByText("Моя бронь")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Моя бронь/ }));
    expect(onMineCell).toHaveBeenCalledWith("mine-1");

    await user.click(screen.getByRole("button", { name: /14, 12:00, Свободно/ }));
    expect(onFreeCell).toHaveBeenCalledWith("2026-09-14", "12:00");
  });
});
