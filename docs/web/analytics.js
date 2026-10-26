// Website-only measurement. Never import this module into the Bot runtime.
const measurementId = "G-YPHXN0WKW5";
const storageKey = "dolegram.analytics-consent.v1";
const production =
  location.hostname === "vingeraycn.github.io" &&
  location.pathname === "/dolegram/";
const events = new Set([
  "install_start",
  "install_prompt_copy",
  "install_prompt_copy_fallback",
  "install_guide_open",
  "github_open",
  "demo_replay",
  "how_it_works_view",
]);
const panel = document.querySelector("#analytics-consent");
const settings = document.querySelector("#analytics-settings");
let consent = readConsent();
let initialized = false;

function readConsent() {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function gtag() {
  window.dataLayer.push(arguments);
}

function enable() {
  if (!production || initialized || consent !== "granted") return;
  initialized = true;
  window[`ga-disable-${measurementId}`] = false;
  window.dataLayer = window.dataLayer || [];
  gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  gtag("js", new Date());
  // Do not forward arbitrary URL parameters, fragments or referring paths.
  let referrer = "";
  try {
    referrer = new URL(document.referrer).origin;
  } catch {
    /* No referrer. */
  }
  gtag("config", measurementId, {
    page_location: "https://vingeraycn.github.io/dolegram/",
    page_referrer: referrer,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_domain: "vingeraycn.github.io",
    cookie_path: "/dolegram",
    cookie_prefix: "dolegram",
    cookie_expires: 7776000,
    cookie_flags: "SameSite=Lax;Secure",
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(script);
}

export function track(name) {
  if (production && initialized && consent === "granted" && events.has(name)) {
    gtag("event", name, { send_to: measurementId });
  }
}

function choose(value) {
  consent = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* Session-only choice. */
  }
  panel.hidden = true;
  settings.focus({ preventScroll: true });
  if (value === "granted") {
    if (initialized) {
      window[`ga-disable-${measurementId}`] = false;
      gtag("consent", "update", { analytics_storage: "granted" });
    } else enable();
  } else {
    window[`ga-disable-${measurementId}`] = true;
    // Disable before updating consent so no cookieless measurement is sent.
    if (initialized) gtag("consent", "update", { analytics_storage: "denied" });
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.trim().split("=")[0];
      if (!name.startsWith("dolegram_ga")) continue;
      document.cookie = `${name}=; Max-Age=0; Path=/dolegram; Domain=vingeraycn.github.io; Secure; SameSite=Lax`;
    }
  }
}

document
  .querySelector("#analytics-accept")
  .addEventListener("click", () => choose("granted"));
document
  .querySelector("#analytics-decline")
  .addEventListener("click", () => choose("denied"));
settings.addEventListener("click", () => {
  panel.hidden = false;
  document.querySelector("#analytics-decline").focus();
});
settings.hidden = false;
panel.hidden = consent === "granted" || consent === "denied";
enable();

document.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  if (link.getAttribute("href") === "#install") track("install_start");
  else if (link.classList.contains("guide-link")) track("install_guide_open");
  else if (link.href === "https://github.com/vingeraycn/dolegram")
    track("github_open");
});

const observer = new IntersectionObserver(
  (entries) => {
    if (consent !== "granted" || !entries.some((entry) => entry.isIntersecting))
      return;
    track("how_it_works_view");
    observer.disconnect();
  },
  { threshold: 0.5 },
);
observer.observe(document.querySelector("#how-it-works"));
