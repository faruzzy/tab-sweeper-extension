import { STORAGE_KEYS, getStorage, setStorage } from "./bg/storage.js";
import { getSettings } from "./bg/settings.js";
import { shouldTrackUrl } from "./bg/utils.js";
import { focusTabById } from "./bg/notifications.js";
import { bootstrapExistingTabs, evaluateTabs } from "./bg/tabs.js";

async function scheduleAlarm() {
  const settings = await getSettings();
  const periodInMinutes = Math.max(0.5, settings.sweepSeconds / 60);
  await chrome.alarms.clear("tab-sweeper-check");
  await chrome.alarms.create("tab-sweeper-check", { periodInMinutes });
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

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "tab-sweeper-check") return;
  await evaluateTabs();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "runSweepNow") {
    evaluateTabs()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "settingsUpdated") {
    scheduleAlarm()
      .then(() => evaluateTabs())
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
