# SetupVPN Sweden Reconnector

Companion Chrome extension. When the SetupVPN dashboard drops back to the country list, it clicks **Sweden** again — the same action that connected Guest mode.

It does **not** modify SetupVPN, spoof premium, or skip an upgrade wall. If the page says you need to upgrade, this helper stops.

## Load it

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select this folder:
   `/workspace/setupvpn-sweden-reconnect`
4. Keep `https://user3.setupvpn.com/ui/dashboard` open (or let the helper open it)

## Behavior

- Checks the dashboard every few seconds
- If it sees “Connected to Sweden”, it waits
- If it sees the free-server list, it clicks Sweden (20s cooldown)
- If it sees upgrade / premium-required text, it stops and badges `!`
