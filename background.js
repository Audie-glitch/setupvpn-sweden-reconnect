const DASHBOARD = "https://user3.setupvpn.com/ui/dashboard";
const ALARM = "sweden-watch";

const DEFAULTS = {
  enabled: true,
  country: "Sweden",
  checkSeconds: 4,
  cooldownSeconds: 20,
  autoOpenDashboard: true,
  stopOnUpgrade: true,
  rememberLastLocation: true,
  lastConnectedCountry: "",
  timeRemainingText: "",
  timeRemainingEndsAt: 0,
  lastStatus: "installed",
  lastAt: Date.now(),
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  await chrome.storage.local.set({ ...DEFAULTS, ...current, lastAt: Date.now() });
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const { enabled, autoOpenDashboard } = await chrome.storage.local.get({
    enabled: true,
    autoOpenDashboard: true,
  });
  if (!enabled || !autoOpenDashboard) return;

  const tabs = await chrome.tabs.query({ url: "https://*.setupvpn.com/ui/*" });
  if (tabs.length === 0) {
    await chrome.tabs.create({ url: DASHBOARD, active: false });
    await setStatus("opened dashboard");
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "status") {
    setStatus(msg.status).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function setStatus(status) {
  await chrome.storage.local.set({ lastStatus: status, lastAt: Date.now() });
  const text = status.startsWith("connected")
    ? "on"
    : status.startsWith("upgrade")
      ? "!"
      : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: status.startsWith("connected") ? "#1a7f37" : "#b42318",
  });
}
