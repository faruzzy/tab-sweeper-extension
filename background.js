const DEFAULT_SETTINGS = {
  warningMinutes: 1,
  closeMinutes: 5,
  sweepSeconds: 30,
  warningDuration: { days: 0, hours: 0, minutes: 1 },
  closeDuration: { days: 0, hours: 0, minutes: 5 },
  exceptionDomains: [],
};

const STORAGE_KEYS = {
  settings: "settings",
  tabOpenedAt: "tabOpenedAt",
  warnedTabs: "warnedTabs",
  savedTabs: "savedTabs",
};

async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function setStorage(data) {
  return chrome.storage.local.set(data);
}

function normalizeSettings(rawSettings = {}) {
  const durationToMinutes = (duration) => {
    if (!duration || typeof duration !== "object") return null;
    const days = Math.max(0, Math.floor(Number(duration.days) || 0));
    const hours = Math.max(0, Math.floor(Number(duration.hours) || 0));
    const minutes = Math.max(0, Math.floor(Number(duration.minutes) || 0));
    return days * 24 * 60 + hours * 60 + minutes;
  };

  const minutesToDuration = (totalMinutes) => {
    const total = Math.max(1, Math.floor(Number(totalMinutes) || 1));
    const days = Math.floor(total / (24 * 60));
    const remainderAfterDays = total % (24 * 60);
    const hours = Math.floor(remainderAfterDays / 60);
    const minutes = remainderAfterDays % 60;
    return { days, hours, minutes };
  };

  const warningMinutes = Number(
    durationToMinutes(rawSettings.warningDuration) ??
      rawSettings.warningMinutes ??
      (Number.isFinite(Number(rawSettings.warningHours)) ? Number(rawSettings.warningHours) * 60 : undefined) ??
      DEFAULT_SETTINGS.warningMinutes
  );

  const closeMinutes = Number(
    durationToMinutes(rawSettings.closeDuration) ??
      rawSettings.closeMinutes ??
      (Number.isFinite(Number(rawSettings.closeHours)) ? Number(rawSettings.closeHours) * 60 : undefined) ??
      DEFAULT_SETTINGS.closeMinutes
  );

  const sweepSeconds = Number(
    rawSettings.sweepSeconds ??
      (Number.isFinite(Number(rawSettings.alarmMinutes)) ? Number(rawSettings.alarmMinutes) * 60 : undefined) ??
      DEFAULT_SETTINGS.sweepSeconds
  );

  const legacyTracked = Array.isArray(rawSettings.trackedDomains) ? rawSettings.trackedDomains : [];
  const exceptionDomains = Array.isArray(rawSettings.exceptionDomains)
    ? rawSettings.exceptionDomains
    : legacyTracked;

  const normalizedWarningMinutes = Math.max(1, warningMinutes || DEFAULT_SETTINGS.warningMinutes);
  const normalizedCloseMinutes = Math.max(1, closeMinutes || DEFAULT_SETTINGS.closeMinutes);

  return {
    warningMinutes: normalizedWarningMinutes,
    closeMinutes: normalizedCloseMinutes,
    warningDuration: minutesToDuration(normalizedWarningMinutes),
    closeDuration: minutesToDuration(normalizedCloseMinutes),
    sweepSeconds: Math.max(30, sweepSeconds || DEFAULT_SETTINGS.sweepSeconds),
    exceptionDomains,
  };
}

async function getSettings() {
  const data = await getStorage(STORAGE_KEYS.settings);
  const normalized = normalizeSettings(data.settings || {});

  // Persist normalized settings so old installs migrate once.
  await setStorage({ [STORAGE_KEYS.settings]: normalized });
  return normalized;
}

