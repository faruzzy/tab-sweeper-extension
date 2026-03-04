const savedList = document.getElementById("savedList");
const refreshButton = document.getElementById("refreshButton");
const clearButton = document.getElementById("clearButton");
const statusEl = document.getElementById("status");

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString();
}

function getDayKey(timestamp) {
  const date = new Date(timestamp || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#9f2d2d" : "#1f6f3c";
}

function groupByDay(savedTabs) {
  const groups = new Map();

  for (const tab of savedTabs) {
    const key = getDayKey(tab.closedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, tabs]) => ({ day, tabs }));
}

async function deleteEntry(id) {
  const latest = await chrome.storage.local.get("savedTabs");
  const rows = Array.isArray(latest.savedTabs) ? latest.savedTabs : [];
  await chrome.storage.local.set({ savedTabs: rows.filter((row) => row.id !== id) });
}

function createTabItem(item) {
  const li = document.createElement("div");
  li.className = "saved-item";

  const meta = document.createElement("div");
  meta.className = "saved-meta";

  const title = document.createElement("a");
  title.href = item.url;
  const fullTitle = item.title || item.url;
  title.textContent = fullTitle;
  title.title = fullTitle;
  title.target = "_blank";
  title.rel = "noopener";

  const detail = document.createElement("small");
  detail.textContent = `Opened: ${formatDateTime(item.openedAt)} | Closed: ${formatDateTime(item.closedAt)} | Reason: ${item.reason || "auto-close"}`;

  meta.append(title, detail);

  const actions = document.createElement("div");
  actions.className = "saved-actions";

  const reopenBtn = document.createElement("button");
  reopenBtn.textContent = "Reopen";
  reopenBtn.addEventListener("click", async () => {
    await chrome.tabs.create({ url: item.url });
    showStatus("Tab reopened.");
  });

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Delete";
  removeBtn.className = "danger";
  removeBtn.addEventListener("click", async () => {
    await deleteEntry(item.id);
    await loadSavedTabs();
    showStatus("Entry deleted.");
  });

  actions.append(reopenBtn, removeBtn);
  li.append(meta, actions);
  return li;
}

async function loadSavedTabs() {
  const result = await chrome.storage.local.get("savedTabs");
  const savedTabs = Array.isArray(result.savedTabs) ? result.savedTabs : [];

  savedList.innerHTML = "";

  if (savedTabs.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No closed tabs yet.";
    empty.className = "muted";
    savedList.appendChild(empty);
    showStatus("Report is empty.");
    return;
  }

  const groups = groupByDay(savedTabs);
  const totalDays = groups.length;

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "card day-group";

    const header = document.createElement("div");
    header.className = "day-header";

    const title = document.createElement("h2");
    title.textContent = formatDayLabel(group.day);

    const count = document.createElement("span");
    count.className = "day-count";
    count.textContent = `${group.tabs.length} tab${group.tabs.length === 1 ? "" : "s"}`;

    header.append(title, count);
    section.appendChild(header);

    for (const item of group.tabs) {
      section.appendChild(createTabItem(item));
    }

    savedList.appendChild(section);
  }

  showStatus(`${savedTabs.length} closed tabs across ${totalDays} day${totalDays === 1 ? "" : "s"}.`);
}

refreshButton.addEventListener("click", () => {
  loadSavedTabs().catch((error) => showStatus(String(error), true));
});

clearButton.addEventListener("click", async () => {
  try {
    await chrome.storage.local.set({ savedTabs: [] });
    await loadSavedTabs();
    showStatus("Closed-tabs report cleared.");
  } catch (error) {
    showStatus(String(error), true);
  }
});

loadSavedTabs().catch((error) => showStatus(String(error), true));
