const SETUPVPN_ID = "oofgbpoabipfcfjapgnbbjjaenockbdp";
const STORE =
  "https://chromewebstore.google.com/detail/setupvpn-lifetime-free-vpn/oofgbpoabipfcfjapgnbbjjaenockbdp";

document.getElementById("store").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: STORE });
});

async function recheck() {
  const status = document.getElementById("status");
  try {
    const ext = await chrome.management.get(SETUPVPN_ID);
    if (ext && ext.enabled) {
      status.textContent = "SetupVPN is installed and enabled.";
      await chrome.storage.local.set({
        setupvpnInstalled: true,
        setupvpnEnabled: true,
        lastStatus: "SetupVPN detected",
        lastAt: Date.now(),
      });
      chrome.tabs.create({ url: "https://user3.setupvpn.com/ui/dashboard" });
      return;
    }
    if (ext && !ext.enabled) {
      status.textContent = "SetupVPN is installed but disabled. Enable it on chrome://extensions.";
      await chrome.storage.local.set({
        setupvpnInstalled: true,
        setupvpnEnabled: false,
      });
      return;
    }
  } catch (_err) {
    // not installed
  }
  status.textContent = "SetupVPN still not found. Install it from the Web Store, then recheck.";
  await chrome.storage.local.set({
    setupvpnInstalled: false,
    setupvpnEnabled: false,
  });
}

document.getElementById("recheck").addEventListener("click", recheck);
recheck();
