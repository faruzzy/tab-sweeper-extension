const summaryEl = document.getElementById("summary");
const statusEl = document.getElementById("status");
const sweepNow = document.getElementById("sweepNow");
const openOptions = document.getElementById("openOptions");
const openSaved = document.getElementById("openSaved");

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#9f2d2d" : "#1f6f3c";
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

sweepNow.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "runSweepNow" });
    if (!response?.ok) {
      throw new Error(response?.error || "Sweep failed");
    }
    await loadSummary();
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

loadSummary().catch((error) => showStatus(String(error), true));
