import { STORAGE_KEYS, getStorage, setStorage } from "./storage.js";
import { getSettings } from "./settings.js";
import { shouldTrackTab, matchesDomainList } from "./utils.js";
import { updateBadge, notifyOldTabs, updateActiveTabIndicator } from "./notifications.js";

export async function saveClosedTab(entry) {
  const data = await getStorage(STORAGE_KEYS.savedTabs);
  const savedTabs = Array.isArray(data.savedTabs) ? data.savedTabs : [];

  savedTabs.unshift(entry);
  const bounded = savedTabs.slice(0, 1000);
  await setStorage({ [STORAGE_KEYS.savedTabs]: bounded });
}

export async function bootstrapExistingTabs() {
  const tabs = await chrome.tabs.query({});
  const data = await getStorage(STORAGE_KEYS.tabOpenedAt);
  const tabOpenedAt = data.tabOpenedAt || {};
  const now = Date.now();
  let changed = false;

  for (const tab of tabs) {
    if (!tab.id || !shouldTrackTab(tab)) continue;
    const key = String(tab.id);
    if (!tabOpenedAt[key]) {
      tabOpenedAt[key] = now;
      changed = true;
    }
  }

  if (changed) {
    await setStorage({ [STORAGE_KEYS.tabOpenedAt]: tabOpenedAt });
  }
}

export async function evaluateTabs(options = {}) {
  const notifyWarnings = options.notifyWarnings !== false;
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
  let changedOpen = false;
  let changedWarned = false;
  let soonestCloseMs = null;
  let soonestEventMs = null;

  const liveTabIds = new Set();
  const newWarnings = [];
  const warnedOpenTabs = [];
  const autoClosedTabs = [];
  const previouslyWarned = new Set(Object.keys(warnedTabs));

  for (const tab of tabs) {
    if (!tab.id || !shouldTrackTab(tab)) continue;

    const key = String(tab.id);
    liveTabIds.add(key);

    if (!tabOpenedAt[key]) {
      tabOpenedAt[key] = now;
      changedOpen = true;
    }

    const openedAt = tabOpenedAt[key];
    const ageMs = now - openedAt;

    const isException = matchesDomainList(tab.url, exceptionDomains);

    if (ageMs >= closeMs && !isException && previouslyWarned.has(key)) {
      const entry = {
        id: crypto.randomUUID(),
        url: tab.url,
        title: tab.title || tab.url,
        openedAt,
        closedAt: now,
        reason: "time-limit-non-exception-domain",
      };

      await saveClosedTab(entry);

      autoClosedTabs.push({
        tab: { title: entry.title, url: entry.url },
        minutesOpen: ageMs / (1000 * 60),
      });

      await chrome.tabs.remove(tab.id);
      delete tabOpenedAt[key];
      delete warnedTabs[key];
      changedOpen = true;
      changedWarned = true;
      continue;
    }

    if (ageMs >= warningMs) {
      if (!warnedTabs[key]) {
        warnedTabs[key] = now;
        changedWarned = true;
        newWarnings.push({ tab, minutesOpen: ageMs / (1000 * 60) });
      }

      if (!isException) {
        warningCount += 1;
        warnedOpenTabs.push({ tab, minutesOpen: ageMs / (1000 * 60) });

        const remaining = closeMs - ageMs;
        if (remaining <= 0) {
          soonestCloseMs = 0;
        } else if (soonestCloseMs === null || remaining < soonestCloseMs) {
          soonestCloseMs = remaining;
        }
      }
    } else if (!isException) {
      const untilWarning = warningMs - ageMs;
      if (untilWarning > 0 && (soonestEventMs === null || untilWarning < soonestEventMs)) {
        soonestEventMs = untilWarning;
      }
    }
  }

  for (const key of Object.keys(tabOpenedAt)) {
    if (!liveTabIds.has(key)) {
      delete tabOpenedAt[key];
      changedOpen = true;
    }
  }

  for (const key of Object.keys(warnedTabs)) {
    if (!liveTabIds.has(key)) {
      delete warnedTabs[key];
      changedWarned = true;
    }
  }

  await updateBadge(warningCount, soonestCloseMs);
  if (notifyWarnings) {
    await notifyOldTabs(newWarnings);
  }

  const updates = {};
  if (changedOpen) updates[STORAGE_KEYS.tabOpenedAt] = tabOpenedAt;
  if (changedWarned) updates[STORAGE_KEYS.warnedTabs] = warnedTabs;

  if (Object.keys(updates).length > 0) {
    await setStorage(updates);
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    await updateActiveTabIndicator(activeTab.id);
  }

  if (soonestCloseMs !== null && (soonestEventMs === null || soonestCloseMs < soonestEventMs)) {
    soonestEventMs = soonestCloseMs;
  }

  return {
    warningCount,
    soonestCloseMs,
    soonestEventMs,
    newWarnings,
    warnedOpenTabs,
    autoClosedTabs,
  };
}
