const frame = document.getElementById("frame");
const empty = document.getElementById("empty");
const statusEl = document.getElementById("status");
const settingsEl = document.getElementById("settings");
const chromeEl = document.getElementById("chrome");

const DEFAULTS = {
  enabled: true,
  country: "Sweden",
  autoOpenSidebar: true,
  rememberLastLocation: true,
  timeRemainingText: "",
  timeRemainingEndsAt: 0,
  lastStatus: "",
  dashboardUrl: "",
  popupDashboardLink: "",
};

function sizeFrame() {
  const h = chromeEl.getBoundingClientRect().height || 48;
  document.documentElement.style.setProperty("--chrome-h", Math.ceil(h) + "px");
}

function dashFromHost(url) {
  const m = String(url || "").match(/^(https:\/\/user\d+\.setupvpn\.com)/i);
  return m ? m[1] + "/ui/dashboard" : "";
}

function formatRemaining(endsAt) {
  const ms = Number(endsAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}

async function resolveUrl() {
  const { dashboardUrl, popupDashboardLink } = await chrome.storage.local.get({
    dashboardUrl: "",
    popupDashboardLink: "",
  });
  let url = dashFromHost(popupDashboardLink) || dashFromHost(dashboardUrl) || String(dashboardUrl || "");
  if (/\/ui\//i.test(url) && !/\/ui\/dashboard/i.test(url)) {
    url = url.replace(/\/ui\/.*$/i, "/ui/dashboard");
  }
  if (url) return url;
  try {
    const tabs = await chrome.tabs.query({ url: "https://*.setupvpn.com/ui/*" });
    for (const tab of tabs) {
      const d = dashFromHost(tab.url);
      if (d) {
        await chrome.storage.local.set({ dashboardUrl: d });
        return d;
      }
    }
  } catch (_err) {}
  return "";
}

async function renderSettings() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  document.getElementById("enabled").checked = !!cfg.enabled;
  document.getElementById("autoOpenSidebar").checked = cfg.autoOpenSidebar !== false;
  document.getElementById("rememberLastLocation").checked = !!cfg.rememberLastLocation;
  document.getElementById("country").value = cfg.country || "Sweden";
  const live = formatRemaining(cfg.timeRemainingEndsAt);
  const countdown = live || cfg.timeRemainingText || null;
  document.getElementById("countdown").textContent = countdown
    ? "Time remaining: " + countdown
    : "Time remaining: —";
}

async function loadFrame() {
  const url = await resolveUrl();
  const { lastStatus } = await chrome.storage.local.get({ lastStatus: "" });
  if (!url) {
    frame.removeAttribute("src");
    empty.classList.add("show");
    statusEl.textContent = lastStatus || "waiting for SetupVPN host";
    sizeFrame();
    return;
  }
  empty.classList.remove("show");
  if (frame.src !== url) frame.src = url;
  statusEl.textContent = (lastStatus ? lastStatus + " · " : "") + url.replace(/^https:\/\//, "");
  sizeFrame();
}

document.getElementById("reload").addEventListener("click", async () => {
  const url = await resolveUrl();
  if (!url) return loadFrame();
  frame.src = url + (url.includes("?") ? "&" : "?") + "r=" + Date.now();
  statusEl.textContent = "reloading…";
});

document.getElementById("focusTab").addEventListener("click", async () => {
  const url = await resolveUrl();
  if (!url) return;
  const tabs = await chrome.tabs.query({ url: "https://*.setupvpn.com/ui/*" });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
});

document.getElementById("toggleSettings").addEventListener("click", () => {
  settingsEl.classList.toggle("collapsed");
  sizeFrame();
});

for (const id of ["enabled", "autoOpenSidebar", "rememberLastLocation", "country"]) {
  document.getElementById(id).addEventListener("change", async (e) => {
    const el = e.target;
    const value = el.type === "checkbox" ? el.checked : el.value;
    await chrome.storage.local.set({ [id]: value });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.dashboardUrl || changes.lastStatus || changes.popupDashboardLink) loadFrame();
  renderSettings();
});

loadFrame();
renderSettings();
setInterval(() => {
  loadFrame();
  renderSettings();
}, 5000);
window.addEventListener("resize", sizeFrame);
