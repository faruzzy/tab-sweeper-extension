import { DEFAULT_SETTINGS, STORAGE_KEYS, getStorage, setStorage } from "./storage.js";

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

export async function getSettings() {
  const data = await getStorage(STORAGE_KEYS.settings);
  const normalized = normalizeSettings(data.settings || {});

  // Persist normalized settings so old installs migrate once.
  await setStorage({ [STORAGE_KEYS.settings]: normalized });
  return normalized;
}
