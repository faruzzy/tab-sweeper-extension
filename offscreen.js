setInterval(() => {
  chrome.runtime.sendMessage({ type: "offscreenTick" });
}, 1000);
