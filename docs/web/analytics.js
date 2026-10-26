// Website-only aggregate measurement. Never import into the Bot runtime.
const siteToken = "f76414be25704901b9e5178f98f48f50"; // Public beacon identifier.
const storageKey = "dolegram.analytics-disabled.v1";
const legacyKey = "dolegram.analytics-consent.v1";
const production =
  location.hostname === "vingeraycn.github.io" &&
  location.pathname === "/dolegram/";
const settings = document.querySelector("#analytics-settings");
const browserOptOut =
  navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
let disabled = true;
let storageAvailable = false;

try {
  const saved = localStorage.getItem(storageKey);
  disabled = saved === "true" ||
    (saved === null && localStorage.getItem(legacyKey) === "denied");
  // Verify that a later opt-out can be saved before loading measurement.
  localStorage.setItem(storageKey, String(disabled));
  storageAvailable = true;
} catch {
  disabled = true;
}

if (production) {
  // Remove only the previous website integration's scoped cookies.
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0];
    if (!/^dolegram_ga(?:_[A-Z0-9]+)?$/.test(name)) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/dolegram; Domain=vingeraycn.github.io; Secure; SameSite=Lax`;
  }

  settings.hidden = false;
  settings.disabled = !storageAvailable || browserOptOut;
  settings.textContent = settings.disabled
    ? "Analytics off"
    : disabled ? "Enable analytics" : "Disable analytics";
  settings.addEventListener("click", () => {
    try {
      localStorage.setItem(storageKey, String(!disabled));
      // Reload to unload the vendor's listeners, not merely its script element.
      location.reload();
    } catch {
      settings.textContent = "Could not save preference";
    }
  });

  if (!disabled && !browserOptOut) {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "https://static.cloudflareinsights.com/beacon.min.js";
    script.setAttribute("data-cf-beacon", JSON.stringify({ token: siteToken }));
    document.head.append(script);
  }
}
