(function () {
  const SETUPVPN_ID = "oofgbpoabipfcfjapgnbbjjaenockbdp";
  let clicked = false;

  function visible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findAddButton() {
    const candidates = [
      ...document.querySelectorAll("button, div[role='button'], a, span[role='button']"),
    ];
    for (const el of candidates) {
      if (!visible(el)) continue;
      const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (/^(add to chrome|add extension|install)$/i.test(text)) return el;
      if (/add to chrome/i.test(text) && text.length < 48) return el;
    }
    return null;
  }

  function tryClick() {
    if (clicked) return;
    if (SETUPVPN_ID && location.href && !location.href.includes(SETUPVPN_ID) && !/setupvpn/i.test(document.title)) {
      // still allow if landed on store search; prefer id pages
    }
    const btn = findAddButton();
    if (!btn) return;
    clicked = true;
    btn.click();
    try {
      chrome.runtime.sendMessage(
        { type: "status", status: "clicked Add to Chrome — confirm the Chrome dialog" },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch (_err) {}
  }

  const obs = new MutationObserver(tryClick);
  if (document.documentElement) {
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
  tryClick();
  setInterval(tryClick, 1000);
})();
