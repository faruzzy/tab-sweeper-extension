const DEFAULT_SETTINGS = {
  warningMinutes: 1,
  closeMinutes: 5,
  warningDuration: { days: 0, hours: 0, minutes: 1 },
  closeDuration: { days: 0, hours: 0, minutes: 5 },
  exceptionDomains: [],
  setupComplete: false,
};

const warningDaysEl = document.getElementById("warningDays");
const warningHoursEl = document.getElementById("warningHours");
const warningMinutesEl = document.getElementById("warningMinutes");

const closeDaysEl = document.getElementById("closeDays");
const closeHoursEl = document.getElementById("closeHours");
const closeMinutesEl = document.getElementById("closeMinutes");

const getStartedButton = document.getElementById("getStartedButton");
const statusEl = document.getElementById("status");

function parseNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function durationToMinutes(duration) {
  if (!duration || typeof duration !== "object") return null;
  const days = parseNonNegativeInt(duration.days);
  const hours = parseNonNegativeInt(duration.hours);
  const minutes = parseNonNegativeInt(duration.minutes);
  return days * 24 * 60 + hours * 60 + minutes;
}

function minutesToDuration(totalMinutes) {
  const total = Math.max(1, parseNonNegativeInt(totalMinutes));
  const days = Math.floor(total / (24 * 60));
  const remainderAfterDays = total % (24 * 60);
  const hours = Math.floor(remainderAfterDays / 60);
  const minutes = remainderAfterDays % 60;
  return { days, hours, minutes };
}

function readDurationInputs(daysEl, hoursEl, minutesEl, fallbackMinutes) {
  const days = parseNonNegativeInt(daysEl.value);
  const hours = parseNonNegativeInt(hoursEl.value);
  const minutes = parseNonNegativeInt(minutesEl.value);
  const total = days * 24 * 60 + hours * 60 + minutes;
  return minutesToDuration(total > 0 ? total : fallbackMinutes);
}

function setDurationInputs(daysEl, hoursEl, minutesEl, duration) {
  daysEl.value = String(duration.days);
  hoursEl.value = String(duration.hours);
  minutesEl.value = String(duration.minutes);
}

function computeSweepInterval(closeMinutes) {
  const raw = Math.floor((closeMinutes * 60) / 20);
  return Math.max(30, Math.min(300, raw));
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#9f2d2d" : "#1f6f3c";
}

function loadDefaults() {
  setDurationInputs(warningDaysEl, warningHoursEl, warningMinutesEl, DEFAULT_SETTINGS.warningDuration);
  setDurationInputs(closeDaysEl, closeHoursEl, closeMinutesEl, DEFAULT_SETTINGS.closeDuration);
}

async function saveAndStart() {
  const warningDuration = readDurationInputs(
    warningDaysEl, warningHoursEl, warningMinutesEl,
    DEFAULT_SETTINGS.warningMinutes
  );

  const closeDuration = readDurationInputs(
    closeDaysEl, closeHoursEl, closeMinutesEl,
    DEFAULT_SETTINGS.closeMinutes
  );

  const closeMinutes = durationToMinutes(closeDuration);

  const settings = {
    warningDuration,
    closeDuration,
    warningMinutes: durationToMinutes(warningDuration),
    closeMinutes,
    sweepSeconds: computeSweepInterval(closeMinutes),
    exceptionDomains: [],
    setupComplete: true,
  };

  await chrome.storage.local.set({ settings });

  const response = await chrome.runtime.sendMessage({ type: "settingsUpdated" });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to apply settings in background worker.");
  }

  showStatus("Setup complete! Tab Sweeper is now active.");

  setTimeout(() => {
    window.close();
  }, 1500);
}

getStartedButton.addEventListener("click", async () => {
  try {
    await saveAndStart();
  } catch (error) {
    showStatus(String(error), true);
  }
});

loadDefaults();
