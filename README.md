# SetupVPN Sweden Reconnector

Companion Chrome extension. When the SetupVPN dashboard drops back to the country list, it clicks your chosen free country again.

It does **not** modify SetupVPN, spoof premium, or skip an upgrade wall. If the page says you need to upgrade and that option is enabled, this helper stops.

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
