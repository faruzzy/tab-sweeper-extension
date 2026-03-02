import { describe, it, expect } from "vitest";
import {
  normalizeHostname,
  shouldTrackUrl,
  shouldTrackTab,
  matchesDomainList,
  getTabLabel,
  formatAge,
} from "../bg/utils.js";

describe("normalizeHostname", () => {
  it("extracts hostname from URL", () => {
    expect(normalizeHostname("https://example.com/path")).toBe("example.com");
  });

  it("strips www prefix", () => {
    expect(normalizeHostname("https://www.example.com")).toBe("example.com");
  });

  it("lowercases hostname", () => {
    expect(normalizeHostname("https://Example.COM")).toBe("example.com");
  });

  it("returns empty string for invalid URLs", () => {
    expect(normalizeHostname("not-a-url")).toBe("");
    expect(normalizeHostname("")).toBe("");
  });
});

describe("shouldTrackUrl", () => {
  it("tracks http URLs", () => {
    expect(shouldTrackUrl("http://example.com")).toBe(true);
  });

  it("tracks https URLs", () => {
    expect(shouldTrackUrl("https://example.com")).toBe(true);
  });

  it("rejects chrome:// URLs", () => {
    expect(shouldTrackUrl("chrome://extensions")).toBe(false);
  });

  it("rejects about: URLs", () => {
    expect(shouldTrackUrl("about:blank")).toBe(false);
  });

  it("rejects empty/null/undefined", () => {
    expect(shouldTrackUrl("")).toBe(false);
    expect(shouldTrackUrl(null)).toBe(false);
    expect(shouldTrackUrl(undefined)).toBe(false);
  });
});

describe("shouldTrackTab", () => {
  it("tracks ungrouped http tabs", () => {
    expect(shouldTrackTab({ url: "https://example.com", groupId: -1 })).toBe(true);
  });

  it("tracks tabs without groupId property", () => {
    expect(shouldTrackTab({ url: "https://example.com" })).toBe(true);
  });

  it("rejects grouped tabs", () => {
    expect(shouldTrackTab({ url: "https://example.com", groupId: 5 })).toBe(false);
    expect(shouldTrackTab({ url: "https://example.com", groupId: 0 })).toBe(false);
  });

  it("rejects non-http tabs even if ungrouped", () => {
    expect(shouldTrackTab({ url: "chrome://extensions", groupId: -1 })).toBe(false);
  });

  it("rejects null/undefined tab", () => {
    expect(shouldTrackTab(null)).toBe(false);
    expect(shouldTrackTab(undefined)).toBe(false);
  });
});

describe("matchesDomainList", () => {
  it("matches exact domain", () => {
    expect(matchesDomainList("https://example.com/page", ["example.com"])).toBe(true);
  });

  it("matches subdomain", () => {
    expect(matchesDomainList("https://mail.google.com", ["google.com"])).toBe(true);
  });

  it("does not match partial domain names", () => {
    expect(matchesDomainList("https://notgoogle.com", ["google.com"])).toBe(false);
  });

  it("strips www from both URL and domain list", () => {
    expect(matchesDomainList("https://www.example.com", ["example.com"])).toBe(true);
    expect(matchesDomainList("https://example.com", ["www.example.com"])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesDomainList("https://Example.COM", ["example.com"])).toBe(true);
  });

  it("returns false for empty domain list", () => {
    expect(matchesDomainList("https://example.com", [])).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(matchesDomainList("", ["example.com"])).toBe(false);
    expect(matchesDomainList("not-a-url", ["example.com"])).toBe(false);
  });

  it("ignores empty/null entries in domain list", () => {
    expect(matchesDomainList("https://example.com", ["", null, "example.com"])).toBe(true);
  });
});

describe("getTabLabel", () => {
  it("uses title when different from hostname", () => {
    const result = getTabLabel({ title: "My Page", url: "https://example.com" });
    expect(result.label).toBe("My Page");
    expect(result.hostname).toBe("example.com");
  });

  it("uses title when it matches hostname", () => {
    const result = getTabLabel({ title: "example.com", url: "https://example.com" });
    expect(result.label).toBe("example.com");
  });

  it("falls back to URL when no title", () => {
    const result = getTabLabel({ title: "", url: "https://example.com/page" });
    expect(result.label).toBe("https://example.com/page");
  });

  it("returns 'Untitled tab' for empty tab", () => {
    const result = getTabLabel({});
    expect(result.label).toBe("Untitled tab");
  });

  it("handles null/undefined tab", () => {
    const result = getTabLabel(null);
    expect(result.label).toBe("Untitled tab");
    expect(result.hostname).toBe("");
  });
});

describe("formatAge", () => {
  it("formats minutes under 60", () => {
    expect(formatAge(5)).toBe("5m");
    expect(formatAge(30)).toBe("30m");
  });

  it("formats hours for 60+", () => {
    expect(formatAge(60)).toBe("1.0h");
    expect(formatAge(90)).toBe("1.5h");
  });

  it("rounds up to at least 1m", () => {
    expect(formatAge(0.3)).toBe("1m");
    expect(formatAge(0)).toBe("1m");
  });
});
