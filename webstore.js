(function () {
  const SETUPVPN_ID = "oofgbpoabipfcfjapgnbbjjaenockbdp";
  if (!location.href.includes(SETUPVPN_ID) && !/setupvpn/i.test(document.title + location.href)) {
    // still try on detail pages that contain the id in URL
  }

  let clicked = false;

  function findAddButton() {
    const candidates = [
      ...document.querySelectorAll("button, div[role='button'], a"),
    ];
    for (const el of candidates) {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^(add to chrome|add extension|install)$/i.test(text)) return el;
      if (/add to chrome/i.test(text) && text.length < 40) return el;
    }
    return null;
  }

  function tryClick() {
    if (clicked) return;
    const btn = findAddButton();
    if (!btn) return;
    clicked = true;
    btn.click();
    try {
      chrome.runtime.sendMessage({
        type: "status",
        status: "clicked Add to Chrome — confirm the Chrome dialog",
      }, () => { void chrome.runtime.lastError; });
    } catch (_err) {}
  }

  const obs = new MutationObserver(tryClick);
  if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  tryClick();
  setInterval(tryClick, 1500);
})();
