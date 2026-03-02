import { getTabLabel, formatAge } from "./utils.js";

export async function updateBadge(warningCount) {
  if (warningCount > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
    await chrome.action.setBadgeText({ text: String(Math.min(warningCount, 99)) });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
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
