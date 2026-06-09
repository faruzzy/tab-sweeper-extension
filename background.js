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
import { bootstrapExistingTabs, evaluateTabs, getTabMetadata } from "./bg/tabs.js";

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

  const warningMs = settings.warningMinutes * 60 * 1000;
  const closeMs = settings.closeMinutes * 60 * 1000;
  const exceptionDomains = Array.isArray(settings.exceptionDomains) ? settings.exceptionDomains : [];
  const tabOpenedAt = storage.tabOpenedAt || {};
  const warnedTabs = storage.warnedTabs || {};
  const now = Date.now();

  let warningCount = 0;
  let soonestCloseMs = null;
  let soonestWarningMs = null;

  for (const tab of tabs) {
    if (!tab.id || !shouldTrackTab(tab)) continue;
    const key = String(tab.id);

    const isException = matchesDomainList(tab.url, exceptionDomains);
    if (isException) continue;

    const openedAt = tabOpenedAt[key];
    if (!openedAt) continue;

    const ageMs = now - openedAt;

    if (warnedTabs[key]) {
      warningCount += 1;
      const remaining = closeMs - ageMs;
      if (remaining <= 0) {
        soonestCloseMs = 0;
      } else if (soonestCloseMs === null || remaining < soonestCloseMs) {
        soonestCloseMs = remaining;
      }
    } else {
      const untilWarning = warningMs - ageMs;
      if (untilWarning <= 0) {
        soonestWarningMs = 0;
      } else if (soonestWarningMs === null || untilWarning < soonestWarningMs) {
        soonestWarningMs = untilWarning;
      }
    }
  }

  await updateBadge(warningCount, soonestCloseMs);
  return { warningCount, soonestCloseMs, soonestWarningMs };
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
  const data = await getStorage([
    STORAGE_KEYS.tabOpenedAt,
    STORAGE_KEYS.tabMetadata,
    STORAGE_KEYS.warnedTabs,
  ]);

  if (!data.tabOpenedAt) {
    await setStorage({ [STORAGE_KEYS.tabOpenedAt]: {} });
  }

  if (!data.tabMetadata) {
    await setStorage({ [STORAGE_KEYS.tabMetadata]: {} });
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
  const badge = await refreshBadgeCountdown();
  await manageCountdownAlarm(badge.soonestCloseMs);
  await scheduleNextEventAlarm(sweep.soonestEventMs);
  await syncOffscreenLifecycle(badge.warningCount, badge.soonestWarningMs);
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

  const data = await getStorage([STORAGE_KEYS.tabOpenedAt, STORAGE_KEYS.tabMetadata]);
  const tabOpenedAt = data.tabOpenedAt || {};
  const tabMetadata = data.tabMetadata || {};
  tabOpenedAt[String(tab.id)] = Date.now();
  tabMetadata[String(tab.id)] = getTabMetadata(tab);
  await setStorage({
    [STORAGE_KEYS.tabOpenedAt]: tabOpenedAt,
    [STORAGE_KEYS.tabMetadata]: tabMetadata,
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!shouldTrackTab(tab)) return;

  const hasMeaningfulNavigation = typeof changeInfo.url === "string" && changeInfo.url.length > 0;
  const data = await getStorage([
    STORAGE_KEYS.tabOpenedAt,
    STORAGE_KEYS.tabMetadata,
    STORAGE_KEYS.warnedTabs,
  ]);
  const tabOpenedAt = data.tabOpenedAt || {};
  const tabMetadata = data.tabMetadata || {};
  const warnedTabs = data.warnedTabs || {};
  const key = String(tabId);

  let changedOpen = false;
  let changedMetadata = false;
  let changedWarned = false;

  if (!tabOpenedAt[key] || hasMeaningfulNavigation) {
    tabOpenedAt[key] = Date.now();
    changedOpen = true;
  }

  if (!tabMetadata[key] || hasMeaningfulNavigation) {
    tabMetadata[key] = getTabMetadata(tab);
    changedMetadata = true;
  }

  if (hasMeaningfulNavigation && warnedTabs[key]) {
    delete warnedTabs[key];
    changedWarned = true;
  }

  if (changedOpen || changedMetadata || changedWarned) {
    const updates = {};
    if (changedOpen) updates[STORAGE_KEYS.tabOpenedAt] = tabOpenedAt;
    if (changedMetadata) updates[STORAGE_KEYS.tabMetadata] = tabMetadata;
    if (changedWarned) updates[STORAGE_KEYS.warnedTabs] = warnedTabs;
    await setStorage(updates);

    if (changedWarned) {
      await clearTabWarningNotifications(tabId);
    }

    const { soonestCloseMs } = await refreshBadgeCountdown();
    await manageCountdownAlarm(soonestCloseMs);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await getStorage([
    STORAGE_KEYS.tabOpenedAt,
    STORAGE_KEYS.tabMetadata,
    STORAGE_KEYS.warnedTabs,
  ]);
  const tabOpenedAt = data.tabOpenedAt || {};
  const tabMetadata = data.tabMetadata || {};
  const warnedTabs = data.warnedTabs || {};

  const key = String(tabId);
  let changed = false;

  if (tabOpenedAt[key]) {
    delete tabOpenedAt[key];
    changed = true;
  }

  if (tabMetadata[key]) {
    delete tabMetadata[key];
    changed = true;
  }

  if (warnedTabs[key]) {
    delete warnedTabs[key];
    changed = true;
  }

  if (changed) {
    await setStorage({
      [STORAGE_KEYS.tabOpenedAt]: tabOpenedAt,
      [STORAGE_KEYS.tabMetadata]: tabMetadata,
      [STORAGE_KEYS.warnedTabs]: warnedTabs,
    });
    const badge = await refreshBadgeCountdown();
    await manageCountdownAlarm(badge.soonestCloseMs);
    await syncOffscreenLifecycle(badge.warningCount, badge.soonestWarningMs);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateActiveTabIndicator(activeInfo.tabId);
  const badge = await refreshBadgeCountdown();
  await syncOffscreenLifecycle(badge.warningCount, badge.soonestWarningMs);
});

let offscreenCreated = false;
let lastIdleState = "active";
let awaySinceMs = null;

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Per-second badge countdown tick",
    });
    offscreenCreated = true;
  } catch {
    // Document may already exist (e.g. after service worker restart).
    offscreenCreated = true;
  }
}

