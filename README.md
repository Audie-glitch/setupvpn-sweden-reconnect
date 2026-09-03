# SetupVPN Sweden Reconnector

Companion Chrome extension. When the SetupVPN dashboard drops back to the country list, it clicks your chosen free country again.

It does **not** modify SetupVPN, spoof premium, or skip an upgrade wall. If the page says you need to upgrade and that option is enabled, this helper stops.

## Install → agree → connect

On install of this helper (or via the popup action):
1. Opens the SetupVPN Web Store page and clicks **Add to Chrome** when it can
2. You click Chrome’s **Add extension** confirm (required by Chrome; cannot be automated by an extension)
3. On SetupVPN install/enable, opens the dashboard/guest page, auto-checks Terms + 18+, continues, then connects to the remembered/fallback country

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
