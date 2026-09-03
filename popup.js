const DEFAULTS = {
  enabled: true,
  country: "Sweden",
  checkSeconds: 4,
  cooldownSeconds: 20,
  autoOpenDashboard: true,
  stopOnUpgrade: true,
  rememberLastLocation: true,
  lastConnectedCountry: "",
  setupvpnInstalled: false,
  setupvpnEnabled: false,
  timeRemainingText: "",
  timeRemainingEndsAt: 0,
  lastStatus: "idle",
  lastAt: 0,
};

const FIELDS = [
  "enabled",
  "country",
  "checkSeconds",
  "cooldownSeconds",
  "autoOpenDashboard",
  "stopOnUpgrade",
  "rememberLastLocation",
];

function formatRemaining(endsAt) {
  const ms = Number(endsAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function render() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  document.getElementById("enabled").checked = !!cfg.enabled;
  document.getElementById("rememberLastLocation").checked = !!cfg.rememberLastLocation;
  document.getElementById("country").value = cfg.country || "Sweden";
  document.getElementById("checkSeconds").value = Number(cfg.checkSeconds) || 4;
  document.getElementById("cooldownSeconds").value = Number(cfg.cooldownSeconds) || 20;
  document.getElementById("autoOpenDashboard").checked = !!cfg.autoOpenDashboard;
  document.getElementById("stopOnUpgrade").checked = !!cfg.stopOnUpgrade;
  const sv = document.getElementById("setupvpnStatus");
  if (!cfg.setupvpnInstalled) sv.textContent = "SetupVPN: not installed";
  else if (!cfg.setupvpnEnabled) sv.textContent = "SetupVPN: installed but disabled";
  else sv.textContent = "SetupVPN: installed";

  document.getElementById("remembered").textContent = cfg.lastConnectedCountry
    ? `Remembered: ${cfg.lastConnectedCountry}`
    : "Remembered: —";

  const live = formatRemaining(cfg.timeRemainingEndsAt);
  const countdown = live || cfg.timeRemainingText || null;
  document.getElementById("countdown").textContent = countdown
    ? `Time remaining: ${countdown}`
    : "Time remaining: —";

  const when = cfg.lastAt ? new Date(cfg.lastAt).toLocaleTimeString() : "";
  document.getElementById("status").textContent = when
    ? `${cfg.lastStatus} (${when})`
    : cfg.lastStatus || "idle";
}

async function saveField(id) {
  const el = document.getElementById(id);
  let value;
  if (el.type === "checkbox") value = el.checked;
  else if (el.type === "number") value = Math.max(Number(el.min || 0), Number(el.value) || 0);
  else value = el.value;
  await chrome.storage.local.set({ [id]: value });
}

for (const id of FIELDS) {
  document.getElementById(id).addEventListener("change", () => saveField(id));
}

chrome.storage.onChanged.addListener(render);
setInterval(render, 1000);
render();

document.getElementById("webstore").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({
    url: "https://chromewebstore.google.com/detail/setupvpn-lifetime-free-vpn/oofgbpoabipfcfjapgnbbjjaenockbdp",
  });
});

document.getElementById("pinHelp").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

document.getElementById("installSetupvpn").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: "checkSetupVpn", forcePrompt: true }, (state) => {
    if (state && state.setupvpnInstalled && state.setupvpnEnabled) {
      chrome.tabs.create({ url: "https://user3.setupvpn.com/ui/dashboard" });
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL("install-setupvpn.html") });
    }
  });
});
