(function () {
  const SETUPVPN_ID = "oofgbpoabipfcfjapgnbbjjaenockbdp";
  let clicked = false;
  let attempts = 0;

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function textOf(el) {
    return (
      (el.innerText || el.textContent || el.getAttribute("aria-label") || el.title || "")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  function walk(root, out) {
    if (!root) return;
    const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of nodes) {
      out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot, out);
    }
  }

  function allElements() {
    const out = [];
    walk(document, out);
    return out;
  }

  function findAddButton() {
    const candidates = allElements().filter((el) => {
      const tag = (el.tagName || "").toLowerCase();
      return (
        tag === "button" ||
        el.getAttribute("role") === "button" ||
        tag === "a" ||
        (tag === "div" && el.getAttribute("tabindex") != null)
      );
    });
    for (const el of candidates) {
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
    if (location.href && !location.href.includes(SETUPVPN_ID) && !/setupvpn/i.test(document.title || "")) {
      return;
    }
    const btn = findAddButton();
    if (!btn) return;
    clicked = true;
    try {
      btn.focus();
      btn.click();
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    } catch (_err) {}
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
  obs.observe(document.documentElement || document, { childList: true, subtree: true });
  tryClick();
  setInterval(tryClick, 800);
})();
