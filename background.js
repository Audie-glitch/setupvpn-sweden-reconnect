const DASHBOARD_FALLBACK = "https://user7.setupvpn.com/ui/dashboard";
const ALARM = "sweden-watch";

async function resolveDashboardUrl() {
  const tabs = await chrome.tabs.query({ url: "https://*.setupvpn.com/ui/*" });
  for (const tab of tabs) {
    const m = String(tab.url || "").match(/^(https:\/\/user\d+\.setupvpn\.com)\/ui\//i);
    if (m) return m[1] + "/ui/dashboard";
  }
  // Prefer last known host from storage if we saved one
  const { dashboardUrl } = await chrome.storage.local.get({ dashboardUrl: "" });
  if (dashboardUrl) return dashboardUrl;
  return DASHBOARD_FALLBACK;
}

async function rememberDashboardFromTab(url) {
  const m = String(url || "").match(/^(https:\/\/user\d+\.setupvpn\.com)\/ui\//i);
  if (!m) return;
  await chrome.storage.local.set({ dashboardUrl: m[1] + "/ui/dashboard" });
}

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
  autoClickAddToChrome: false,
  lastInstallPromptAt: 0,
  lastStatus: "installed",
  lastAt: Date.now(),
};

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const current = await chrome.storage.local.get(null);
    await chrome.storage.local.set({ ...DEFAULTS, ...current, lastAt: Date.now() });
    chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });

    // Unpacked "Reload" fires reason=update. If SetupVPN is missing/disabled,
    // immediately open the Web Store and drive Add to Chrome → connect.
    if (details.reason === "install") {
      chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
    }

    const state = await refreshSetupVpnState();
    if (!state.setupvpnInstalled || !state.setupvpnEnabled) {
      await setStatus("SetupVPN missing — starting install on reload");
      await startInstallAndConnectFlow(true);
      return;
    }

    // Already present: after reload, reconnect.
    await chrome.storage.local.set({ pendingConnect: true });
    await openDashboardAndConnect(true);
  } catch (err) {
    console.error("onInstalled failed", err);
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  refreshSetupVpnState().catch((err) => console.error(err));
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  try {
    const state = await refreshSetupVpnState();
    const cfg = await chrome.storage.local.get({
      enabled: true,
      autoOpenDashboard: true,
      pendingConnect: false,
    });
    if (!cfg.enabled) return;

    if (!state.setupvpnInstalled || !state.setupvpnEnabled) {
      await maybeOpenStore(false);
      return;
    }

    if (cfg.pendingConnect) {
      await openDashboardAndConnect(true);
      return;
    }

    if (cfg.autoOpenDashboard) {
      const tabs = await chrome.tabs.query({ url: "https://*.setupvpn.com/ui/*" });
      if (tabs.length === 0) {
        // Do not invent a userN URL — wait for SetupVPN's own open.
        await setStatus("waiting for SetupVPN tab (click its icon)");
      }
    }
  } catch (err) {
    console.error("alarm failed", err);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "status") {
    setStatus(msg.status)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "checkSetupVpn") {
    startInstallAndConnectFlow(!!msg.forcePrompt)
      .then((state) => sendResponse(state))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg.type === "startFullFlow") {
    startInstallAndConnectFlow(true)
      .then((state) => sendResponse(state))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
  if (msg.type === "staleLink") {
    findActiveHostAndOpen(msg.url)
      .then((url) => sendResponse({ ok: true, url }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

function watchManagement() {
  if (!chrome.management) return;
  chrome.management.onInstalled.addListener(async (info) => {
    if (!info || info.id !== SETUPVPN_ID) return;
    await setStatus("SetupVPN installed — running Next → Connect → agree → country");
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
    });
    await startInstallAndConnectFlow(true);
  });
  chrome.management.onEnabled.addListener(async (info) => {
    if (!info || info.id !== SETUPVPN_ID) return;
    await chrome.storage.local.set({
      setupvpnInstalled: true,
      setupvpnEnabled: true,
      pendingConnect: true,
    });
    await openDashboardAndConnect(true);
  });
  chrome.management.onDisabled.addListener(async (info) => {
    if (!info || info.id !== SETUPVPN_ID) return;
    await chrome.storage.local.set({ setupvpnEnabled: false });
    await setStatus("SetupVPN disabled — enable it");
  });
}
watchManagement();

function watchSetupVpnTabs() {
  const consider = async (tabId, url) => {
    if (!url || !/^https:\/\/user\d+\.setupvpn\.com\/ui\//i.test(url)) return;
    const { pendingConnect } = await chrome.storage.local.get({ pendingConnect: false });
    await rememberDashboardFromTab(url);
    if (!pendingConnect) return;
    await setStatus("SetupVPN opened " + url.split("/")[2] + " — advancing flow");
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch (_err) {}
  };

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === "complete" || info.url) {
      consider(tabId, (info.url || (tab && tab.url) || "")).catch(() => {});
    }
  });
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab && tab.url) consider(tab.id, tab.url).catch(() => {});
  });
}
watchSetupVpnTabs();


