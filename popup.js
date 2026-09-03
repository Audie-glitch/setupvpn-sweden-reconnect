const DEFAULTS = {
  enabled: true,
  country: "Sweden",
  checkSeconds: 4,
  cooldownSeconds: 20,
  autoOpenDashboard: true,
  stopOnUpgrade: true,
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
];

async function render() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  document.getElementById("enabled").checked = !!cfg.enabled;
  document.getElementById("country").value = cfg.country || "Sweden";
  document.getElementById("checkSeconds").value = Number(cfg.checkSeconds) || 4;
  document.getElementById("cooldownSeconds").value = Number(cfg.cooldownSeconds) || 20;
  document.getElementById("autoOpenDashboard").checked = !!cfg.autoOpenDashboard;
  document.getElementById("stopOnUpgrade").checked = !!cfg.stopOnUpgrade;
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
  const el = document.getElementById(id);
  const evt = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "change";
  el.addEventListener(evt, () => saveField(id));
}

chrome.storage.onChanged.addListener(render);
render();

document.getElementById("webstore").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({
    url: "https://chromewebstore.google.com/detail/setupvpn-lifetime-free-vpn/oofgbpoabipfcfjapgnbbjjaenockbdp",
  });
});
