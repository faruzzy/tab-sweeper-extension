export function normalizeHostname(urlString) {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function shouldTrackUrl(urlString) {
  if (!urlString) return false;
  return urlString.startsWith("http://") || urlString.startsWith("https://");
}

export function matchesDomainList(urlString, domains) {
  const host = normalizeHostname(urlString);
  if (!host) return false;

  return domains.some((domain) => {
    const target = String(domain || "").toLowerCase().replace(/^www\./, "").trim();
    if (!target) return false;
    return host === target || host.endsWith(`.${target}`);
  });
}

export function getTabLabel(tab) {
  const rawTitle = String(tab?.title || "").trim();
  const hostname = normalizeHostname(tab?.url || "");

  const label =
    rawTitle && rawTitle.toLowerCase() !== hostname.toLowerCase()
      ? rawTitle
      : rawTitle || tab?.url || "Untitled tab";

  return {
    label,
    hostname,
  };
}

export function formatAge(minutesOpen) {
  return minutesOpen >= 60
    ? `${(minutesOpen / 60).toFixed(1)}h`
    : `${Math.max(1, Math.round(minutesOpen))}m`;
}