function normalizeHostname(urlString) {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function shouldTrackUrl(urlString) {
  if (!urlString) return false;
  return urlString.startsWith("http://") || urlString.startsWith("https://");
}

function matchesDomainList(urlString, domains) {
  const host = normalizeHostname(urlString);
  if (!host) return false;

  return domains.some((domain) => {
    const target = String(domain || "").toLowerCase().replace(/^www\./, "").trim();
    if (!target) return false;
    return host === target || host.endsWith(`.${target}`);
  });
}

function getTabLabel(tab) {
  const rawTitle = String(tab?.title || "").trim();
  const hostname = normalizeHostname(tab?.url || "");

  const label =
    rawTitle && rawTitle.toLowerCase() !== hostname.toLowerCase()
      ? rawTitle
      : rawTitle || tab?.url || "Untitled tab";

  return {
    label,
    hostname,
  };
}

function formatAge(minutesOpen) {
  return minutesOpen >= 60
    ? `${(minutesOpen / 60).toFixed(1)}h`
    : `${Math.max(1, Math.round(minutesOpen))}m`;
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

async function bootstrapExistingTabs() {
  const tabs = await chrome.tabs.query({});
  const data = await getStorage(STORAGE_KEYS.tabOpenedAt);
  const tabOpenedAt = data.tabOpenedAt || {};
  const now = Date.now();
  let changed = false;

  for (const tab of tabs) {
    if (!tab.id || !shouldTrackUrl(tab.url)) continue;
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

async function scheduleAlarm() {
  const settings = await getSettings();
  const periodInMinutes = Math.max(0.5, settings.sweepSeconds / 60);
  await chrome.alarms.clear("tab-sweeper-check");
  await chrome.alarms.create("tab-sweeper-check", { periodInMinutes });
}

async function saveClosedTab(entry) {
  const data = await getStorage(STORAGE_KEYS.savedTabs);
  const savedTabs = Array.isArray(data.savedTabs) ? data.savedTabs : [];

  savedTabs.unshift(entry);
  const bounded = savedTabs.slice(0, 1000);
  await setStorage({ [STORAGE_KEYS.savedTabs]: bounded });
}

async function updateBadge(warningCount) {
  if (warningCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
    await chrome.action.setBadgeText({ text: String(Math.min(warningCount, 99)) });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

async function focusTabById(tabId) {
  if (!Number.isInteger(tabId)) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });

    if (typeof tab.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    // Tab may have been closed before navigation attempt.
  }
}

async function notifyOldTab(tab, minutesOpen) {
  if (!tab.id) return;

  const { label, hostname } = getTabLabel(tab);
  const where = hostname ? ` (${hostname})` : "";
  const age = formatAge(minutesOpen);

  await chrome.notifications.create(`old-tab-${tab.id}-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Tab Sweeper: old tab warning",
    message: `${label}${where} has been open for ${age}. Click to jump to this tab.`,
    priority: 1,
  });
}

async function notifyOldTabs(newWarnings) {
  if (!Array.isArray(newWarnings) || newWarnings.length === 0) return;

  if (newWarnings.length === 1) {
    try {
      await notifyOldTab(newWarnings[0].tab, newWarnings[0].minutesOpen);
    } catch {
      // Ignore notification delivery failures for individual tabs.
    }
    return;
  }

  const first = newWarnings[0];
  const preview = newWarnings
    .slice(0, 3)
    .map((item) => {
      const { label } = getTabLabel(item.tab);
      return label;
    })
    .join(" | ");

  const extra = newWarnings.length > 3 ? ` +${newWarnings.length - 3} more` : "";
  const message = `${newWarnings.length} tabs crossed the warning threshold. ${preview}${extra}. Click to open one.`;

  try {
    await chrome.notifications.create(`old-tabs-batch-${first.tab.id}-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "Tab Sweeper: multiple old tabs",
      message,
      priority: 1,
    });
  } catch {
    // Ignore notification delivery failures for batch notifications.
  }
}

async function evaluateTabs() {
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

  const liveTabIds = new Set();
  const newWarnings = [];

  for (const tab of tabs) {
    if (!tab.id || !shouldTrackUrl(tab.url)) continue;

    const key = String(tab.id);
    liveTabIds.add(key);

    if (!tabOpenedAt[key]) {
      tabOpenedAt[key] = now;
      changedOpen = true;
    }

    const openedAt = tabOpenedAt[key];
    const ageMs = now - openedAt;

    if (ageMs >= warningMs) {
      warningCount += 1;
      if (!warnedTabs[key]) {
        warnedTabs[key] = now;
        changedWarned = true;
        newWarnings.push({ tab, minutesOpen: ageMs / (1000 * 60) });
      }
    }

    const isException = matchesDomainList(tab.url, exceptionDomains);
    if (ageMs >= closeMs && !isException) {
      await saveClosedTab({
        id: crypto.randomUUID(),
        url: tab.url,
        title: tab.title || tab.url,
        openedAt,
        closedAt: now,
        reason: "time-limit-non-exception-domain",
      });

      await chrome.tabs.remove(tab.id);
      delete tabOpenedAt[key];
      delete warnedTabs[key];
      changedOpen = true;
      changedWarned = true;
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

  await updateBadge(warningCount);
  await notifyOldTabs(newWarnings);

  const updates = {};
  if (changedOpen) updates[STORAGE_KEYS.tabOpenedAt] = tabOpenedAt;
  if (changedWarned) updates[STORAGE_KEYS.warnedTabs] = warnedTabs;

  if (Object.keys(updates).length > 0) {
    await setStorage(updates);
  }
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
