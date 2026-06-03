import { describe, expect, it } from "vitest";
import { fridayFromMonday } from "./weeklyResult";

describe("fridayFromMonday", () => {
  it("adds 4 days to get the Friday of the same week", () => {
    expect(fridayFromMonday("2026-06-01")).toBe("2026-06-05");
    expect(fridayFromMonday("2026-01-05")).toBe("2026-01-09");
  });

  it("crosses month boundaries correctly", () => {
    expect(fridayFromMonday("2026-03-30")).toBe("2026-04-03");
    expect(fridayFromMonday("2026-11-30")).toBe("2026-12-04");
  });

  it("crosses year boundaries correctly", () => {
    expect(fridayFromMonday("2026-12-28")).toBe("2027-01-01");
  });

  it("returns the input unchanged when the date string is malformed", () => {
    expect(fridayFromMonday("bad")).toBe("bad");
    expect(fridayFromMonday("")).toBe("");
  });
});
