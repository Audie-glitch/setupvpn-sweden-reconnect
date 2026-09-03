(function () {
  const UPGRADE = /upgrade|need to upgrade|get premium|premium required|trial ended|buy premium/i;
  const CONNECTED_TO = /connected to\s+([A-Za-z][A-Za-z .'-]{1,40})/i;
  const DEFAULTS = {
    enabled: true,
    country: "Sweden",
    checkSeconds: 4,
    cooldownSeconds: 20,
    stopOnUpgrade: true,
    rememberLastLocation: true,
    lastConnectedCountry: "",
  };

  let lastClick = 0;
  let watching = true;
  let timer = null;
  let settings = { ...DEFAULTS };

  function bodyText() {
    return (document.body && document.body.innerText) || "";
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isUpgrade() {
    return UPGRADE.test(bodyText());
  }

  function detectConnectedCountry() {
    const t = bodyText();
    const m = t.match(CONNECTED_TO);
    if (!m) return null;
    return m[1].replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  }

  function isConnected() {
    const t = bodyText();
    return (
      CONNECTED_TO.test(t) ||
      /you are successfully connected/i.test(t) ||
      /time remaining/i.test(t)
    );
  }

  function targetCountry() {
    if (settings.rememberLastLocation && settings.lastConnectedCountry) {
      return settings.lastConnectedCountry;
    }
    return (settings.country || "Sweden").trim();
  }

  function findCountry(country) {
    if (!country) return null;
    const exact = new RegExp(`^${escapeRegExp(country)}$`, "i");
    const soft = new RegExp(escapeRegExp(country), "i");
    const nodes = document.querySelectorAll(
      "li, button, a, [role='button'], .ant-list-item, .list-item"
    );
    for (const el of nodes) {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (exact.test(text)) return el;
      if (soft.test(text) && text.length < 48 && !/premium/i.test(text)) return el;
    }
    return null;
  }

  function clickCountry(country) {
    const now = Date.now();
    const cooldownMs = Math.max(5, Number(settings.cooldownSeconds) || 20) * 1000;
    if (now - lastClick < cooldownMs) return false;
    const el = findCountry(country);
    if (!el) {
      chrome.runtime.sendMessage({
        type: "status",
        status: `looking for ${country}`,
      });
      return false;
    }
    lastClick = now;
    el.click();
    chrome.runtime.sendMessage({
      type: "status",
      status: `clicked ${country}`,
    });
    return true;
  }

  async function loadSettings() {
    settings = await chrome.storage.local.get(DEFAULTS);
  }

  async function rememberCountry(country) {
    if (!country) return;
    if (!settings.rememberLastLocation) return;
    if (settings.lastConnectedCountry === country) return;
    settings.lastConnectedCountry = country;
    await chrome.storage.local.set({ lastConnectedCountry: country });
  }

  async function tick() {
    if (!watching) return;
    await loadSettings();
    if (!settings.enabled) return;

    if (settings.stopOnUpgrade && isUpgrade()) {
      watching = false;
      chrome.runtime.sendMessage({ type: "status", status: "upgrade wall — stopped" });
      return;
    }

    if (isConnected()) {
      const detected = detectConnectedCountry();
      if (detected) await rememberCountry(detected);
      const shown = detected || settings.lastConnectedCountry || settings.country || "VPN";
      chrome.runtime.sendMessage({
        type: "status",
        status: `connected to ${shown}`,
      });
      return;
    }

    clickCountry(targetCountry());
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    const ms = Math.max(2, Number(settings.checkSeconds) || 4) * 1000;
    timer = setInterval(tick, ms);
  }

  chrome.storage.onChanged.addListener(async () => {
    watching = true;
    await loadSettings();
    restartTimer();
    tick();
  });

  const obs = new MutationObserver(() => {
    if (Date.now() - lastClick > 1000) tick();
  });
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true });
  }

  loadSettings().then(() => {
    restartTimer();
    tick();
  });
})();
