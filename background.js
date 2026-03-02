import { STORAGE_KEYS, getStorage, setStorage } from "./bg/storage.js";
import { getSettings } from "./bg/settings.js";
import { shouldTrackUrl, matchesDomainList } from "./bg/utils.js";
import { focusTabById, updateActiveTabIndicator, updateBadge } from "./bg/notifications.js";
import { bootstrapExistingTabs, evaluateTabs } from "./bg/tabs.js";

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
    if (!tab.id || !shouldTrackUrl(tab.url)) continue;
    const key = String(tab.id);
    if (!warnedTabs[key]) continue;

    warningCount += 1;
    const isException = matchesDomainList(tab.url, exceptionDomains);
    if (isException) continue;

    const openedAt = tabOpenedAt[key];
    if (!openedAt) continue;

    const remaining = closeMs - (now - openedAt);
    if (remaining > 0 && (soonestCloseMs === null || remaining < soonestCloseMs)) {
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

async function initializeState() {
  const data = await getStorage([STORAGE_KEYS.tabOpenedAt, STORAGE_KEYS.warnedTabs]);

  if (!data.tabOpenedAt) {
    await setStorage({ [STORAGE_KEYS.tabOpenedAt]: {} });
  }

  if (!data.warnedTabs) {
    await setStorage({ [STORAGE_KEYS.warnedTabs]: {} });
  }

  await bootstrapExistingTabs();
  await scheduleAlarm();
  await evaluateTabs();
  const soonestCloseMs = await refreshBadgeCountdown();
  await manageCountdownAlarm(soonestCloseMs);
}

chrome.runtime.onInstalled.addListener(async () => {
  await initializeState();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeState();
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id || !shouldTrackUrl(tab.url)) return;

  const data = await getStorage(STORAGE_KEYS.tabOpenedAt);
  const tabOpenedAt = data.tabOpenedAt || {};
  tabOpenedAt[String(tab.id)] = Date.now();
  await setStorage({ [STORAGE_KEYS.tabOpenedAt]: tabOpenedAt });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!shouldTrackUrl(tab?.url || changeInfo.url)) return;

  const data = await getStorage(STORAGE_KEYS.tabOpenedAt);
  const tabOpenedAt = data.tabOpenedAt || {};
  if (!tabOpenedAt[String(tabId)]) {
    tabOpenedAt[String(tabId)] = Date.now();
    await setStorage({ [STORAGE_KEYS.tabOpenedAt]: tabOpenedAt });
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
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateActiveTabIndicator(activeInfo.tabId);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tab-sweeper-countdown") {
    const soonestCloseMs = await refreshBadgeCountdown();
    await manageCountdownAlarm(soonestCloseMs);
    return;
  }
  if (alarm.name !== "tab-sweeper-check") return;
  await evaluateTabs();
  const soonestCloseMs = await refreshBadgeCountdown();
  await manageCountdownAlarm(soonestCloseMs);
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === "active") {
    await evaluateTabs();
    const soonestCloseMs = await refreshBadgeCountdown();
    await manageCountdownAlarm(soonestCloseMs);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "runSweepNow") {
    evaluateTabs()
      .then(() => refreshBadgeCountdown())
      .then((ms) => manageCountdownAlarm(ms))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "settingsUpdated") {
    scheduleAlarm()
      .then(() => evaluateTabs())
      .then(() => refreshBadgeCountdown())
      .then((ms) => manageCountdownAlarm(ms))
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
