import { STORAGE_KEYS, getStorage, setStorage } from "./bg/storage.js";
import { getSettings } from "./bg/settings.js";
import { shouldTrackTab, matchesDomainList } from "./bg/utils.js";
import {
  clearTabWarningNotifications,
  focusTabById,
  notifyWakeAutoClosedSummary,
  notifyWakeWarningSummary,
  updateActiveTabIndicator,
  updateBadge,
} from "./bg/notifications.js";
import { bootstrapExistingTabs, evaluateTabs } from "./bg/tabs.js";

const WAKE_CATCH_UP_MIN_AWAY_MS = 5 * 60 * 1000;

async function scheduleAlarm() {
  const settings = await getSettings();
  const periodInMinutes = Math.max(0.5, settings.sweepSeconds / 60);
  await chrome.alarms.clear("tab-sweeper-check");
  await chrome.alarms.create("tab-sweeper-check", { periodInMinutes });
}

async function refreshBadgeCountdown() {
  const [settings, storage, tabs] = await Promise.all([
    getSettings(),
    getStorage([STORAGE_KEYS.tabOpenedAt, STORAGE_KEYS.warnedTabs]),
    chrome.tabs.query({}),
  ]);

  const closeMs = settings.closeMinutes * 60 * 1000;
  const exceptionDomains = Array.isArray(settings.exceptionDomains) ? settings.exceptionDomains : [];
  const tabOpenedAt = storage.tabOpenedAt || {};
  const warnedTabs = storage.warnedTabs || {};
  const now = Date.now();

  let warningCount = 0;
  let soonestCloseMs = null;

  for (const tab of tabs) {
    if (!tab.id || !shouldTrackTab(tab)) continue;
    const key = String(tab.id);
    if (!warnedTabs[key]) continue;

    const isException = matchesDomainList(tab.url, exceptionDomains);
    if (isException) continue;

    warningCount += 1;

    const openedAt = tabOpenedAt[key];
    if (!openedAt) continue;

    const remaining = closeMs - (now - openedAt);
    if (remaining <= 0) {
      soonestCloseMs = 0;
    } else if (soonestCloseMs === null || remaining < soonestCloseMs) {
      soonestCloseMs = remaining;
    }
  }

  await updateBadge(warningCount, soonestCloseMs);
  return soonestCloseMs;
}

async function manageCountdownAlarm(soonestCloseMs) {
  const inCountdownZone = typeof soonestCloseMs === "number" && soonestCloseMs > 0 && soonestCloseMs <= 300000;
  const existing = await chrome.alarms.get("tab-sweeper-countdown");

  if (inCountdownZone && !existing) {
    await chrome.alarms.create("tab-sweeper-countdown", { periodInMinutes: 0.5 });
  } else if (!inCountdownZone && existing) {
    await chrome.alarms.clear("tab-sweeper-countdown");
  }
}

async function scheduleNextEventAlarm(soonestEventMs) {
  await chrome.alarms.clear("tab-sweeper-next-event");
  if (typeof soonestEventMs === "number" && soonestEventMs > 0) {
    const delayMinutes = Math.max(0.5, soonestEventMs / 60000);
    await chrome.alarms.create("tab-sweeper-next-event", { delayInMinutes: delayMinutes });
  }
}

async function initializeStorage() {
  const data = await getStorage([STORAGE_KEYS.tabOpenedAt, STORAGE_KEYS.warnedTabs]);

  if (!data.tabOpenedAt) {
    await setStorage({ [STORAGE_KEYS.tabOpenedAt]: {} });
  }

  if (!data.warnedTabs) {
    await setStorage({ [STORAGE_KEYS.warnedTabs]: {} });
  }
}

async function initializeState() {
  await initializeStorage();

  const settings = await getSettings();
  if (!settings.setupComplete) return;

  await bootstrapExistingTabs();
  await scheduleAlarm();
  const sweep = await evaluateTabs();
  const soonestCloseMs = await refreshBadgeCountdown();
  await manageCountdownAlarm(soonestCloseMs);
  await scheduleNextEventAlarm(sweep.soonestEventMs);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await initializeStorage();
    await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
    return;
  }

  if (details.reason === "update") {
    const data = await getStorage(STORAGE_KEYS.settings);
    const existing = data.settings || {};
    if (existing.setupComplete !== true) {
      existing.setupComplete = true;
      await setStorage({ [STORAGE_KEYS.settings]: existing });
    }
  }

  await initializeState();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeState();
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id || !shouldTrackTab(tab)) return;

  const data = await getStorage(STORAGE_KEYS.tabOpenedAt);
  const tabOpenedAt = data.tabOpenedAt || {};
  tabOpenedAt[String(tab.id)] = Date.now();
  await setStorage({ [STORAGE_KEYS.tabOpenedAt]: tabOpenedAt });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!shouldTrackTab(tab)) return;

  const hasMeaningfulNavigation = typeof changeInfo.url === "string" && changeInfo.url.length > 0;
  const data = await getStorage([STORAGE_KEYS.tabOpenedAt, STORAGE_KEYS.warnedTabs]);
  const tabOpenedAt = data.tabOpenedAt || {};
  const warnedTabs = data.warnedTabs || {};
  const key = String(tabId);

  let changedOpen = false;
  let changedWarned = false;

  if (!tabOpenedAt[key] || hasMeaningfulNavigation) {
    tabOpenedAt[key] = Date.now();
    changedOpen = true;
  }

  if (hasMeaningfulNavigation && warnedTabs[key]) {
    delete warnedTabs[key];
    changedWarned = true;
  }

  if (changedOpen || changedWarned) {
    const updates = {};
    if (changedOpen) updates[STORAGE_KEYS.tabOpenedAt] = tabOpenedAt;
    if (changedWarned) updates[STORAGE_KEYS.warnedTabs] = warnedTabs;
    await setStorage(updates);

    if (changedWarned) {
      await clearTabWarningNotifications(tabId);
    }

    const soonestCloseMs = await refreshBadgeCountdown();
    await manageCountdownAlarm(soonestCloseMs);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await getStorage([STORAGE_KEYS.tabOpenedAt, STORAGE_KEYS.warnedTabs]);
  const tabOpenedAt = data.tabOpenedAt || {};
  const warnedTabs = data.warnedTabs || {};

  const key = String(tabId);
  let changed = false;

  if (tabOpenedAt[key]) {
    delete tabOpenedAt[key];
    changed = true;
  }

  if (warnedTabs[key]) {
    delete warnedTabs[key];
    changed = true;
  }

  if (changed) {
    await setStorage({
      [STORAGE_KEYS.tabOpenedAt]: tabOpenedAt,
      [STORAGE_KEYS.warnedTabs]: warnedTabs,
    });
    const soonestCloseMs = await refreshBadgeCountdown();
    await manageCountdownAlarm(soonestCloseMs);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateActiveTabIndicator(activeInfo.tabId);
  await refreshBadgeCountdown();
});

