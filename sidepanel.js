const frame = document.getElementById("frame");
const empty = document.getElementById("empty");
const statusEl = document.getElementById("status");

function dashFromHost(url) {
  const m = String(url || "").match(/^(https:\/\/user\d+\.setupvpn\.com)/i);
  return m ? m[1] + "/ui/dashboard" : "";
}

async function resolveUrl() {
  const { dashboardUrl } = await chrome.storage.local.get({ dashboardUrl: "" });
  let url = dashFromHost(dashboardUrl) || String(dashboardUrl || "");
  if (/\/ui\//i.test(url) && !/\/ui\/dashboard/i.test(url)) {
    url = url.replace(/\/ui\/.*$/i, "/ui/dashboard");
  }
  if (url) return url;

  // Prefer any open SetupVPN tab host
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

async function loadFrame() {
  const url = await resolveUrl();
  const { lastStatus } = await chrome.storage.local.get({ lastStatus: "" });
  if (!url) {
    frame.removeAttribute("src");
    empty.classList.add("show");
    statusEl.textContent = lastStatus || "waiting for SetupVPN host";
    return;
  }
  empty.classList.remove("show");
  if (frame.src !== url) frame.src = url;
  statusEl.textContent = (lastStatus ? lastStatus + " · " : "") + url.replace(/^https:\/\//, "");
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
    await chrome.tabs.update(tabs[0].id, { active: true, url: tabs[0].url || url });
    if (tabs[0].windowId != null) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url, active: true });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.dashboardUrl || changes.lastStatus) loadFrame();
});

loadFrame();
setInterval(loadFrame, 5000);