async function closeOffscreen() {
  if (!offscreenCreated) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Already closed.
  }
  offscreenCreated = false;
}

async function syncOffscreenLifecycle(warningCount, soonestWarningMs) {
  const hasWarnings = warningCount > 0;
  const warningImminent = typeof soonestWarningMs === "number" && soonestWarningMs <= 60000;
  if (hasWarnings || warningImminent) {
    await ensureOffscreen();
  } else {
    await closeOffscreen();
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tab-sweeper-countdown") {
    const badge = await refreshBadgeCountdown();
    if (badge.soonestCloseMs !== null && badge.soonestCloseMs <= 0) {
      const sweep = await evaluateTabs();
      const updated = await refreshBadgeCountdown();
      await manageCountdownAlarm(updated.soonestCloseMs);
      await scheduleNextEventAlarm(sweep.soonestEventMs);
      await syncOffscreenLifecycle(updated.warningCount, updated.soonestWarningMs);
    } else {
      await manageCountdownAlarm(badge.soonestCloseMs);
      await syncOffscreenLifecycle(badge.warningCount, badge.soonestWarningMs);
    }
    return;
  }
  if (alarm.name !== "tab-sweeper-check" && alarm.name !== "tab-sweeper-next-event") return;
  const settings = await getSettings();
  if (!settings.setupComplete) return;
  const sweep = await evaluateTabs();
  const alarmBadge = await refreshBadgeCountdown();
  await manageCountdownAlarm(alarmBadge.soonestCloseMs);
  await scheduleNextEventAlarm(sweep.soonestEventMs);
  await syncOffscreenLifecycle(alarmBadge.warningCount, alarmBadge.soonestWarningMs);
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
    const idleBadge = await refreshBadgeCountdown();
    await manageCountdownAlarm(idleBadge.soonestCloseMs);
    await scheduleNextEventAlarm(sweep.soonestEventMs);
    await syncOffscreenLifecycle(idleBadge.warningCount, idleBadge.soonestWarningMs);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "offscreenTick") {
    (async () => {
      const badge = await refreshBadgeCountdown();
      const needsEval =
        (typeof badge.soonestCloseMs === "number" && badge.soonestCloseMs <= 0) ||
        (typeof badge.soonestWarningMs === "number" && badge.soonestWarningMs <= 0);
      if (needsEval) {
        const sweep = await evaluateTabs();
        const updated = await refreshBadgeCountdown();
        await manageCountdownAlarm(updated.soonestCloseMs);
        await scheduleNextEventAlarm(sweep.soonestEventMs);
        await syncOffscreenLifecycle(updated.warningCount, updated.soonestWarningMs);
      } else {
        await syncOffscreenLifecycle(badge.warningCount, badge.soonestWarningMs);
      }
    })();
    return false;
  }

  if (message?.type === "runSweepNow") {
    let sweep;
    getSettings()
      .then((settings) => {
        if (!settings.setupComplete) throw new Error("Setup not completed yet.");
        return evaluateTabs();
      })
      .then((s) => { sweep = s; return refreshBadgeCountdown(); })
      .then((badge) => {
        return manageCountdownAlarm(badge.soonestCloseMs)
          .then(() => syncOffscreenLifecycle(badge.warningCount, badge.soonestWarningMs));
      })
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
      .then((badge) => {
        return manageCountdownAlarm(badge.soonestCloseMs)
          .then(() => syncOffscreenLifecycle(badge.warningCount, badge.soonestWarningMs));
      })
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
