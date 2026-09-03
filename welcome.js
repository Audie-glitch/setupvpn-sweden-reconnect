document.getElementById("dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://user3.setupvpn.com/ui/dashboard" });
});

document.getElementById("install").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "checkSetupVpn", forcePrompt: true });
});
