async function dashUrl() {
  const { dashboardUrl, popupDashboardLink } = await chrome.storage.local.get({
    dashboardUrl: "",
    popupDashboardLink: "",
  });
  const raw = popupDashboardLink || dashboardUrl || "";
  const m = String(raw).match(/^(https:\/\/user\d+\.setupvpn\.com)/i);
  return m ? m[1] + "/ui/dashboard" : "https://user7.setupvpn.com/ui/dashboard";
}

document.getElementById("dashboard").addEventListener("click", async () => {
  chrome.tabs.create({ url: await dashUrl() });
});

document.getElementById("install").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "checkSetupVpn", forcePrompt: true }, () => {
    void chrome.runtime.lastError;
  });
});

const extBtn = document.getElementById("extensions");
if (extBtn) {
  extBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions" });
  });
}
