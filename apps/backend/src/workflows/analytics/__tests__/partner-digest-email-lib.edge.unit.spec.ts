import { formatDuration } from "../partner-digest-email-lib";

describe("formatDuration (edge cases)", () => {
  it("clamps negative, NaN, and non-numeric inputs to 0s", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-30)).toBe("0s");
    expect(formatDuration(NaN)).toBe("0s");
    expect(formatDuration("abc" as any)).toBe("0s");
  });

  it("rounds sub-minute values and numeric strings", () => {
    expect(formatDuration(59)).toBe("59s");
    expect(formatDuration(59.4)).toBe("59s");
    expect(formatDuration("95" as any)).toBe("1m 35s");
  });

  it("rounds across the 60s minute boundary", () => {
    expect(formatDuration(59.6)).toBe("1m");
    expect(formatDuration(60)).toBe("1m");
  });

  it("formats minute-plus-seconds with remainder", () => {
    expect(formatDuration(61)).toBe("1m 1s");
    expect(formatDuration(90.4)).toBe("1m 30s");
    expect(formatDuration(119.6)).toBe("2m");
  });

  it("handles large durations (>= 1 hour) as minutes only", () => {
    expect(formatDuration(3600)).toBe("60m");
    expect(formatDuration(3661)).toBe("61m 1s");
  });
});
