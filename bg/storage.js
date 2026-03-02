export const DEFAULT_SETTINGS = {
  warningMinutes: 1,
  closeMinutes: 5,
  sweepSeconds: 30,
  warningDuration: { days: 0, hours: 0, minutes: 1 },
  closeDuration: { days: 0, hours: 0, minutes: 5 },
  exceptionDomains: [],
};

export const STORAGE_KEYS = {
  settings: "settings",
  tabOpenedAt: "tabOpenedAt",
  warnedTabs: "warnedTabs",
  savedTabs: "savedTabs",
};

export async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

export async function setStorage(data) {
  return chrome.storage.local.set(data);
}
