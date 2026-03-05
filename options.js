const DEFAULT_SETTINGS = {
  warningMinutes: 1,
  closeMinutes: 5,
  sweepSeconds: 30,
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

const sweepDisplayEl = document.getElementById("sweepDisplay");
const domainForm = document.getElementById("domainForm");
const domainInput = document.getElementById("domainInput");
const domainList = document.getElementById("domainList");
const saveButton = document.getElementById("saveButton");
const sweepButton = document.getElementById("sweepButton");
const statusEl = document.getElementById("status");

let exceptionDomains = [];

function normalizeDomain(value) {
  let domain = String(value || "")
    .toLowerCase()
    .trim();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.split("/")[0];
  return domain;
}

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

function computeSweepInterval(closeMinutes, warningMinutes) {
  const fromClose = Math.floor((closeMinutes * 60) / 20);
  if (typeof warningMinutes === "number" && warningMinutes > 0 && warningMinutes < closeMinutes) {
    const windowSec = (closeMinutes - warningMinutes) * 60;
    const fromWindow = Math.floor(windowSec / 3);
    return Math.max(30, Math.min(300, Math.min(fromClose, fromWindow)));
  }
  return Math.max(30, Math.min(300, fromClose));
}

function normalizeSettings(rawSettings = {}) {
  const warningMinutes = Number(
    durationToMinutes(rawSettings.warningDuration) ??
      rawSettings.warningMinutes ??
      (Number.isFinite(Number(rawSettings.warningHours))
        ? Number(rawSettings.warningHours) * 60
        : undefined) ??
      DEFAULT_SETTINGS.warningMinutes,
  );

  const closeMinutes = Number(
    durationToMinutes(rawSettings.closeDuration) ??
      rawSettings.closeMinutes ??
      (Number.isFinite(Number(rawSettings.closeHours))
        ? Number(rawSettings.closeHours) * 60
        : undefined) ??
      DEFAULT_SETTINGS.closeMinutes,
  );

  const legacyTracked = Array.isArray(rawSettings.trackedDomains)
    ? rawSettings.trackedDomains
    : [];
  const exceptionDomains = Array.isArray(rawSettings.exceptionDomains)
    ? rawSettings.exceptionDomains
    : legacyTracked;

  const normalizedWarningMinutes = Math.max(
    1,
    warningMinutes || DEFAULT_SETTINGS.warningMinutes,
  );
  const normalizedCloseMinutes = Math.max(
    1,
    closeMinutes || DEFAULT_SETTINGS.closeMinutes,
  );

  return {
    warningMinutes: normalizedWarningMinutes,
    closeMinutes: normalizedCloseMinutes,
    warningDuration: minutesToDuration(normalizedWarningMinutes),
    closeDuration: minutesToDuration(normalizedCloseMinutes),
    sweepSeconds: computeSweepInterval(normalizedCloseMinutes, normalizedWarningMinutes),
    exceptionDomains: exceptionDomains.map(normalizeDomain).filter(Boolean),
    setupComplete: rawSettings.setupComplete === true,
  };
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

function updateSweepDisplay() {
  const warningDuration = readDurationInputs(
    warningDaysEl,
    warningHoursEl,
    warningMinutesEl,
    DEFAULT_SETTINGS.warningMinutes,
  );
  const closeDuration = readDurationInputs(
    closeDaysEl,
    closeHoursEl,
    closeMinutesEl,
    DEFAULT_SETTINGS.closeMinutes,
  );
  const warnMin = durationToMinutes(warningDuration);
  const closeMin = durationToMinutes(closeDuration);
  sweepDisplayEl.textContent = String(computeSweepInterval(closeMin, warnMin));
}

function renderDomains() {
  domainList.innerHTML = "";

  if (exceptionDomains.length === 0) {
    const li = document.createElement("li");
    li.textContent =
      "No exception domains yet. Tabs from all domains are eligible for auto-close.";
    li.className = "muted";
    domainList.appendChild(li);
    return;
  }

  for (const domain of exceptionDomains) {
    const li = document.createElement("li");
    li.className = "domain-item";

    const label = document.createElement("code");
    label.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.className = "danger";
    removeBtn.addEventListener("click", () => {
      exceptionDomains = exceptionDomains.filter((item) => item !== domain);
      renderDomains();
    });

    li.append(label, removeBtn);
    domainList.appendChild(li);
  }
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#9f2d2d" : "#1f6f3c";
}

async function loadSettings() {
  const result = await chrome.storage.local.get("settings");
  const settings = normalizeSettings(result.settings || {});

  setDurationInputs(
    warningDaysEl,
    warningHoursEl,
    warningMinutesEl,
    settings.warningDuration,
  );
  setDurationInputs(
    closeDaysEl,
    closeHoursEl,
    closeMinutesEl,
    settings.closeDuration,
  );

  updateSweepDisplay();
  exceptionDomains = settings.exceptionDomains;

  renderDomains();
}

async function saveSettings() {
  const warningDuration = readDurationInputs(
    warningDaysEl,
    warningHoursEl,
    warningMinutesEl,
    DEFAULT_SETTINGS.warningMinutes,
  );

  const closeDuration = readDurationInputs(
    closeDaysEl,
    closeHoursEl,
    closeMinutesEl,
    DEFAULT_SETTINGS.closeMinutes,
  );

  const warningMinutes = durationToMinutes(warningDuration);
  const closeMinutes = durationToMinutes(closeDuration);

  const settings = {
    warningDuration,
    closeDuration,
    warningMinutes,
    closeMinutes,
    sweepSeconds: computeSweepInterval(closeMinutes, warningMinutes),
    exceptionDomains: [
      ...new Set(exceptionDomains.map(normalizeDomain).filter(Boolean)),
    ],
    setupComplete: true,
  };

  await chrome.storage.local.set({ settings });

  const response = await chrome.runtime.sendMessage({
    type: "settingsUpdated",
  });
  if (!response?.ok) {
    throw new Error(
      response?.error || "Failed to apply settings in background worker.",
    );
  }

  showStatus("Settings saved.");
}

domainForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const domain = normalizeDomain(domainInput.value);

  if (!domain) {
    showStatus("Please enter a valid domain.", true);
    return;
  }

  if (!exceptionDomains.includes(domain)) {
    exceptionDomains.push(domain);
    exceptionDomains.sort((a, b) => a.localeCompare(b));
    renderDomains();
  }

  domainInput.value = "";
  showStatus("Exception domain added. Click Save Settings to persist.");
});

saveButton.addEventListener("click", async () => {
  try {
    await saveSettings();
  } catch (error) {
    showStatus(String(error), true);
  }
});

sweepButton.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "runSweepNow" });
    if (!response?.ok) {
      throw new Error(response?.error || "Sweep failed.");
    }
    showStatus("Sweep completed.");
  } catch (error) {
    showStatus(String(error), true);
  }
});

warningDaysEl.addEventListener("input", updateSweepDisplay);
warningHoursEl.addEventListener("input", updateSweepDisplay);
warningMinutesEl.addEventListener("input", updateSweepDisplay);
closeDaysEl.addEventListener("input", updateSweepDisplay);
closeHoursEl.addEventListener("input", updateSweepDisplay);
closeMinutesEl.addEventListener("input", updateSweepDisplay);

loadSettings().catch((error) => {
  showStatus(`Failed to load settings: ${String(error)}`, true);
});
