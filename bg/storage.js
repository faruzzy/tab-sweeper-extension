export function computeSweepInterval(closeMinutes, warningMinutes) {
  const fromClose = Math.floor((closeMinutes * 60) / 20);
  if (typeof warningMinutes === "number" && warningMinutes > 0 && warningMinutes < closeMinutes) {
    const windowSec = (closeMinutes - warningMinutes) * 60;
    const fromWindow = Math.floor(windowSec / 3);
    return Math.max(30, Math.min(300, Math.min(fromClose, fromWindow)));
  }
  return Math.max(30, Math.min(300, fromClose));
}

export const DEFAULT_SETTINGS = {
  warningMinutes: 1,
  closeMinutes: 5,
  sweepSeconds: 30,
  warningDuration: { days: 0, hours: 0, minutes: 1 },
  closeDuration: { days: 0, hours: 0, minutes: 5 },
  exceptionDomains: [],
  setupComplete: false,
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
