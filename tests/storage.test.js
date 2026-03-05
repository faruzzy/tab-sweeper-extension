import { describe, it, expect } from "vitest";
import { computeSweepInterval, DEFAULT_SETTINGS } from "../bg/storage.js";

describe("computeSweepInterval", () => {
  it("clamps to minimum 30s for short close times", () => {
    expect(computeSweepInterval(1)).toBe(30);
    expect(computeSweepInterval(5)).toBe(30);
    expect(computeSweepInterval(10)).toBe(30);
  });

  it("scales proportionally for medium close times", () => {
    expect(computeSweepInterval(30)).toBe(90);
    expect(computeSweepInterval(60)).toBe(180);
  });

  it("clamps to maximum 300s for long close times", () => {
    expect(computeSweepInterval(120)).toBe(300);
    expect(computeSweepInterval(1440)).toBe(300);
    expect(computeSweepInterval(4320)).toBe(300);
  });

  it("produces roughly 20 sweeps per close period", () => {
    const closeMinutes = 50;
    const interval = computeSweepInterval(closeMinutes);
    const sweepsPerPeriod = (closeMinutes * 60) / interval;
    expect(sweepsPerPeriod).toBeGreaterThanOrEqual(10);
    expect(sweepsPerPeriod).toBeLessThanOrEqual(30);
  });

  it("uses warning-to-close window when warningMinutes is provided", () => {
    // close=10min, warn=9min → window=1min=60s → fromWindow=60/3=20 → clamped to 30
    expect(computeSweepInterval(10, 9)).toBe(30);
    // close=10min, warn=5min → window=5min=300s → fromWindow=300/3=100
    // fromClose=10*60/20=30 → min(30, 100) = 30
    expect(computeSweepInterval(10, 5)).toBe(30);
  });

  it("picks the smaller of fromClose and fromWindow", () => {
    // close=60min, warn=59min → window=1min=60s → fromWindow=20 → clamped to 30
    // fromClose=60*60/20=180 → min(180, 30) = 30
    expect(computeSweepInterval(60, 59)).toBe(30);
    // close=60min, warn=30min → window=30min=1800s → fromWindow=600 → capped at 300
    // fromClose=180 → min(180, 300) = 180
    expect(computeSweepInterval(60, 30)).toBe(180);
  });

  it("ignores warningMinutes when not provided or invalid", () => {
    expect(computeSweepInterval(30)).toBe(90);
    expect(computeSweepInterval(30, undefined)).toBe(90);
    expect(computeSweepInterval(30, 0)).toBe(90);
    expect(computeSweepInterval(30, -5)).toBe(90);
  });

  it("ignores warningMinutes when >= closeMinutes", () => {
    expect(computeSweepInterval(30, 30)).toBe(90);
    expect(computeSweepInterval(30, 60)).toBe(90);
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("has expected default values", () => {
    expect(DEFAULT_SETTINGS.warningMinutes).toBe(1);
    expect(DEFAULT_SETTINGS.closeMinutes).toBe(5);
    expect(DEFAULT_SETTINGS.sweepSeconds).toBe(30);
    expect(DEFAULT_SETTINGS.setupComplete).toBe(false);
    expect(DEFAULT_SETTINGS.exceptionDomains).toEqual([]);
  });

  it("has consistent duration objects", () => {
    expect(DEFAULT_SETTINGS.warningDuration).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(DEFAULT_SETTINGS.closeDuration).toEqual({ days: 0, hours: 0, minutes: 5 });
  });
});
