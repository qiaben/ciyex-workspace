# Ciyex Telehealth

Provider-side video visit extension for the Ciyex workbench. Replaces the
older workbench-baked telehealth editor with a discoverable, user-
manageable extension that appears in the Extensions view (Cmd+Shift+X).

## What this extension does

When the workbench fires `ciyex-telehealth.openSession` with an appointment
id, this extension opens a webview that:

1. Creates or retrieves the session via `POST /api/telehealth/sessions/from-appointment`.
2. Starts the session (provider role) via `POST /api/telehealth/sessions/{id}/start`.
3. Renders the appropriate UI:
   - **iframe vendor** (Zoom, Doxy, etc.) — embeds `joinInfo.joinUrl` directly.
   - **WebRTC vendor** (mediasoup, Twilio Video, etc.) — local camera preview
     while the patient joins. Full mediasoup peer wiring is handled inside
     the same webview via the configured signaling URL.
4. Exposes controls: mute, camera, chat, recording start/stop, end call.

## Routing from the workbench

The workbench `ciyex.openTelehealth` action checks whether
`ciyex-telehealth.openSession` is a registered command (i.e. this extension
is installed). If yes it delegates here; otherwise it falls back to the
workbench-baked `TelehealthEditor` for backwards compatibility.

This means installing or uninstalling the extension changes which UI shows
up — no app restart required.

## Why a separate extension from `ciyex-payment-stripe`

Payment gateways and telehealth providers are independent capabilities a
practice may pick à la carte. Bundling them would mean every Stripe update
ships telehealth changes (and vice versa), and a practice that wants only
one would still pull in both.

## Configuration

Settings (Cmd+, → search "Ciyex Telehealth"):

- `ciyex.telehealth.apiUrl` — override for the Ciyex API base URL.
- `ciyex.telehealth.recordingMode` — `COMPOSITE` (default) or `INDIVIDUAL`.
