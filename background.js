
async function initSidePanel() {
  try {
    if (!chrome.sidePanel) return;
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
  } catch (err) {
    console.warn("sidePanel init failed", err);
  }
}
initSidePanel();

function watchPendingSidebar() {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.pendingSidebarOpen) return;
    if (!changes.pendingSidebarOpen.newValue) {
      try {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
      } catch (_err) {}
      return;
    }
    try {
      // Next toolbar click opens the side panel (valid user gesture path)
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (_err) {}
  });
}
watchPendingSidebar();

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
  autoOpenSidebar: true,
  lastInstallPromptAt: 0,
  lastStatus: "installed",
  lastAt: Date.now(),
};

function sanitizeStoredCountry(name) {
  if (!name) return "";
  let n = String(name).replace(/\s+/g, " ").trim();
  n = n.replace(/(Disconnect|Guest|Servers|Time|IP|Lookup|Open|mode).*/i, "").trim();
  if (!/^[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,2}$/.test(n)) return "";
  if (n.length < 2 || n.length > 32) return "";
  return n;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const current = await chrome.storage.local.get(null);
    const cleaned = sanitizeStoredCountry(current.lastConnectedCountry);
    await chrome.storage.local.set({
      ...DEFAULTS,
      ...current,
      lastConnectedCountry: cleaned || current.country || DEFAULTS.country,
      lastAt: Date.now(),
    });
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

    // Already present: after reload, reconnect + sidebar.
    await chrome.storage.local.set({ pendingConnect: true });
    await openDashboardSidebar("SetupVPN already installed");
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
  if (msg.type === "clickCountryInPage") {
    const tabId = sender && sender.tab && sender.tab.id;
    trustedClickCountry(tabId, msg.country || "Sweden")
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "resolveDashLink") {
    resolveDashboardLink()
      .then(async (link) => {
        await chrome.storage.local.set({ popupDashboardLink: link || "" });
        sendResponse({ ok: true, link });
      })
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
    await openDashboardSidebar("SetupVPN installed");
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html"), active: false });
    } catch (_err) {}
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
    await openDashboardSidebar("SetupVPN enabled");
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
    await openDashboardSidebar("SetupVPN detected");
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


async function resolveDashboardLink() {
  const { dashboardUrl } = await chrome.storage.local.get({ dashboardUrl: "" });
  let url = String(dashboardUrl || "");
  const m = url.match(/^(https:\/\/user\d+\.setupvpn\.com)/i);
  if (m) return m[1] + "/ui/dashboard";
  try {
    const tabs = await chrome.tabs.query({ url: "https://*.setupvpn.com/ui/*" });
    for (const tab of tabs) {
      const tm = String(tab.url || "").match(/^(https:\/\/user\d+\.setupvpn\.com)/i);
      if (tm) {
        const dash = tm[1] + "/ui/dashboard";
        await chrome.storage.local.set({ dashboardUrl: dash });
        return dash;
      }
    }
  } catch (_err) {}
  return url || "";
}

async function bubbleDashboardLinkInPopup(reason) {
  const link = await resolveDashboardLink();
  await chrome.storage.local.set({
    pendingSidebarOpen: true,
    sidebarBlocked: true,
    popupDashboardLink: link,
  });
  await setStatus(
    link
      ? "sidebar blocked — open popup for link: " + link
      : "sidebar blocked — open popup (waiting for SetupVPN host)"
  );
  try {
    await chrome.action.setBadgeText({ text: "link" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
    if (link) await chrome.action.setTitle({ title: "Dashboard: " + link });
  } catch (_err) {}
  return link;
}

async function openDashboardSidebar(reason) {
  const { autoOpenSidebar } = await chrome.storage.local.get({ autoOpenSidebar: true });
  if (autoOpenSidebar === false) {
    await bubbleDashboardLinkInPopup(reason || "sidebar disabled");
    return false;
  }
  if (!chrome.sidePanel || !chrome.sidePanel.open) {
    await bubbleDashboardLinkInPopup(reason || "no sidePanel API");
    return false;
  }
  try {
    await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
    const win = await chrome.windows.getLastFocused({ populate: false });
    if (win && win.id != null) {
      await chrome.sidePanel.open({ windowId: win.id });
      await chrome.storage.local.set({
        pendingSidebarOpen: false,
        sidebarBlocked: false,
      });
      await setStatus(
        reason ? "sidebar opened — " + reason : "opened SetupVPN dashboard sidebar"
      );
      return true;
    }
  } catch (err) {
    // Chrome often requires a user gesture for sidePanel.open
    console.warn("sidePanel.open failed", err);
  }
  await bubbleDashboardLinkInPopup(reason || "gesture required");
  return false;
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


async function trustedClickCountry(tabId, country) {
  if (!tabId) return { ok: false, error: "no tab" };

  // Country click needs a visible tab (debugger coords + SetupVPN keep-open).
  try {
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (_err) {}

  // 1) MAIN-world: locate row + coords
  const [{ result: loc } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [country],
    func: (countryName) => {
      const exact = new RegExp("^" + countryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
      const items = Array.from(
        document.querySelectorAll("li.ant-list-item.list-item, li.ant-list-item, li.list-item")
      );
      let li = null;
      for (const item of items) {
        const title = item.querySelector("h4.ant-list-item-meta-title, .ant-list-item-meta-title");
        const text = (title && (title.textContent || "") || "").replace(/\s+/g, " ").trim();
        const img = item.querySelector('img[src*="flags/se.png"], img[src*="/se.png"]');
        if ((text && exact.test(text)) || (countryName.toLowerCase() === "sweden" && img)) {
          li = item;
          break;
        }
      }
      if (!li) return { ok: false, error: "row not found", count: items.length };
      try {
        li.scrollIntoView({ block: "center", inline: "nearest" });
      } catch (_err) {}
      const r = li.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return { ok: false, error: "row not visible" };
      const x = Math.floor(r.left + r.width / 2);
      const y = Math.floor(r.top + r.height / 2);
      return {
        ok: true,
        x,
        y,
        width: r.width,
        height: r.height,
        title: (li.querySelector(".ant-list-item-meta-title") || {}).textContent || "",
      };
    },
  });

  if (!loc || !loc.ok) return loc || { ok: false, error: "locate failed" };

  // 2) Trusted mouse via debugger (isTrusted: true) — SetupVPN ignores synthetic clicks
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const opts = { button: "left", buttons: 1, pointerType: "mouse", x: loc.x, y: loc.y };
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...opts,
      buttons: 0,
    });
    await new Promise((r) => setTimeout(r, 120));
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      clickCount: 1,
      ...opts,
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      clickCount: 1,
      button: "left",
      buttons: 0,
      pointerType: "mouse",
      x: loc.x,
      y: loc.y,
    });
    await setStatus("trusted click " + country + " @ " + loc.x + "," + loc.y);
    return { ok: true, via: "debugger", ...loc };
  } catch (err) {
    // 3) Fallback: MAIN-world click (may still fail if isTrusted required)
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [loc.x, loc.y],
        func: (x, y) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return { ok: false, error: "elementFromPoint miss" };
          const li = el.closest("li.ant-list-item, li") || el;
          for (const type of [
            "pointerover",
            "mouseover",
            "mousemove",
            "pointerdown",
            "mousedown",
            "pointerup",
            "mouseup",
            "click",
          ]) {
            el.dispatchEvent(
              new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0,
                buttons: type.includes("down") ? 1 : 0,
              })
            );
          }
          try {
            li.click();
          } catch (_err) {}
          return { ok: true, via: "main", tag: el.tagName };
        },
      });
      return Object.assign({ locate: loc }, result || { ok: false });
    } catch (err2) {
      return { ok: false, error: String(err), fallback: String(err2) };
    }
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch (_err) {}
    }
  }
}

