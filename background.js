const DASHBOARD = "https://user3.setupvpn.com/ui/dashboard";
const ALARM = "sweden-watch";
const SETUPVPN_ID = "oofgbpoabipfcfjapgnbbjjaenockbdp";
const STORE =
  "https://chromewebstore.google.com/detail/setupvpn-lifetime-free-vpn/oofgbpoabipfcfjapgnbbjjaenockbdp";

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
  setupvpnInstalled: false,
  setupvpnEnabled: false,
  lastInstallPromptAt: 0,
  lastStatus: "installed",
  lastAt: Date.now(),
};

chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.local.get(null);
  await chrome.storage.local.set({ ...DEFAULTS, ...current, lastAt: Date.now() });
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  if (details.reason === "install" || details.reason === "update") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
  await ensureSetupVpn(true);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  ensureSetupVpn(false);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await ensureSetupVpn(false);

  const { enabled, autoOpenDashboard, setupvpnInstalled, setupvpnEnabled } =
    await chrome.storage.local.get({
      enabled: true,
      autoOpenDashboard: true,
      setupvpnInstalled: false,
      setupvpnEnabled: false,
    });
  if (!enabled || !autoOpenDashboard) return;
  if (!setupvpnInstalled || !setupvpnEnabled) return;

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
  if (msg?.type === "checkSetupVpn") {
    ensureSetupVpn(!!msg.forcePrompt).then((state) => sendResponse(state));
    return true;
  }
});

chrome.management.onInstalled.addListener((info) => {
  if (info.id === SETUPVPN_ID) ensureSetupVpn(false);
});
chrome.management.onUninstalled.addListener((id) => {
  if (id === SETUPVPN_ID) ensureSetupVpn(true);
});
chrome.management.onEnabled.addListener((info) => {
  if (info.id === SETUPVPN_ID) ensureSetupVpn(false);
});
chrome.management.onDisabled.addListener((info) => {
  if (info.id === SETUPVPN_ID) ensureSetupVpn(true);
});

async function getSetupVpnState() {
  try {
    const ext = await chrome.management.get(SETUPVPN_ID);
    return {
      setupvpnInstalled: true,
      setupvpnEnabled: !!ext.enabled,
    };
  } catch (_err) {
    return { setupvpnInstalled: false, setupvpnEnabled: false };
  }
}

async function ensureSetupVpn(forcePrompt) {
  const state = await getSetupVpnState();
  await chrome.storage.local.set(state);

  if (state.setupvpnInstalled && state.setupvpnEnabled) {
    return state;
  }

  const { lastInstallPromptAt } = await chrome.storage.local.get({
    lastInstallPromptAt: 0,
  });
  const due = forcePrompt || Date.now() - lastInstallPromptAt > 6 * 60 * 60 * 1000;
  if (!due) return state;

  const promptUrl = chrome.runtime.getURL("install-setupvpn.html");
  const existing = await chrome.tabs.query({ url: promptUrl });
  if (existing.length === 0) {
    await chrome.tabs.create({ url: promptUrl, active: true });
  } else {
    await chrome.tabs.update(existing[0].id, { active: true });
  }
  await chrome.storage.local.set({ lastInstallPromptAt: Date.now() });
  await setStatus(
    state.setupvpnInstalled
      ? "SetupVPN disabled — enable it"
      : "SetupVPN missing — install prompted"
  );
  return state;
}

async function setStatus(status) {
  await chrome.storage.local.set({ lastStatus: status, lastAt: Date.now() });
  const text = status.startsWith("connected")
    ? "on"
    : status.includes("missing") || status.includes("disabled") || status.startsWith("upgrade")
      ? "!"
      : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: status.startsWith("connected") ? "#1a7f37" : "#b42318",
  });
}
