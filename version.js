// App version and links shown in the footer. Keep VERSION in step with the top entry of CHANGELOG.md and with version.json
// (tests/version.test.mjs fails when they differ). The app downloads version.json from the site to learn about a newer release.
export const VERSION = "2.1.0";
export const REPO_URL = "https://github.com/TienNHM/english-notebook";
export const INSTALL_URL = REPO_URL + "#install-the-app-on-your-phone";

// "2.10.1" -> [2, 10, 1]; anything that is not x.y.z gives null.
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
// true only when `latest` is a valid version that is higher than `current` (a bad value never triggers the banner).
export function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
// Downloads version.json (never from a cache) and returns { latest, newer }, or null when offline / not valid.
export async function checkForUpdate(current = VERSION, fetchFn = fetch) {
  try {
    const r = await fetchFn("version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    const latest = (await r.json())?.version;
    return parseVersion(latest) ? { latest, newer: isNewer(latest, current) } : null;
  } catch { return null; }
}