let badgeTickInterval = null;
let activePorts = 0;
let lastIdleState = "active";
let awaySinceMs = null;

function startBadgeTick() {
  if (badgeTickInterval) return;
  badgeTickInterval = setInterval(async () => {
    const soonestCloseMs = await refreshBadgeCountdown();
    if (typeof soonestCloseMs === "number" && soonestCloseMs <= 0) {
      const sweep = await evaluateTabs();
      const updated = await refreshBadgeCountdown();
      await manageCountdownAlarm(updated);
      await scheduleNextEventAlarm(sweep.soonestEventMs);
    }
  }, 1000);
}

function stopBadgeTick() {
  if (badgeTickInterval) {
    clearInterval(badgeTickInterval);
    badgeTickInterval = null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keepalive") return;
  activePorts += 1;
  startBadgeTick();

  port.onDisconnect.addListener(() => {
    activePorts -= 1;
    if (activePorts <= 0) {
      activePorts = 0;
      stopBadgeTick();
    }
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tab-sweeper-countdown") {
    const soonestCloseMs = await refreshBadgeCountdown();
    if (soonestCloseMs !== null && soonestCloseMs <= 0) {
      const sweep = await evaluateTabs();
      const updated = await refreshBadgeCountdown();
      await manageCountdownAlarm(updated);
      await scheduleNextEventAlarm(sweep.soonestEventMs);
    } else {
      await manageCountdownAlarm(soonestCloseMs);
    }
    return;
  }
  if (alarm.name !== "tab-sweeper-check" && alarm.name !== "tab-sweeper-next-event") return;
  const settings = await getSettings();
  if (!settings.setupComplete) return;
  const sweep = await evaluateTabs();
  const soonestCloseMs = await refreshBadgeCountdown();
  await manageCountdownAlarm(soonestCloseMs);
  await scheduleNextEventAlarm(sweep.soonestEventMs);
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === "idle" || newState === "locked") {
    if (awaySinceMs === null) {
      awaySinceMs = Date.now();
    }
    lastIdleState = newState;
    return;
  }

  if (newState === "active") {
    const settings = await getSettings();
    if (!settings.setupComplete) return;

    const wasAway = lastIdleState === "idle" || lastIdleState === "locked";
    const awayMs = awaySinceMs === null ? 0 : Date.now() - awaySinceMs;
    const shouldSendCatchUp = wasAway && awayMs >= WAKE_CATCH_UP_MIN_AWAY_MS;

    const sweep = await evaluateTabs({ notifyWarnings: !shouldSendCatchUp });

    if (shouldSendCatchUp) {
      await notifyWakeWarningSummary(sweep.warnedOpenTabs);
      await notifyWakeAutoClosedSummary(sweep.autoClosedTabs);
    }

    awaySinceMs = null;
    lastIdleState = "active";
    const soonestCloseMs = await refreshBadgeCountdown();
    await manageCountdownAlarm(soonestCloseMs);
    await scheduleNextEventAlarm(sweep.soonestEventMs);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "runSweepNow") {
    let sweep;
    getSettings()
      .then((settings) => {
        if (!settings.setupComplete) throw new Error("Setup not completed yet.");
        return evaluateTabs();
      })
      .then((s) => { sweep = s; return refreshBadgeCountdown(); })
      .then((ms) => manageCountdownAlarm(ms))
      .then(() => scheduleNextEventAlarm(sweep?.soonestEventMs))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "settingsUpdated") {
    let sweep;
    scheduleAlarm()
      .then(() => evaluateTabs())
      .then((s) => { sweep = s; return refreshBadgeCountdown(); })
      .then((ms) => manageCountdownAlarm(ms))
      .then(() => scheduleNextEventAlarm(sweep?.soonestEventMs))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  let tabId = null;

  let match = /^old-tab-(\d+)-/.exec(notificationId);
  if (match) {
    tabId = Number(match[1]);
  } else {
    match = /^old-tabs-batch-(\d+)-/.exec(notificationId);
    if (match) tabId = Number(match[1]);
  }

  if (!Number.isInteger(tabId)) return;

  await focusTabById(tabId);
  await chrome.notifications.clear(notificationId);
});
