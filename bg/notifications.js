import { getTabLabel, formatAge } from "./utils.js";
import { STORAGE_KEYS, getStorage } from "./storage.js";

function formatBadgeCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return `${totalSeconds}s`;
}

export async function updateBadge(warningCount, soonestCloseMs = null) {
  if (typeof soonestCloseMs === "number" && soonestCloseMs > 0 && soonestCloseMs <= 300000) {
    await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
    await chrome.action.setBadgeText({ text: formatBadgeCountdown(soonestCloseMs) });
  } else if (warningCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
    await chrome.action.setBadgeText({ text: String(Math.min(warningCount, 99)) });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

export async function updateActiveTabIndicator(tabId) {
  const data = await getStorage(STORAGE_KEYS.warnedTabs);
  const warnedTabs = data.warnedTabs || {};
  const color = warnedTabs[String(tabId)] ? "#e67e22" : "#c0392b";
  await chrome.action.setBadgeBackgroundColor({ color, tabId });
}

export async function focusTabById(tabId) {
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

export async function notifyOldTabs(newWarnings) {
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
