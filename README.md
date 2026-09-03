# SetupVPN Sweden Reconnector

Companion Chrome extension. When the SetupVPN dashboard drops back to the country list, it clicks your chosen free country again.

It does **not** modify SetupVPN, spoof premium, or skip an upgrade wall. If the page says you need to upgrade and that option is enabled, this helper stops.

## Install → agree → connect

On install **or Reload** of this helper (or via the popup action), if SetupVPN is missing:
1. Opens the SetupVPN Web Store page and **waits** for you to click **Add to Chrome** and Accept the Chrome popup
2. Does **not** invent `userN` URLs — waits for SetupVPN to open its active link (toolbar icon / auto-open). When that tab appears, advances **Next → Connect to VPN → agree → country** automatically
3. (Optional) popup toggle can re-enable auto-clicking Add to Chrome

## SetupVPN required

If SetupVPN (`oofgbpoabipfcfjapgnbbjjaenockbdp`) is missing or disabled, this helper opens an install prompt with the Chrome Web Store link.

## Pin

Chrome does not allow auto-pin. On install/update this opens a short pin prompt; you can also open it from the popup.

## Load / reload

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → `/workspace/setupvpn-sweden-reconnect` (or clone this repo)
4. After updates, hit **Reload** on the extension card

## Popup settings

- **Enabled** — turn the helper on/off
- **Remember last connected location** — detect `Connected to X`, store it, reconnect there on drop
- **Fallback country** — used only when nothing has been remembered yet
- **Time remaining** — live countdown from the dashboard while connected
- **Check every** — how often to look at the dashboard
- **Click cooldown** — minimum time between clicks
- **Auto-open dashboard** — open the UI tab if none is present
- **Stop on upgrade wall** — halt when premium/upgrade text appears


Also auto-clicks **Start connection** / **Connect** CTAs on the SetupVPN UI, then the remembered country.

## Expected SetupVPN UI flow

1. Chrome **Add extension** popup (manual once — Chrome blocks auto-confirm)
2. `https://userN.setupvpn.com/ui/?d=...` → **Next**
3. `.../ui/dashboard` intro → **Next**
4. `.../ui/login` → **Connect to VPN**
5. Agree Terms/Privacy/License + 18+ → **Continue**
6. Selection page → click remembered/fallback country (e.g. Sweden)
