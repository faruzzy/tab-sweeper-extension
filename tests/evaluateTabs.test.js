import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Chrome API mock ---
const store = {};
const removedTabIds = [];

function resetMocks() {
  for (const k of Object.keys(store)) delete store[k];
  removedTabIds.length = 0;
}

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys) => {
        if (typeof keys === "string") keys = [keys];
        const result = {};
        for (const k of keys) {
          if (store[k] !== undefined) result[k] = structuredClone(store[k]);
        }
        return result;
      }),
      set: vi.fn(async (data) => {
        for (const [k, v] of Object.entries(data)) {
          store[k] = structuredClone(v);
        }
      }),
    },
  },
  tabs: {
    query: vi.fn(async () => []),
    remove: vi.fn(async (id) => removedTabIds.push(id)),
  },
  action: {
    setBadgeText: vi.fn(async () => {}),
    setBadgeBackgroundColor: vi.fn(async () => {}),
  },
  notifications: {
    create: vi.fn(async () => {}),
  },
  runtime: {
    getURL: vi.fn((path) => `chrome-extension://fake/${path}`),
  },
};

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "test-uuid" });
}

// Import AFTER mocks are in place
const { evaluateTabs } = await import("../bg/tabs.js");

function makeTab(id, url = "https://example.com", title = "Example") {
  return { id, url, title, groupId: -1 };
}

function setSettings(overrides = {}) {
  store.settings = {
    warningMinutes: 1,
    closeMinutes: 2,
    warningDuration: { days: 0, hours: 0, minutes: 1 },
    closeDuration: { days: 0, hours: 0, minutes: 2 },
    sweepSeconds: 30,
    exceptionDomains: [],
    setupComplete: true,
    ...overrides,
  };
}

describe("evaluateTabs", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("does nothing for a tab below warning threshold", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = { "1": now - 30_000 }; // 30s old
    store.warnedTabs = {};

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    const result = await evaluateTabs();

    expect(result.warningCount).toBe(0);
    expect(result.newWarnings).toHaveLength(0);
    expect(result.autoClosedTabs).toHaveLength(0);
    expect(removedTabIds).toHaveLength(0);
    expect(store.warnedTabs).toEqual({});
  });

  it("warns a tab that crosses the warning threshold", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = { "1": now - 70_000 }; // 70s old (>60s warn)
    store.warnedTabs = {};

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    const result = await evaluateTabs();

    expect(result.warningCount).toBe(1);
    expect(result.newWarnings).toHaveLength(1);
    expect(result.autoClosedTabs).toHaveLength(0);
    expect(removedTabIds).toHaveLength(0);
    expect(store.warnedTabs["1"]).toBeDefined();
  });

  it("does NOT close a tab that crosses close threshold but was never warned", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = { "1": now - 130_000 }; // 130s old (>120s close)
    store.warnedTabs = {}; // never warned

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    const result = await evaluateTabs();

    // Should warn (not close) on this cycle
    expect(result.newWarnings).toHaveLength(1);
    expect(result.autoClosedTabs).toHaveLength(0);
    expect(removedTabIds).toHaveLength(0);
    expect(store.warnedTabs["1"]).toBeDefined();
  });

  it("closes a tab that crosses close threshold AND was previously warned", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = { "1": now - 130_000 };
    store.warnedTabs = { "1": now - 60_000 }; // warned 60s ago

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    const result = await evaluateTabs();

    expect(result.autoClosedTabs).toHaveLength(1);
    expect(removedTabIds).toEqual([1]);
  });

  it("simulates two consecutive evaluations: warn then close", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = { "1": now - 130_000 };
    store.warnedTabs = {};

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    // First evaluation: should warn, not close
    const r1 = await evaluateTabs();
    expect(r1.newWarnings).toHaveLength(1);
    expect(r1.autoClosedTabs).toHaveLength(0);
    expect(removedTabIds).toHaveLength(0);

    // Second evaluation: should now close (warnedTabs persisted from first eval)
    const r2 = await evaluateTabs();
    expect(r2.autoClosedTabs).toHaveLength(1);
    expect(removedTabIds).toEqual([1]);
  });

  it("does not close an exception-domain tab even past close threshold", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2, exceptionDomains: ["example.com"] });
    store.tabOpenedAt = { "1": now - 200_000 };
    store.warnedTabs = { "1": now - 100_000 };

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    const result = await evaluateTabs();

    expect(result.autoClosedTabs).toHaveLength(0);
    expect(removedTabIds).toHaveLength(0);
  });

  it("tracks soonestEventMs for tabs not yet at warning threshold", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = { "1": now - 20_000 }; // 20s old, 40s until warning
    store.warnedTabs = {};

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    const result = await evaluateTabs();

    expect(result.soonestEventMs).toBeGreaterThan(0);
    expect(result.soonestEventMs).toBeLessThanOrEqual(40_000);
  });

  it("tracks soonestCloseMs for warned tabs approaching close", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = { "1": now - 90_000 }; // 90s old, 30s until close
    store.warnedTabs = { "1": now - 30_000 };

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    const result = await evaluateTabs();

    expect(result.soonestCloseMs).toBeGreaterThan(0);
    expect(result.soonestCloseMs).toBeLessThanOrEqual(30_000);
  });

  it("does not track chrome:// or grouped tabs", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = {};
    store.warnedTabs = {};

    chrome.tabs.query.mockResolvedValue([
      { id: 1, url: "chrome://extensions", groupId: -1 },
      { id: 2, url: "https://example.com", groupId: 5 },
    ]);

    const result = await evaluateTabs();

    expect(result.warningCount).toBe(0);
    expect(store.tabOpenedAt["1"]).toBeUndefined();
    expect(store.tabOpenedAt["2"]).toBeUndefined();
  });

  it("cleans up stale tabOpenedAt / warnedTabs entries for closed tabs", async () => {
    const now = Date.now();
    setSettings({ warningMinutes: 1, closeMinutes: 2 });
    store.tabOpenedAt = { "1": now - 10_000, "999": now - 50_000 };
    store.warnedTabs = { "999": now - 20_000 };

    chrome.tabs.query.mockResolvedValue([makeTab(1)]);

    await evaluateTabs();

    expect(store.tabOpenedAt["999"]).toBeUndefined();
    expect(store.warnedTabs["999"]).toBeUndefined();
  });
});
