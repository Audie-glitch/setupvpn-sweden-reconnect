document.getElementById("dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://user3.setupvpn.com/ui/dashboard" });
});
