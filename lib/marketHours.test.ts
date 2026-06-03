import { describe, expect, it } from "vitest";
import {
  hasTradedToday,
  isMarketInRegularSession,
  isMarketLive,
  marketHasOpenedToday,
  newYorkStatus,
  stockholmStatus,
  tradedTodaySignal,
} from "./marketHours";

// UTC instants annotated with local-market equivalents. June 2026 is
// CEST (UTC+2) in Stockholm and EDT (UTC-4) in New York.
const utc = (
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): Date => new Date(Date.UTC(y, mo - 1, d, h, mi));

describe("stockholmStatus", () => {
  it("opens 09:00–17:30 STO on weekdays", () => {
    expect(stockholmStatus(utc(2026, 6, 3, 7, 0))).toBe("OPEN"); // 09:00 STO
    expect(stockholmStatus(utc(2026, 6, 3, 15, 29))).toBe("OPEN"); // 17:29 STO
  });

  it("is closed outside the session and on weekends", () => {
    expect(stockholmStatus(utc(2026, 6, 3, 6, 59))).toBe("CLOSED"); // 08:59 STO
    expect(stockholmStatus(utc(2026, 6, 3, 15, 30))).toBe("CLOSED"); // 17:30 STO
    expect(stockholmStatus(utc(2026, 6, 6, 10, 0))).toBe("CLOSED"); // Sat
  });
});

describe("newYorkStatus", () => {
  it("reports the regular session 09:30–16:00 ET", () => {
    expect(newYorkStatus(utc(2026, 6, 3, 13, 30))).toBe("OPEN"); // 09:30 ET
    expect(newYorkStatus(utc(2026, 6, 3, 19, 59))).toBe("OPEN"); // 15:59 ET
    expect(newYorkStatus(utc(2026, 6, 3, 20, 0))).toBe("CLOSED"); // 16:00 ET
  });

  it("reports pre-market 04:00–09:30 ET", () => {
    expect(newYorkStatus(utc(2026, 6, 3, 8, 0))).toBe("PRE-MARKET"); // 04:00 ET
    expect(newYorkStatus(utc(2026, 6, 3, 13, 29))).toBe("PRE-MARKET"); // 09:29 ET
    expect(newYorkStatus(utc(2026, 6, 3, 7, 59))).toBe("CLOSED"); // 03:59 ET
  });
});

describe("isMarketInRegularSession (strict — excludes pre-market)", () => {
  it("is true only during regular US hours, not pre-market", () => {
    expect(isMarketInRegularSession("US", utc(2026, 6, 3, 13, 30))).toBe(true); // 09:30 ET
    expect(isMarketInRegularSession("US", utc(2026, 6, 3, 13, 29))).toBe(false); // pre
    expect(isMarketInRegularSession("US", utc(2026, 6, 3, 20, 0))).toBe(false); // 16:00 ET
  });

  it("tracks regular SE hours", () => {
    expect(isMarketInRegularSession("SE", utc(2026, 6, 3, 7, 0))).toBe(true); // 09:00
    expect(isMarketInRegularSession("SE", utc(2026, 6, 3, 6, 59))).toBe(false);
    expect(isMarketInRegularSession("SE", utc(2026, 6, 3, 15, 30))).toBe(false); // 17:30
  });
});

describe("isMarketLive (broad — includes pre-market + post-close buffer)", () => {
  it("includes US pre-market and a 30-min post-close buffer", () => {
    expect(isMarketLive("US", utc(2026, 6, 3, 8, 0))).toBe(true); // 04:00 ET pre
    expect(isMarketLive("US", utc(2026, 6, 3, 7, 59))).toBe(false); // 03:59 ET
    expect(isMarketLive("US", utc(2026, 6, 3, 20, 29))).toBe(true); // 16:29 ET (buffer)
    expect(isMarketLive("US", utc(2026, 6, 3, 20, 30))).toBe(false); // 16:30 ET
  });

  it("extends SE 30 min past the 17:30 close", () => {
    expect(isMarketLive("SE", utc(2026, 6, 3, 15, 59))).toBe(true); // 17:59 STO
    expect(isMarketLive("SE", utc(2026, 6, 3, 16, 0))).toBe(false); // 18:00 STO
  });
});

describe("marketHasOpenedToday (Stockholm-clock framing)", () => {
  it("treats NY's open as 15:30 STO regardless of region", () => {
    expect(marketHasOpenedToday("US", utc(2026, 6, 3, 13, 30))).toBe(true); // 15:30 STO
    expect(marketHasOpenedToday("US", utc(2026, 6, 3, 13, 29))).toBe(false); // 15:29 STO
  });

  it("treats SE open as 09:00 STO", () => {
    expect(marketHasOpenedToday("SE", utc(2026, 6, 3, 7, 0))).toBe(true);
    expect(marketHasOpenedToday("SE", utc(2026, 6, 3, 6, 59))).toBe(false);
  });
});

describe("tradedTodaySignal (holiday veto)", () => {
  const now = utc(2026, 6, 3, 12, 0);

  it("is true when the last trade falls on the current Stockholm day", () => {
    expect(tradedTodaySignal(utc(2026, 6, 3, 8, 0).getTime(), now)).toBe(true);
  });

  it("is false when the last trade was a previous day (exchange holiday)", () => {
    expect(tradedTodaySignal(utc(2026, 6, 2, 12, 0).getTime(), now)).toBe(false);
  });

  it("degrades to true when no usable timestamp is available", () => {
    expect(tradedTodaySignal(undefined, now)).toBe(true);
    expect(tradedTodaySignal(0, now)).toBe(true);
    expect(tradedTodaySignal(NaN, now)).toBe(true);
  });
});

describe("hasTradedToday (clock floor AND holiday veto)", () => {
  it("requires both the session to have opened and a same-day trade", () => {
    const open = utc(2026, 6, 3, 13, 30); // 15:30 STO — US opened
    const tradedToday = utc(2026, 6, 3, 13, 30).getTime();
    const tradedYesterday = utc(2026, 6, 2, 13, 30).getTime();

    expect(hasTradedToday(tradedToday, "US", open)).toBe(true);
    // Holiday: clock says open, but the last print is stale → false.
    expect(hasTradedToday(tradedYesterday, "US", open)).toBe(false);
    // Before the session opens, even a (future) same-day stamp is false.
    const preOpen = utc(2026, 6, 3, 13, 29); // 15:29 STO
    expect(hasTradedToday(tradedToday, "US", preOpen)).toBe(false);
  });
});
