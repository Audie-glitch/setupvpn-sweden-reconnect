(function () {
  const CHECK_MS = 4000;
  const COOLDOWN_MS = 20000;
  const UPGRADE = /upgrade|need to upgrade|get premium|premium required|trial ended|buy premium/i;
  const CONNECTED = /you are successfully connected|connected to sweden|time remaining/i;

  let lastClick = 0;
  let watching = true;

  function bodyText() {
    return (document.body && document.body.innerText) || "";
  }

  function isUpgrade() {
    return UPGRADE.test(bodyText());
  }

  function isConnected() {
    const t = bodyText();
    return /connected to sweden/i.test(t) || CONNECTED.test(t);
  }

  function findSweden() {
    const nodes = document.querySelectorAll("li, button, a, [role='button'], .ant-list-item, .list-item");
    for (const el of nodes) {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^sweden$/i.test(text)) return el;
      if (/sweden/i.test(text) && text.length < 48 && !/premium/i.test(text)) return el;
    }
    return null;
  }

  function clickSweden() {
    const now = Date.now();
    if (now - lastClick < COOLDOWN_MS) return false;
    const el = findSweden();
    if (!el) return false;
    lastClick = now;
    el.click();
    chrome.runtime.sendMessage({ type: "status", status: "clicked Sweden" });
    return true;
  }

  async function tick() {
    if (!watching) return;
    const { enabled } = await chrome.storage.local.get({ enabled: true });
    if (!enabled) return;

    if (isUpgrade()) {
      watching = false;
      chrome.runtime.sendMessage({ type: "status", status: "upgrade wall — stopped" });
      return;
    }

    if (isConnected()) {
      chrome.runtime.sendMessage({ type: "status", status: "connected to Sweden" });
      return;
    }

    clickSweden();
  }

  setInterval(tick, CHECK_MS);
  const obs = new MutationObserver(() => {
    if (Date.now() - lastClick > 1000) tick();
  });
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true });
  }
  tick();
})();
