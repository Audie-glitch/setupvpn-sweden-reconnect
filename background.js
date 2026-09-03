const DASHBOARD = "https://user3.setupvpn.com/ui/dashboard";
const ALARM = "sweden-watch";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    country: "Sweden",
    lastStatus: "installed",
    lastAt: Date.now(),
  });
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  if (!enabled) return;

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
  const text = status.startsWith("connected") ? "on" : status.startsWith("upgrade") ? "!" : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: status.startsWith("connected") ? "#1a7f37" : "#b42318",
  });
}
