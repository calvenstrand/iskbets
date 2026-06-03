import { describe, expect, it } from "vitest";
import {
  inPostCloseWindow,
  inRecapWindow,
  inWeeklyArchiveWindow,
  stockholmDate,
  stockholmMondayOfWeek,
} from "./dateUtil";

// All instants are constructed in UTC and annotated with their Stockholm
// local equivalent. June 2026 is CEST (UTC+2); March instants below
// straddle the spring-forward boundary (2026-03-29) on purpose.
const utc = (
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): Date => new Date(Date.UTC(y, mo - 1, d, h, mi));

describe("stockholmDate", () => {
  it("renders the Stockholm calendar day as YYYY-MM-DD", () => {
    // 21:00 UTC = 23:00 STO, still the 3rd.
    expect(stockholmDate(utc(2026, 6, 3, 21, 0))).toBe("2026-06-03");
  });

  it("rolls to the next day once Stockholm passes midnight", () => {
    // 23:30 UTC = 01:30 STO next day.
    expect(stockholmDate(utc(2026, 6, 3, 23, 30))).toBe("2026-06-04");
  });
});

describe("inPostCloseWindow (weekday 22:00–22:45 STO)", () => {
  it("is true at the open edge and inside the window", () => {
    expect(inPostCloseWindow(utc(2026, 6, 3, 20, 0))).toBe(true); // 22:00 STO
    expect(inPostCloseWindow(utc(2026, 6, 3, 20, 44))).toBe(true); // 22:44 STO
  });

  it("is false at the closing edge and before it opens", () => {
    expect(inPostCloseWindow(utc(2026, 6, 3, 20, 45))).toBe(false); // 22:45 STO
    expect(inPostCloseWindow(utc(2026, 6, 3, 19, 59))).toBe(false); // 21:59 STO
  });

  it("never fires on the weekend", () => {
    expect(inPostCloseWindow(utc(2026, 6, 6, 20, 0))).toBe(false); // Sat 22:00 STO
  });
});

describe("inWeeklyArchiveWindow (Friday 22:45–23:30 STO)", () => {
  it("is true only inside the Friday window", () => {
    expect(inWeeklyArchiveWindow(utc(2026, 6, 5, 20, 45))).toBe(true); // Fri 22:45
    expect(inWeeklyArchiveWindow(utc(2026, 6, 5, 21, 29))).toBe(true); // Fri 23:29
  });

  it("is false at the edges and on other weekdays", () => {
    expect(inWeeklyArchiveWindow(utc(2026, 6, 5, 20, 44))).toBe(false); // Fri 22:44
    expect(inWeeklyArchiveWindow(utc(2026, 6, 5, 21, 30))).toBe(false); // Fri 23:30
    expect(inWeeklyArchiveWindow(utc(2026, 6, 4, 21, 0))).toBe(false); // Thu 23:00
  });
});

describe("inRecapWindow (Fri 22:00 STO → Mon 09:00 STO)", () => {
  it("covers the whole weekend", () => {
    expect(inRecapWindow(utc(2026, 6, 6, 12, 0))).toBe(true); // Sat
    expect(inRecapWindow(utc(2026, 6, 7, 3, 0))).toBe(true); // Sun
  });

  it("opens at Friday's NY close (22:00 STO)", () => {
    expect(inRecapWindow(utc(2026, 6, 5, 20, 0))).toBe(true); // Fri 22:00
    expect(inRecapWindow(utc(2026, 6, 5, 19, 59))).toBe(false); // Fri 21:59
  });

  it("closes at Monday's Stockholm open (09:00 STO)", () => {
    expect(inRecapWindow(utc(2026, 6, 8, 6, 0))).toBe(true); // Mon 08:00
    expect(inRecapWindow(utc(2026, 6, 8, 7, 0))).toBe(false); // Mon 09:00
  });

  it("is false mid-week", () => {
    expect(inRecapWindow(utc(2026, 6, 3, 12, 0))).toBe(false); // Wed 14:00
  });
});

describe("stockholmMondayOfWeek", () => {
  it("returns the same Monday for every day of a week", () => {
    expect(stockholmMondayOfWeek(utc(2026, 6, 1, 12, 0))).toBe("2026-06-01"); // Mon
    expect(stockholmMondayOfWeek(utc(2026, 6, 3, 12, 0))).toBe("2026-06-01"); // Wed
    expect(stockholmMondayOfWeek(utc(2026, 6, 6, 12, 0))).toBe("2026-06-01"); // Sat
    expect(stockholmMondayOfWeek(utc(2026, 6, 7, 12, 0))).toBe("2026-06-01"); // Sun 14:00 STO
  });

  it("survives the spring-forward DST weekend", () => {
    // 2026-03-29 is the spring-forward Sunday. Subtracting 6 whole UTC
    // days lands on Mon 2026-03-23, which is still in CET (UTC+1) — the
    // ±1h shift must not push the derived calendar date off by a day.
    expect(stockholmMondayOfWeek(utc(2026, 3, 29, 14, 0))).toBe("2026-03-23");
  });
});
