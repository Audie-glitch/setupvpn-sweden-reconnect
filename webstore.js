(function () {
  // Default: do NOT auto-click Add to Chrome.
  // User clicks Add to Chrome + Chrome's Add extension confirm.
  // Companion waits via chrome.management.onInstalled, then continues the UI flow.
  const params = new URLSearchParams(location.search);
  const allowAuto = params.get("svpn_auto_add") === "1";

  chrome.storage.local.get({ autoClickAddToChrome: false }, (cfg) => {
    if (!allowAuto && !cfg.autoClickAddToChrome) {
      try {
        chrome.runtime.sendMessage(
          {
            type: "status",
            status: "Waiting — click Add to Chrome, then Accept on the popup",
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      } catch (_err) {}
      return;
    }

    // Optional legacy auto-click path (off by default)
    const SETUPVPN_ID = "oofgbpoabipfcfjapgnbbjjaenockbdp";
    let clicked = false;
    let attempts = 0;

    function visible(el) {
      if (!el || !(el instanceof Element)) return false;
      const s = window.getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }

    function textOf(el) {
      return (el.innerText || el.textContent || el.getAttribute("aria-label") || el.title || "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function walk(root, out) {
      if (!root) return;
      const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const el of nodes) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot, out);
      }
    }

    function findAddButton() {
      const out = [];
      walk(document, out);
      for (const el of out) {
        const tag = (el.tagName || "").toLowerCase();
        if (!(tag === "button" || el.getAttribute("role") === "button" || tag === "a")) continue;
        if (!visible(el)) continue;
        const text = textOf(el);
        if (/^(add to chrome|add extension|install)$/i.test(text)) return el;
        if (/add to chrome/i.test(text) && text.length < 64) return el;
      }
      return null;
    }

    function tryClick() {
      if (clicked || attempts > 90) return;
      attempts += 1;
      if (location.href && !location.href.includes(SETUPVPN_ID)) return;
      const btn = findAddButton();
      if (!btn) return;
      clicked = true;
      btn.click();
    }

    setInterval(tryClick, 1000);
    tryClick();
  });
})();
