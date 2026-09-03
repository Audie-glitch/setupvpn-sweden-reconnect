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
  pendingConnect: false,
  autoAgreeGuest: true,
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
  // Full flow: if SetupVPN missing, open store (content script clicks Add to Chrome).
  // Chrome's confirm dialog still needs one user click ("Add extension").
  await startInstallAndConnectFlow(details.reason === "install");
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  startInstallAndConnectFlow(false);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const state = await refreshSetupVpnState();
  const cfg = await chrome.storage.local.get({
    enabled: true,
    autoOpenDashboard: true,
    pendingConnect: false,
  autoAgreeGuest: true,
  });
  if (!cfg.enabled) return;

  if (!state.setupvpnInstalled || !state.setupvpnEnabled) {
    await maybeOpenStore(false);
    return;
  }

  if (cfg.pendingConnect || cfg.autoOpenDashboard) {
    await openDashboardAndConnect(cfg.pendingConnect);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "status") {
    setStatus(msg.status).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "checkSetupVpn") {
    startInstallAndConnectFlow(!!msg.forcePrompt).then((state) => sendResponse(state));
    return true;
  }
  if (msg?.type === "startFullFlow") {
    startInstallAndConnectFlow(true).then((state) => sendResponse(state));
    return true;
  }
});

chrome.management.onInstalled.addListener(async (info) => {
  if (info.id !== SETUPVPN_ID) return;
  await setStatus("SetupVPN installed — connecting");
  await chrome.storage.local.set({
    setupvpnInstalled: true,
    setupvpnEnabled: true,
    pendingConnect: true,
  });
  await openDashboardAndConnect(true);
});

chrome.management.onUninstalled.addListener(async (id) => {
  if (id !== SETUPVPN_ID) return;
  await chrome.storage.local.set({
    setupvpnInstalled: false,
    setupvpnEnabled: false,
    pendingConnect: false,
  autoAgreeGuest: true,
  });
  await startInstallAndConnectFlow(true);
});

chrome.management.onEnabled.addListener(async (info) => {
  if (info.id !== SETUPVPN_ID) return;
  await chrome.storage.local.set({
    setupvpnInstalled: true,
    setupvpnEnabled: true,
    pendingConnect: true,
  });
  await openDashboardAndConnect(true);
});

chrome.management.onDisabled.addListener(async (info) => {
  if (info.id !== SETUPVPN_ID) return;
  await chrome.storage.local.set({ setupvpnEnabled: false });
  await setStatus("SetupVPN disabled — enable it");
});

async function getSetupVpnState() {
  try {
    const ext = await chrome.management.get(SETUPVPN_ID);
    return { setupvpnInstalled: true, setupvpnEnabled: !!ext.enabled };
  } catch (_err) {
    return { setupvpnInstalled: false, setupvpnEnabled: false };
  }
}

async function refreshSetupVpnState() {
  const state = await getSetupVpnState();
  await chrome.storage.local.set(state);
  return state;
}

async function startInstallAndConnectFlow(forcePrompt) {
  const state = await refreshSetupVpnState();
  if (state.setupvpnInstalled && state.setupvpnEnabled) {
    await chrome.storage.local.set({ pendingConnect: true });
    await openDashboardAndConnect(true);
    return state;
  }
  await maybeOpenStore(forcePrompt);
  return state;
}

async function maybeOpenStore(forcePrompt) {
  const { lastInstallPromptAt } = await chrome.storage.local.get({
    lastInstallPromptAt: 0,
  });
  const due = forcePrompt || Date.now() - lastInstallPromptAt > 6 * 60 * 60 * 1000;
  if (!due) return;

  // Prefer the Web Store detail page so our content script can click Add to Chrome.
  const existing = await chrome.tabs.query({
    url: ["https://chromewebstore.google.com/*", "https://chrome.google.com/webstore/*"],
  });
  let tab;
  if (existing.length) {
    tab = existing.find((t) => (t.url || "").includes(SETUPVPN_ID)) || existing[0];
    await chrome.tabs.update(tab.id, { url: STORE, active: true });
  } else {
    tab = await chrome.tabs.create({ url: STORE, active: true });
  }
  await chrome.storage.local.set({ lastInstallPromptAt: Date.now() });
  await setStatus("SetupVPN missing — open Web Store, then click Add extension");
  // Also keep our guided page available
  const guide = chrome.runtime.getURL("install-setupvpn.html");
  const guides = await chrome.tabs.query({ url: guide });
  if (!guides.length) {
    await chrome.tabs.create({ url: guide, active: false });
  }
}

async function openDashboardAndConnect(markPending) {
  if (markPending) {
    await chrome.storage.local.set({ pendingConnect: true });
  }
  const tabs = await chrome.tabs.query({ url: "https://*.setupvpn.com/ui/*" });
  if (tabs.length === 0) {
    await chrome.tabs.create({ url: DASHBOARD, active: true });
    await setStatus("opened dashboard — connecting");
  } else {
    await chrome.tabs.update(tabs[0].id, { url: DASHBOARD, active: true });
    await setStatus("dashboard focused — connecting");
  }
}

async function setStatus(status) {
  await chrome.storage.local.set({ lastStatus: status, lastAt: Date.now() });
  const text = status.startsWith("connected")
    ? "on"
    : status.includes("missing") ||
        status.includes("disabled") ||
        status.includes("Add extension") ||
        status.startsWith("upgrade")
      ? "!"
      : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: status.startsWith("connected") ? "#1a7f37" : "#b42318",
  });
}
