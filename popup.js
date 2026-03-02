import { getTabLabel, matchesDomainList } from "./bg/utils.js";

const summaryEl = document.getElementById("summary");
const statusEl = document.getElementById("status");
const sweepNow = document.getElementById("sweepNow");
const openOptions = document.getElementById("openOptions");
const openSaved = document.getElementById("openSaved");
const warnedSection = document.getElementById("warnedSection");
const warnedList = document.getElementById("warnedList");

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#9f2d2d" : "#1f6f3c";
}

function formatCountdown(ms) {
  if (ms <= 0) return "closing soon";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")} left`;
  }
  return `${totalSeconds}s left`;
}

let countdownInterval = null;

function stopCountdownTimer() {
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function startCountdownTimer() {
  stopCountdownTimer();
  countdownInterval = setInterval(() => {
    const elements = document.querySelectorAll("[data-close-at]");
    if (elements.length === 0) {
      stopCountdownTimer();
      return;
    }
    const now = Date.now();
    for (const el of elements) {
      const closeAt = Number(el.getAttribute("data-close-at"));
      const remaining = closeAt - now;
      const hostname = el.getAttribute("data-hostname") || "";
      const countdown = formatCountdown(remaining);
      el.textContent = hostname ? `${hostname} \u00b7 ${countdown}` : countdown;
    }
  }, 1000);
}

async function loadSummary() {
  const [tabs, settingsResult] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get("settings"),
  ]);

  const settings = settingsResult.settings || {};
  const exceptionDomains = Array.isArray(settings.exceptionDomains)
    ? settings.exceptionDomains
    : Array.isArray(settings.trackedDomains)
      ? settings.trackedDomains
      : [];

  const visibleTabs = tabs.filter((tab) =>
    tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))
  );

  summaryEl.textContent = `${visibleTabs.length} web tabs open | ${exceptionDomains.length} exception domains`;
}

async function loadWarnedTabs() {
  const data = await chrome.storage.local.get(["warnedTabs", "tabOpenedAt", "settings"]);
  const warnedTabs = data.warnedTabs || {};
  const tabOpenedAt = data.tabOpenedAt || {};
  const settings = data.settings || {};
  const closeMinutes = settings.closeMinutes || 5;
  const exceptionDomains = Array.isArray(settings.exceptionDomains) ? settings.exceptionDomains : [];

  stopCountdownTimer();

  const warnedIds = Object.keys(warnedTabs);
  if (warnedIds.length === 0) {
    warnedSection.hidden = true;
    warnedList.innerHTML = "";
    return;
  }

  const now = Date.now();
  const items = [];

  for (const key of warnedIds) {
    const tabId = Number(key);
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      continue;
    }

    const openedAt = tabOpenedAt[key] || now;
    const closeAt = openedAt + closeMinutes * 60000;
    const remaining = closeAt - now;
    if (tab.groupId !== undefined && tab.groupId !== -1) continue;
    const isException = matchesDomainList(tab.url || "", exceptionDomains);
    if (isException) continue;

    const { label, hostname } = getTabLabel(tab);

    items.push({ tabId, tab, label, hostname, remaining, closeAt });
  }

  if (items.length === 0) {
    warnedSection.hidden = true;
    warnedList.innerHTML = "";
    return;
  }

  items.sort((a, b) => a.remaining - b.remaining);

  warnedSection.hidden = false;
  warnedList.innerHTML = "";

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "warned-item";

    const meta = document.createElement("div");
    meta.className = "warned-meta";

    const title = document.createElement("span");
    title.className = "warned-title";
    title.textContent = item.label;
    title.title = item.label;

    const info = document.createElement("small");
    info.className = "muted";
    if (item.remaining > 0 && item.remaining <= 300000) {
      const countdown = formatCountdown(item.remaining);
      info.textContent = item.hostname ? `${item.hostname} \u00b7 ${countdown}` : countdown;
      info.setAttribute("data-close-at", String(item.closeAt));
      if (item.hostname) {
        info.setAttribute("data-hostname", item.hostname);
      }
    } else {
      const minutesLeft = Math.max(0, Math.round(item.remaining / 60000));
      let timeText;
      if (minutesLeft <= 0) {
        timeText = "closing soon";
      } else if (minutesLeft >= 60) {
        const h = Math.floor(minutesLeft / 60);
        const m = minutesLeft % 60;
        timeText = m > 0 ? `${h}h ${m}m left` : `${h}h left`;
      } else {
        timeText = `${minutesLeft}m left`;
      }
      info.textContent = item.hostname ? `${item.hostname} \u00b7 ${timeText}` : timeText;
    }

    meta.appendChild(title);
    meta.appendChild(info);

    const closeBtn = document.createElement("button");
    closeBtn.className = "warned-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close tab";
    closeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await chrome.tabs.remove(item.tabId);
      } catch {
        // Tab may already be closed.
      }
      await loadWarnedTabs();
      await loadSummary();
    });

    li.addEventListener("click", async () => {
      await chrome.tabs.update(item.tabId, { active: true });
      if (typeof item.tab.windowId === "number") {
        await chrome.windows.update(item.tab.windowId, { focused: true });
      }
      window.close();
    });

    li.appendChild(meta);
    li.appendChild(closeBtn);
    warnedList.appendChild(li);
  }

  startCountdownTimer();
}

sweepNow.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "runSweepNow" });
    if (!response?.ok) {
      throw new Error(response?.error || "Sweep failed");
    }
    await loadSummary();
    await loadWarnedTabs();
    showStatus("Sweep finished.");
  } catch (error) {
    showStatus(String(error), true);
  }
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

openSaved.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("saved.html") });
});

Promise.all([loadSummary(), loadWarnedTabs()]).catch((error) =>
  showStatus(String(error), true)
);
