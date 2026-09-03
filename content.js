(function () {
  const UPGRADE = /upgrade|need to upgrade|get premium|premium required|trial ended|buy premium/i;
  const CONNECTED_TO = /connected to\s+([A-Za-z][A-Za-z .'-]{1,40})/i;
  const TIME_REMAINING = /time remaining\s+(\d{1,2}):(\d{2}):(\d{2})/i;
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

  function bodyText() {
    try {
      const root = document.body || document.documentElement;
      return root ? String(root.textContent || "") : "";
    } catch (_err) {
      return "";
    }
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function safeSend(status) {
    try {
      chrome.runtime.sendMessage({ type: "status", status }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_err) {}
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
    try {
      const m = String(href()).match(/^(https:\/\/user\d+\.setupvpn\.com)\/ui\//i);
      if (!m) return;
      await chrome.storage.local.set({ dashboardUrl: m[1] + "/ui/dashboard" });
    } catch (_err) {}
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

  function clickLabeledButton(patterns) {
    const buttons = document.querySelectorAll(
      "button, [role='button'], a.ant-btn, a.ant-btn-primary, input[type='button'], input[type='submit']"
    );
    for (const el of buttons) {
      const t = labelText(el) || el.value || "";
      const text = String(t).replace(/\s+/g, " ").trim();
      if (!text || text.length > 80) continue;
      for (const re of patterns) {
        if (re.test(text)) {
          try {
            el.click();
          } catch (_err) {}
          return text;
        }
      }
    }
    return null;
  }

  function coolClick(patterns, statusPrefix) {
    const now = Date.now();
    if (now - lastClick < 1500) return false;
    const clicked = clickLabeledButton(patterns);
    if (!clicked) return false;
    lastClick = now;
    safeSend((statusPrefix || "clicked") + " " + clicked);
    return true;
  }

  // Step: /ui/?d=... or dashboard onboarding overlay → Next
  function advanceOnboarding() {
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

  // Step: /ui/login → Connect to VPN
  function clickConnectToVpn() {
    if (!isLoginPage() && !/connect to vpn/i.test(bodyText())) return false;
    return coolClick(
      [
        /^connect to vpn$/i,
        /connect to vpn/i,
        /^connect$/i,
        /^start connection$/i,
        /^continue as guest$/i,
        /^guest$/i,
      ],
      "login"
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
    return m[1].replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  }

  function detectTimeRemaining() {
    const m = bodyText().match(TIME_REMAINING);
    if (!m) return null;
    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    const seconds = Number(m[3]);
    const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
    const text =
      String(hours).padStart(2, "0") +
      ":" +
      String(minutes).padStart(2, "0") +
      ":" +
      String(seconds).padStart(2, "0");
    return { text, endsAt: Date.now() + totalMs };
  }

  function isConnected() {
    const t = bodyText();
    return (
      CONNECTED_TO.test(t) ||
      /you are successfully connected/i.test(t) ||
      TIME_REMAINING.test(t)
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
    const exact = new RegExp("^" + escapeRegExp(country) + "$", "i");
    const soft = new RegExp(escapeRegExp(country), "i");
    const nodes = document.querySelectorAll(
      "li, button, a, [role='button'], .ant-list-item, .list-item"
    );
    for (const el of nodes) {
      const text = labelText(el);
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
      safeSend("looking for " + country);
      return false;
    }
    lastClick = now;
    try {
      el.click();
    } catch (_err) {}
    safeSend("clicked " + country);
    return true;
  }

  async function loadSettings() {
    try {
      settings = await chrome.storage.local.get(DEFAULTS);
    } catch (_err) {
      settings = { ...DEFAULTS };
    }
  }

  async function rememberCountry(country) {
    if (!country || !settings.rememberLastLocation) return;
    if (settings.lastConnectedCountry === country) return;
    settings.lastConnectedCountry = country;
    try {
      await chrome.storage.local.set({ lastConnectedCountry: country });
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
    if (!watching || ticking) return;
    ticking = true;
    try {
      await loadSettings();
      await rememberDashboardHost();
      if (!settings.enabled) return;

      // Full flow order:
      // 1) /ui/?d=... Next
      // 2) dashboard Next (intro)
      // 3) /ui/login → Connect to VPN
      // 4) agree Terms + 18+
      // 5) selection page → country
      if (advanceOnboarding()) return;
      if (clickConnectToVpn()) return;
      if (acceptGuestAgreements()) return;

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
          detected || settings.lastConnectedCountry || settings.country || "VPN";
        const rem = settings.timeRemainingText
          ? " · " + settings.timeRemainingText + " left"
          : "";
        safeSend("connected to " + shown + rem);
        return;
      }

      await saveTimeRemaining(null);

      // Only hammer country clicks on selection/dashboard, not login/onboarding
      if (isLoginPage() || isOnboardingQueryPage() || isGuestPage()) return;

      clickCountry(targetCountry());
    } catch (err) {
      console.warn("setupvpn-reconnector tick failed", err);
    } finally {
      ticking = false;
    }
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    const ms = Math.max(2, Number(settings.checkSeconds) || 4) * 1000;
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

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area && area !== "local") return;
    const touched = Object.keys(changes || {});
    if (!touched.some((k) => CONFIG_KEYS[k])) return;
    watching = true;
    await loadSettings();
    restartTimer();
    tick();
  });

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

  loadSettings().then(() => {
    restartTimer();
    tick();
  });
})();
