(function () {
  const UPGRADE = /upgrade|need to upgrade|get premium|premium required|trial ended|buy premium/i;
  const DEFAULTS = {
    enabled: true,
    country: "Sweden",
    checkSeconds: 4,
    cooldownSeconds: 20,
    stopOnUpgrade: true,
  };

  let lastClick = 0;
  let watching = true;
  let timer = null;
  let settings = { ...DEFAULTS };

  function bodyText() {
    return (document.body && document.body.innerText) || "";
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isUpgrade() {
    return UPGRADE.test(bodyText());
  }

  function isConnected() {
    const country = settings.country || "Sweden";
    const connectedTo = new RegExp(`connected to ${escapeRegExp(country)}`, "i");
    const t = bodyText();
    return connectedTo.test(t) || /you are successfully connected|time remaining/i.test(t);
  }

  function findCountry() {
    const country = (settings.country || "Sweden").trim();
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

  function clickCountry() {
    const now = Date.now();
    const cooldownMs = Math.max(5, Number(settings.cooldownSeconds) || 20) * 1000;
    if (now - lastClick < cooldownMs) return false;
    const el = findCountry();
    if (!el) return false;
    lastClick = now;
    el.click();
    chrome.runtime.sendMessage({
      type: "status",
      status: `clicked ${settings.country}`,
    });
    return true;
  }

  async function loadSettings() {
    settings = await chrome.storage.local.get(DEFAULTS);
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
      chrome.runtime.sendMessage({
        type: "status",
        status: `connected to ${settings.country}`,
      });
      return;
    }

    clickCountry();
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
