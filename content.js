(function () {
  const UPGRADE = /upgrade|need to upgrade|get premium|premium required|trial ended|buy premium/i;
  const CONNECTED_TO = /connected to\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,2})(?![a-z])/;
  const TIME_REMAINING = /time\s*remaining\s*(\d{1,2}):(\d{2}):(\d{2})/i;
  const CLOCK = /\b(\d{1,2}):(\d{2}):(\d{2})\b/;
  const DEFAULTS = {
    enabled: true,
    country: "Sweden",
    checkSeconds: 4,
    cooldownSeconds: 20,
    stopOnUpgrade: true,
    rememberLastLocation: true,
    lastConnectedCountry: "",
    pendingConnect: false,
    autoAgreeGuest: true,
    timeRemainingText: "",
    timeRemainingEndsAt: 0,
    dashboardUrl: "",
  };

  let lastClick = 0;
  let watching = true;
  let timer = null;
  let settings = { ...DEFAULTS };
  let lastSavedEndsAt = 0;
  let ticking = false;
  let obsTimer = null;
  let dead = false;

  function contextAlive() {
    try {
      return !dead && !!(chrome.runtime && chrome.runtime.id);
    } catch (_err) {
      dead = true;
      return false;
    }
  }

  function kill(reason) {
    if (dead) return;
    dead = true;
    watching = false;
    if (timer) {
      try {
        clearInterval(timer);
      } catch (_err) {}
      timer = null;
    }
    try {
      if (obs) obs.disconnect();
    } catch (_err) {}
    console.debug("setupvpn-reconnector stopped:", reason || "extension context invalidated — refresh this tab");
  }


  function bodyText() {
    try {
      const root = document.body || document.documentElement;
      if (!root) return "";
      // innerText keeps visual word breaks (textContent glues "Sweden"+"Disconnect")
      let t = "";
      try {
        t = root.innerText || "";
      } catch (_err) {
        t = "";
      }
      if (!t) t = root.textContent || "";
      return String(t).replace(/\u00a0/g, " ");
    } catch (_err) {
      return "";
    }
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function safeSend(status) {
    if (!contextAlive()) return;
    try {
      chrome.runtime.sendMessage({ type: "status", status }, () => {
        const err = chrome.runtime.lastError;
        if (err && /context invalidated/i.test(String(err.message || err))) kill("sendMessage");
      });
    } catch (err) {
      if (/context invalidated/i.test(String(err))) kill("sendMessage");
    }
  }

  function labelText(el) {
    try {
      return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    } catch (_err) {
      return "";
    }
  }

  function path() {
    return location.pathname || "";
  }

  function href() {
    return location.href || "";
  }

  function isGuestPage() {
    return /\/ui\/guest\/?/i.test(path());
  }

  function isLoginPage() {
    return /\/ui\/login\/?/i.test(path());
  }

  function isOnboardingQueryPage() {
    // https://userN.setupvpn.com/ui/?d=...
    return /\/ui\/?$/i.test(path()) && /[?&]d=\d+/i.test(location.search || "");
  }

  function isDashboardPage() {
    return /\/ui\/dashboard\/?/i.test(path());
  }

  function isSelectionPage() {
    const t = bodyText();
    return (
      isDashboardPage() &&
      (/select (a )?location|select a country|free servers/i.test(t) ||
        /germany|sweden|netherlands/i.test(t))
    );
  }

  async function rememberDashboardHost() {
    if (!contextAlive()) return;
    try {
      const m = String(href()).match(/^(https:\/\/user\d+\.setupvpn\.com)\/ui\//i);
      if (!m) return;
      await chrome.storage.local.set({ dashboardUrl: m[1] + "/ui/dashboard" });
    } catch (err) {
      if (/context invalidated/i.test(String(err))) kill("rememberDashboardHost");
    }
  }

  function findCheckboxNear(textRe) {
    const labels = document.querySelectorAll("label, .ant-checkbox-wrapper");
    for (const node of labels) {
      const t = labelText(node);
      if (!t || t.length > 180 || !textRe.test(t)) continue;
      const input =
        node.querySelector('input[type="checkbox"]') ||
        (node.htmlFor && document.getElementById(node.htmlFor));
      if (input) return input;
    }
    return null;
  }

  function ensureChecked(input) {
    if (!input) return false;
    if (input.checked) return true;
    try {
      input.click();
    } catch (_err) {}
    if (!input.checked) {
      input.checked = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return !!input.checked;
  }

  function mouseOpts(el, extra) {
    const r = el.getBoundingClientRect();
    const x = Math.max(1, Math.floor(r.left + Math.min(r.width, 40) / 2));
    const y = Math.max(1, Math.floor(r.top + r.height / 2));
    return Object.assign(
      {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: 1,
      },
      extra || {}
    );
  }

  function forceHover(el) {
    if (!el) return;
    const opts = mouseOpts(el, { buttons: 0 });
    try {
      el.dispatchEvent(new MouseEvent("mouseover", opts));
      el.dispatchEvent(new MouseEvent("mouseenter", opts));
      el.dispatchEvent(new PointerEvent("pointerover", opts));
      el.dispatchEvent(new PointerEvent("pointerenter", opts));
      el.dispatchEvent(new MouseEvent("mousemove", opts));
    } catch (_err) {}
  }

  function forceClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (_err) {}
    forceHover(el);
    const down = mouseOpts(el, { buttons: 1 });
    const up = mouseOpts(el, { buttons: 0 });
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", down));
      el.dispatchEvent(new MouseEvent("mousedown", down));
      el.dispatchEvent(new PointerEvent("pointerup", up));
      el.dispatchEvent(new MouseEvent("mouseup", up));
      el.dispatchEvent(new MouseEvent("click", up));
    } catch (_err) {
      try {
        el.click();
      } catch (_err2) {}
    }
    return true;
  }

  function reactClick(el) {
    if (!el) return false;
    let node = el;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const propsKey = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
      if (!propsKey) continue;
      const props = node[propsKey];
      if (!props) continue;
      const handlers = [props.onClick, props.onMouseDown, props.onPointerDown].filter(Boolean);
      for (const fn of handlers) {
        try {
          fn({
            preventDefault() {},
            stopPropagation() {},
            nativeEvent: { preventDefault() {}, stopPropagation() {} },
            currentTarget: node,
            target: el,
            type: "click",
            bubbles: true,
            button: 0,
            buttons: 1,
          });
          return true;
        } catch (_err) {}
      }
    }
    return false;
  }

  function pointClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (_err) {}
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const x = Math.floor(r.left + Math.min(Math.max(r.width / 2, 24), r.width - 4));
    const y = Math.floor(r.top + r.height / 2);
    const top = document.elementFromPoint(x, y) || el;
    forceHover(top);
    forceClick(top);
    reactClick(top);
    if (top !== el) {
      forceHover(el);
      forceClick(el);
      reactClick(el);
    }
    return true;
  }

    function countryRowFrom(el) {
    if (!el) return null;
    return (
      el.closest(".ant-list-item") ||
      el.closest("li.ant-list-item") ||
      el.closest("[role='listitem']") ||
      el.closest("li") ||
      el.closest("[role='button']") ||
      el.closest("button, a, tr") ||
      el
    );
  }

  function allClickables() {
    const sel =
      "button, [role='button'], a, a.ant-btn, a.ant-btn-primary, input[type='button'], input[type='submit'], .ant-btn, div.ant-btn, span.ant-btn";
    const out = Array.from(document.querySelectorAll(sel));
    // Also any element whose own short text matches later filters
    for (const el of document.querySelectorAll("div, span, p, section")) {
      const t = labelText(el);
      if (!t || t.length > 40) continue;
      if (/^connect( to vpn)?$/i.test(t) || /^continue to vpn$/i.test(t) || /^continue as guest$/i.test(t) || /^continue$/i.test(t) || /^next$/i.test(t)) {
        out.push(el);
      }
    }
    return out;
  }

  function clickLabeledButton(patterns) {
    const buttons = allClickables();
    for (const el of buttons) {
      const t = labelText(el) || el.value || el.getAttribute("aria-label") || "";
      const text = String(t).replace(/\s+/g, " ").trim();
      if (!text || text.length > 80) continue;
      for (const re of patterns) {
        if (re.test(text)) {
          // Prefer the closest button-like ancestor if we matched a span/div text node wrapper
          let target = el;
          const btn = el.closest("button, [role='button'], a.ant-btn, .ant-btn, a");
          if (btn) target = btn;
          forceClick(target);
          return text;
        }
      }
    }
    return null;
  }

  function isStaleLinkPage() {
    const t = bodyText();
    return (
      /update connection/i.test(t) &&
      /no longer your active link|click on the setupvpn icon/i.test(t)
    );
  }

  function reportStaleLink() {
    const now = Date.now();
    if (now - lastClick < 4000) return true;
    lastClick = now;
    safeSend("stale link — finding active host");
    try {
      chrome.runtime.sendMessage({ type: "staleLink", url: href() }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_err) {}
    return true;
  }

  function coolClick(patterns, statusPrefix, minGapMs) {
    const now = Date.now();
    const gap = minGapMs == null ? 1200 : minGapMs;
    if (now - lastClick < gap) return false;
    const clicked = clickLabeledButton(patterns);
    if (!clicked) return false;
    lastClick = now;
    safeSend((statusPrefix || "clicked") + " " + clicked);
    return true;
  }

  // Step: /ui/?d=... or dashboard onboarding overlay → Next
  function advanceOnboarding() {
    // Don't click Next while the location list is still loading
    if (onSelectLocationScreen() && !locationsReady() && /select location|free servers/i.test(bodyText())) {
      return false;
    }
    const t = bodyText();
    const looksLikeWizard =
      isOnboardingQueryPage() ||
      /extension successfully installed/i.test(t) ||
      /servers across the globe/i.test(t) ||
      (/how does it work/i.test(t) && /next/i.test(t) && !isSelectionPage());

    // Dashboard can also show a Next carousel before selection is usable
    if (isDashboardPage() && /next/i.test(t) && !/free servers/i.test(t) && !isConnected()) {
      // allow Next on dashboard intro
    } else if (!looksLikeWizard && !(isDashboardPage() && /next/i.test(t) && !isSelectionPage())) {
      if (!isOnboardingQueryPage()) return false;
    }

    return coolClick(
      [/^next$/i, /^continue$/i, /^got it$/i, /^ok$/i, /^get started$/i],
      "onboarding"
    );
  }

  // Step: /ui/login → Continue to VPN (also legacy Connect to VPN)
  function clickConnectToVpn() {
    const t = bodyText();
    const onLogin =
      isLoginPage() ||
      /continue to vpn/i.test(t) ||
      /connect to vpn/i.test(t) ||
      /continue to start vpn connection/i.test(t) ||
      (/log ?in/i.test(t) && /connect|vpn/i.test(t));
    if (!onLogin) return false;
    return coolClick(
      [
        /^continue to vpn$/i,
        /continue to vpn/i,
        /^connect to vpn$/i,
        /connect to vpn/i,
        /^continue$/i,
        /^connect$/i,
        /^start connection$/i,
        /^continue as guest$/i,
        /^guest$/i,
      ],
      "login",
      800
    );
  }

  // Step: agree Terms + 18+
  function acceptGuestAgreements() {
    if (settings.autoAgreeGuest === false) return false;
    const t = bodyText();
    const hasAgreeText =
      /i agree to the terms and conditions/i.test(t) ||
      (/terms and conditions/i.test(t) && /privacy policy/i.test(t) && /license agreement/i.test(t));
    const hasAgeText =
      /i confirm,?\s*that i am 18 years of age or older/i.test(t) ||
      /18 years of age or older/i.test(t);

    // Guest page OR any page currently showing the agreement card
    if (!isGuestPage() && !(hasAgreeText && hasAgeText)) return false;

    const terms =
      findCheckboxNear(
        /i agree to the terms and conditions,\s*privacy policy,\s*license agreement/i
      ) ||
      findCheckboxNear(/terms and conditions.*privacy policy.*license agreement/i);
    const age =
      findCheckboxNear(/i confirm,?\s*that i am 18 years of age or older/i) ||
      findCheckboxNear(/18 years of age or older/i);

    if (terms) ensureChecked(terms);
    if (age) ensureChecked(age);

    return coolClick(
      [/^continue$/i, /^agree$/i, /^accept$/i, /^confirm$/i, /^next$/i],
      "agreed"
    );
  }

  function isUpgrade() {
    return UPGRADE.test(bodyText());
  }

  function detectConnectedCountry() {
    const m = bodyText().match(CONNECTED_TO);
    if (!m) return null;
    let name = m[1].replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
    // Strip glued UI words if regex still over-captured
    name = name.replace(/(Disconnect|Guest|Servers|Time|IP|Lookup|Open).*/i, "").trim();
    if (!name || name.length > 40) return null;
    return name;
  }

  function parseClock(m) {
    if (!m) return null;
    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    const seconds = Number(m[3]);
    if (![hours, minutes, seconds].every((n) => Number.isFinite(n))) return null;
    const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
    const text =
      String(hours).padStart(2, "0") +
      ":" +
      String(minutes).padStart(2, "0") +
      ":" +
      String(seconds).padStart(2, "0");
    return { text, endsAt: Date.now() + totalMs };
  }

  function detectTimeRemaining() {
    const fromBody = parseClock(bodyText().match(TIME_REMAINING));
    if (fromBody) return fromBody;

    // DOM walk: label "Time remaining" near an HH:MM:SS node (antd splits them)
    const nodes = document.querySelectorAll("div, span, p, li, td, strong, b");
    for (const el of nodes) {
      let raw = "";
      try {
        raw = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      } catch (_err) {
        continue;
      }
      if (!raw || raw.length > 64) continue;
      if (/time\s*remaining/i.test(raw)) {
        const m = raw.match(TIME_REMAINING) || raw.match(CLOCK);
        const parsed = parseClock(m);
        if (parsed) return parsed;
        // sibling / child clock
        const parent = el.parentElement;
        if (parent) {
          let pt = "";
          try {
            pt = (parent.innerText || parent.textContent || "").replace(/\s+/g, " ");
          } catch (_err) {}
          const pm = pt.match(TIME_REMAINING) || pt.match(CLOCK);
          const pp = parseClock(pm);
          if (pp) return pp;
        }
      }
      if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) {
        // only accept bare clocks near "remaining"
        const near = (el.parentElement && (el.parentElement.innerText || "")) || "";
        if (/remaining/i.test(near)) {
          const parsed = parseClock(raw.match(CLOCK));
          if (parsed) return parsed;
        }
      }
    }
    return null;
  }

  function isConnected() {
    const t = bodyText();
    return (
      CONNECTED_TO.test(t) ||
      /you are successfully connected/i.test(t) ||
      TIME_REMAINING.test(t)
    );
  }

  function locationsReady() {
    const items = document.querySelectorAll(
      "li.ant-list-item.list-item, li.ant-list-item, .ant-list-item"
    );
    if (!items.length) return false;
    let titled = 0;
    let flagged = 0;
    for (const li of items) {
      const title = li.querySelector("h4.ant-list-item-meta-title, .ant-list-item-meta-title");
      if (title && labelText(title)) titled += 1;
      if (li.querySelector('img[src*="/ui/flags/"], img[src*="flags/"]')) flagged += 1;
    }
    // At least one real country row (title or flag)
    return titled >= 1 || flagged >= 1;
  }

  function onSelectLocationScreen() {
    const t = bodyText();
    return (
      isSelectionPage() ||
      /select location/i.test(t) ||
      /select a country to start vpn/i.test(t) ||
      /free servers/i.test(t)
    );
  }

    function sanitizeCountryName(name) {
    if (!name) return "";
    let n = String(name).replace(/\s+/g, " ").trim();
    n = n.replace(/(Disconnect|Guest|Servers|Time|IP|Lookup|Open|mode).*/i, "").trim();
    // Single country-like token(s)
    const m = n.match(/^[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,2}$/);
    if (!m) return "";
    if (n.length < 2 || n.length > 32) return "";
    return n;
  }

  function targetCountry() {
    const fallback = (settings.country || "Sweden").trim() || "Sweden";
    if (settings.rememberLastLocation) {
      const remembered = sanitizeCountryName(settings.lastConnectedCountry);
      if (remembered) return remembered;
    }
    return fallback;
  }

  function flagCode(country) {
    const map = {
      sweden: "se",
      netherlands: "nl",
      germany: "de",
      "united states": "us",
      usa: "us",
      "united kingdom": "gb",
      uk: "gb",
      poland: "pl",
    };
    return map[String(country || "").toLowerCase()] || "";
  }

  function findCountry(country) {
    if (!country) return null;
    const exact = new RegExp("^" + escapeRegExp(country) + "$", "i");
    const word = new RegExp("(?:^|\\b)" + escapeRegExp(country) + "(?:\\b|$)", "i");
    const code = flagCode(country);

    // Exact SetupVPN row: <li class="ant-list-item list-item">…<img src="/ui/flags/se.png">…<h4>Sweden</h4>
    const items = document.querySelectorAll("li.ant-list-item.list-item, li.ant-list-item, li.list-item");
    for (const li of items) {
      const title = li.querySelector("h4.ant-list-item-meta-title, .ant-list-item-meta-title");
      const titleText = title ? labelText(title) : "";
      const img = li.querySelector('img[src*="/ui/flags/"], img[src*="flags/"]');
      const src = img ? String(img.getAttribute("src") || "") : "";
      const flagHit = code && new RegExp("/" + code + "\\.png(?:\\?|$)", "i").test(src);
      if ((titleText && (exact.test(titleText) || word.test(titleText))) || flagHit) {
        return li;
      }
    }

    const titles = document.querySelectorAll(
      "h4.ant-list-item-meta-title, .ant-list-item-meta-title, .ant-list-item-meta-content"
    );
    for (const title of titles) {
      const text = labelText(title);
      if (!text) continue;
      if (exact.test(text) || word.test(text)) return countryRowFrom(title);
    }

    if (code) {
      const img = document.querySelector(
        'img[src*="/ui/flags/' + code + '.png"], img[src*="flags/' + code + '.png"]'
      );
      if (img) return countryRowFrom(img);
    }

    const nodes = document.querySelectorAll(
      "li, button, a, [role='button'], [role='listitem'], .ant-list-item, .list-item"
    );
    for (const el of nodes) {
      const text = labelText(el);
      if (!text || text.length > 80) continue;
      if (exact.test(text) || (word.test(text) && text.length < 64)) return countryRowFrom(el);
    }
    return null;
  }

  let countryClickInFlight = false;

  function clickCountry(country) {
    const now = Date.now();
    const onSelect = onSelectLocationScreen();
    const reconnecting = onSelect || !!settings.pendingConnect || !isConnected();
    const cooldownMs = reconnecting
      ? 1200
      : Math.max(5, Number(settings.cooldownSeconds) || 20) * 1000;
    if (now - lastClick < cooldownMs) return false;
    if (!locationsReady()) {
      safeSend("waiting for locations to load");
      return false;
    }
    const el = findCountry(country);
    if (!el) {
      // If remembered name is wrong, try fallback country once
      const fallback = (settings.country || "Sweden").trim();
      if (fallback && fallback.toLowerCase() !== String(country).toLowerCase()) {
        safeSend("looking for " + country + " — trying " + fallback);
        country = fallback;
        const el2 = findCountry(country);
        if (!el2) {
          safeSend("looking for " + country);
          return false;
        }
        return clickCountry(country);
      }
      safeSend("looking for " + country);
      return false;
    }
    lastClick = now;
    if (countryClickInFlight) return true;
    countryClickInFlight = true;
    setTimeout(() => {
      countryClickInFlight = false;
    }, 5000);
    safeSend("select location — bubbling " + country);

    try {
      chrome.runtime.sendMessage(
        { type: "clickCountryInPage", country: country },
        (res) => {
          countryClickInFlight = false;
          const err = chrome.runtime.lastError;
          if (err) {
            safeSend("click failed: " + err.message);
            // local fallback
            forceHover(el);
            pointClick(el);
            reactClick(el);
            return;
          }
          if (res && res.ok) {
            safeSend("clicked " + country + (res.via ? " via " + res.via : ""));
            if (settings.pendingConnect) {
              settings.pendingConnect = false;
              try {
                chrome.storage.local.set({ pendingConnect: false });
              } catch (_err) {}
            }
          } else {
            safeSend("click failed: " + ((res && res.error) || "unknown"));
            forceHover(el);
            pointClick(el);
            reactClick(el);
          }
        }
      );
    } catch (_err) {
      countryClickInFlight = false;
      forceHover(el);
      pointClick(el);
      reactClick(el);
    }
    return true;
  }

  async function loadSettings() {
    if (!contextAlive()) {
      settings = { ...DEFAULTS };
      return;
    }
    try {
      settings = await chrome.storage.local.get(DEFAULTS);
    } catch (err) {
      if (/context invalidated/i.test(String(err))) kill("loadSettings");
      settings = { ...DEFAULTS };
    }
  }

  async function rememberCountry(country) {
    if (!settings.rememberLastLocation) return;
    const clean = sanitizeCountryName(country);
    if (!clean) return;
    if (settings.lastConnectedCountry === clean) return;
    settings.lastConnectedCountry = clean;
    try {
      await chrome.storage.local.set({ lastConnectedCountry: clean });
    } catch (_err) {}
  }

  async function saveTimeRemaining(info) {
    try {
      if (!info) {
        if (settings.timeRemainingText || settings.timeRemainingEndsAt) {
          settings.timeRemainingText = "";
          settings.timeRemainingEndsAt = 0;
          lastSavedEndsAt = 0;
          await chrome.storage.local.set({
            timeRemainingText: "",
            timeRemainingEndsAt: 0,
          });
        }
        return;
      }
      if (
        Math.abs(info.endsAt - lastSavedEndsAt) < 2000 &&
        settings.timeRemainingText === info.text
      ) {
        return;
      }
      lastSavedEndsAt = info.endsAt;
      settings.timeRemainingText = info.text;
      settings.timeRemainingEndsAt = info.endsAt;
      await chrome.storage.local.set({
        timeRemainingText: info.text,
        timeRemainingEndsAt: info.endsAt,
      });
    } catch (_err) {}
  }

  async function tick() {
    if (dead || !watching || ticking) return;
    if (!contextAlive()) {
      kill("tick");
      return;
    }
    ticking = true;
    try {
      await loadSettings();
      if (dead) return;
      await rememberDashboardHost();
      if (!settings.enabled) return;

      if (isStaleLinkPage()) {
        reportStaleLink();
        return;
      }

      if (settings.stopOnUpgrade && isUpgrade()) {
        watching = false;
        await saveTimeRemaining(null);
        safeSend("upgrade wall — stopped");
        return;
      }

      if (isConnected()) {
        const detected = detectConnectedCountry();
        if (detected) await rememberCountry(detected);
        await saveTimeRemaining(detectTimeRemaining());
        if (settings.pendingConnect) {
          settings.pendingConnect = false;
          try {
            await chrome.storage.local.set({ pendingConnect: false });
          } catch (_err) {}
        }
        const shown =
          sanitizeCountryName(detected) ||
          sanitizeCountryName(settings.lastConnectedCountry) ||
          settings.country ||
          "VPN";
        const rem = settings.timeRemainingText
          ? " · " + settings.timeRemainingText + " left"
          : "";
        safeSend("connected to " + shown + rem);
        return;
      }

      await saveTimeRemaining(null);

      // Priority: enabled + select location => bubble location (do this first)
      if (onSelectLocationScreen()) {
        if (!locationsReady()) {
          safeSend("waiting for locations to load");
          return;
        }
        clickCountry(targetCountry());
        return;
      }

      // Earlier flow steps only when not on the location list
      if (advanceOnboarding()) return;
      if (clickConnectToVpn()) return;
      if (acceptGuestAgreements()) return;

      if (isLoginPage() || isOnboardingQueryPage() || isGuestPage()) return;

      if (isDashboardPage() && locationsReady()) {
        clickCountry(targetCountry());
      }
    } catch (err) {
      if (/context invalidated/i.test(String(err))) {
        kill("tick");
        return;
      }
      console.warn("setupvpn-reconnector tick failed", err);
    } finally {
      ticking = false;
    }
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    let sec = Math.max(2, Number(settings.checkSeconds) || 4);
    if (
      isLoginPage() ||
      isGuestPage() ||
      isSelectionPage() ||
      onSelectLocationScreen() ||
      settings.pendingConnect
    ) {
      sec = 1;
    }
    const ms = sec * 1000;
    timer = setInterval(tick, ms);
  }

  const CONFIG_KEYS = {
    enabled: true,
    country: true,
    checkSeconds: true,
    cooldownSeconds: true,
    stopOnUpgrade: true,
    rememberLastLocation: true,
    lastConnectedCountry: true,
    pendingConnect: true,
    autoAgreeGuest: true,
  };

  try {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (dead) return;
      if (!contextAlive()) {
        kill("onChanged");
        return;
      }
      if (area && area !== "local") return;
      const touched = Object.keys(changes || {});
      if (!touched.some((k) => CONFIG_KEYS[k])) return;
      watching = true;
      await loadSettings();
      restartTimer();
      tick();
    });
  } catch (_err) {
    kill("onChanged bind");
  }

  const obs = new MutationObserver(() => {
    if (obsTimer) return;
    obsTimer = setTimeout(() => {
      obsTimer = null;
      if (Date.now() - lastClick > 1000) tick();
    }, 500);
  });
  if (document.documentElement) {
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (contextAlive()) {
    loadSettings().then(() => {
      if (dead) return;
      restartTimer();
      tick();
    });
  } else {
    kill("boot");
  }
})();
