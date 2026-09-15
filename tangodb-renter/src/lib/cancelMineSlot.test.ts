import { describe, expect, it, vi } from "vitest";
import * as rpc from "./rpc";
import { cancelMineSlot } from "./cancelMineSlot";
import type { MineSlot } from "./types";

vi.mock("./rpc", () => ({
  rpcDeleteHold: vi.fn(),
  rpcCancelOccurrence: vi.fn(),
}));

const supabase = {} as never;

const base: MineSlot = {
  id: "r1",
  date: "2026-09-30",
  time_start: "20:00",
  time_end: "21:00",
  lifecycle: "debt",
};

describe("cancelMineSlot", () => {
  it("uses server delete-hold flag", async () => {
    vi.mocked(rpc.rpcDeleteHold).mockResolvedValue();
    await cancelMineSlot(supabase, { ...base, can_delete_hold: true }, "Europe/Moscow", 0);
    expect(rpc.rpcDeleteHold).toHaveBeenCalledWith(supabase, "r1");
  });

  it("uses server cancel flag for debt slots", async () => {
    vi.mocked(rpc.rpcCancelOccurrence).mockResolvedValue();
    await cancelMineSlot(
      supabase,
      { ...base, can_cancel_occurrence: true },
      "Europe/Moscow",
      0
    );
    expect(rpc.rpcCancelOccurrence).toHaveBeenCalledWith(supabase, "r1");
  });
});
