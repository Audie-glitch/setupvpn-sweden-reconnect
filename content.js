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
      // textContent avoids layout thrash (innerText can re-enter MutationObserver)
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
      "button, [role='button'], a.ant-btn, a.ant-btn-primary"
    );
    for (const el of buttons) {
      const t = labelText(el);
      if (!t || t.length > 60) continue;
      for (const re of patterns) {
        if (re.test(t)) {
          try {
            el.click();
          } catch (_err) {}
          return t;
        }
      }
    }
    return null;
  }

  function clickContinue() {
    return !!clickLabeledButton([
      /^(continue|agree|accept|confirm|get started|next)$/i,
      /^(start connection|start connecting|connect now|connect)$/i,
    ]);
  }


  function clickOnboardingNext() {
    // Post-install wizard: "Extension successfully installed" / "Servers across the globe" with Next
    const t = bodyText();
    const onWizard =
      /extension successfully installed/i.test(t) ||
      /servers across the globe/i.test(t) ||
      (/\/ui\/?\?d=/i.test(location.href) && /next/i.test(t));
    if (!onWizard) return false;
    const clicked = clickLabeledButton([/^next$/i, /^continue$/i, /^got it$/i, /^ok$/i]);
    if (clicked) {
      safeSend("clicked onboarding " + clicked);
      return true;
    }
    return false;
  }

  function clickStartConnection() {
    const clicked = clickLabeledButton([
      /^(start connection|start connecting|connect now|connect|reconnect)$/i,
      /start connection/i,
    ]);
    if (clicked) {
      safeSend("clicked " + clicked);
      return true;
    }
    return false;
  }

  function isGuestPage() {
    return /\/ui\/guest\/?/i.test(location.pathname || "");
  }

  function acceptGuestAgreements() {
    if (settings.autoAgreeGuest === false) return false;
    // Only on the guest gate — dashboard footers also mention Privacy Policy.
    if (!isGuestPage()) return false;

    const terms =
      findCheckboxNear(
        /i agree to the terms and conditions,\s*privacy policy,\s*license agreement/i
      ) ||
      findCheckboxNear(/terms and conditions.*privacy policy.*license agreement/i);
    const age =
      findCheckboxNear(/i confirm,?\s*that i am 18 years of age or older/i) ||
      findCheckboxNear(/18 years of age or older/i);

    let changed = false;
    if (terms) changed = ensureChecked(terms) || changed;
    if (age) changed = ensureChecked(age) || changed;

    const now = Date.now();
    if (now - lastClick > 1500) {
      if (clickContinue()) {
        lastClick = now;
        safeSend("accepted guest terms + 18+ — continuing");
        return true;
      }
    }
    if (changed) safeSend("checked guest agreements");
    return true;
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


  async function rememberDashboardHost() {
    try {
      const m = String(location.href || "").match(/^(https:\/\/user\d+\.setupvpn\.com)\/ui\//i);
      if (!m) return;
      await chrome.storage.local.set({ dashboardUrl: m[1] + "/ui/dashboard" });
    } catch (_err) {}
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

      const now = Date.now();
      if (now - lastClick > 1500 && clickOnboardingNext()) {
        lastClick = now;
        return;
      }
      if (now - lastClick > 1500 && clickStartConnection()) {
        lastClick = now;
        return;
      }

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
