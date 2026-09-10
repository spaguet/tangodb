import { describe, expect, it } from "vitest";
import { rpcErrorKey } from "./rpcErrors";

describe("rpcErrorKey", () => {
  it("maps Postgres date syntax errors to bookingInvalid", () => {
    expect(rpcErrorKey(new Error('invalid input syntax for type date: "03 июля 2026"'))).toBe(
      "bookingInvalid"
    );
  });

  it("maps normalize_hhmm failures to bookingInvalid", () => {
    expect(rpcErrorKey(new Error("Invalid time format: empty"))).toBe("bookingInvalid");
    expect(rpcErrorKey(new Error("Invalid time values: 24:00"))).toBe("bookingInvalid");
  });

  it("keeps renter.* codes", () => {
    expect(rpcErrorKey(new Error("renter.booking.packWindow"))).toBe("packInvalid");
  });
});