async function getSetupVpnState() {
  try {
    if (!chrome.management || !chrome.management.get) {
      return { setupvpnInstalled: false, setupvpnEnabled: false };
    }
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


async function injectWebstoreClicker(tabId) {
  if (!chrome.scripting || !chrome.scripting.executeScript) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["webstore.js"],
    });
  } catch (err) {
    console.warn("webstore inject failed", err);
  }
}

async function maybeOpenStore(forcePrompt) {
  const { lastInstallPromptAt } = await chrome.storage.local.get({
    lastInstallPromptAt: 0,
  });
  const due = forcePrompt || Date.now() - lastInstallPromptAt > 6 * 60 * 60 * 1000;
  if (!due) return;

  const existing = await chrome.tabs.query({
    url: [
      "https://chromewebstore.google.com/*",
      "https://chrome.google.com/webstore/*",
    ],
  });
  let tabId;
  if (existing.length) {
    const tab =
      existing.find((t) => (t.url || "").includes(SETUPVPN_ID)) || existing[0];
    await chrome.tabs.update(tab.id, { url: STORE, active: true });
    tabId = tab.id;
  } else {
    const tab = await chrome.tabs.create({ url: STORE, active: true });
    tabId = tab.id;
  }
  await chrome.storage.local.set({ lastInstallPromptAt: Date.now() });
  await setStatus("Waiting — click Add to Chrome, then Accept on the popup");

  // Content scripts can miss the new Web Store shadow DOM; also inject on load.
  const onUpdated = async (id, info) => {
    if (id !== tabId || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    await injectWebstoreClicker(tabId);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  // If already complete
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      await injectWebstoreClicker(tabId);
    }
  } catch (_err) {}
}


async function findActiveHostAndOpen(_badUrl) {
  // Never invent userN/login — SetupVPN rotates domains.
  // Wait for SetupVPN to open the active link (toolbar icon / its own auto-open).
  await chrome.storage.local.set({ pendingConnect: true, dashboardUrl: "" });
  await setStatus("stale link — click SetupVPN icon (waiting for its tab)");
  return null;
}

async function openDashboardAndConnect(markPending) {
  if (markPending) {
    await chrome.storage.local.set({ pendingConnect: true });
  }
  const tabs = await chrome.tabs.query({ url: "https://*.setupvpn.com/ui/*" });

  // Use whatever SetupVPN (or the user) already opened — do not invent userN/login.
  if (tabs.length) {
    // Prefer non-stale looking tabs: login/guest/onboarding/dashboard with a live host
    const preferred =
      tabs.find((t) => /\/ui\/(login|guest)/i.test(t.url || "")) ||
      tabs.find((t) => /\/ui\/dashboard/i.test(t.url || "")) ||
      tabs[0];
    await rememberDashboardFromTab(preferred.url);
    await chrome.tabs.update(preferred.id, { active: true });
    await setStatus("SetupVPN tab ready — advancing flow");
    return;
  }

  // No tab yet: wait for SetupVPN auto-open / toolbar icon. Do NOT create user2 login.
  await setStatus("waiting for SetupVPN to open its tab (click its icon if needed)");
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
