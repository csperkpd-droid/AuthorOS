import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  daysBetween,
  fromDbDate,
  isDateString,
  isValidTimeZone,
  localDate,
  startOfMonthGrid,
  toDbDate,
} from "./dates";

describe("dates", () => {
  it("gives the local calendar date in a time zone", () => {
    const at = new Date("2026-10-03T23:30:00Z");
    expect(localDate("UTC", at)).toBe("2026-10-03");
    expect(localDate("Pacific/Auckland", at)).toBe("2026-10-04");
    expect(localDate("America/Los_Angeles", at)).toBe("2026-10-03");
  });

  it("round-trips database dates without drifting", () => {
    expect(fromDbDate(toDbDate("2026-03-29"))).toBe("2026-03-29");
  });

  it("does date arithmetic across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("starts month grids on Monday", () => {
    // 1 October 2026 is a Thursday.
    expect(startOfMonthGrid("2026-10")).toBe("2026-09-28");
    // 1 June 2026 is a Monday.
    expect(startOfMonthGrid("2026-06")).toBe("2026-06-01");
  });

  it("validates input", () => {
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-02-28")).toBe(true);
    expect(isDateString("2026-2-3")).toBe(false);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});

describe("formatDay", () => {
  it("formats the same everywhere", async () => {
    const { formatDay } = await import("./dates");
    expect(formatDay("2026-10-03")).toBe("Saturday 3 October");
    expect(formatDay("2026-10-03", { weekday: "short", month: "short" })).toBe("Sat 3 Oct");
    expect(formatDay("2026-10-01", { weekday: undefined, day: undefined, year: "numeric" })).toBe(
      "October 2026",
    );
  });
});
