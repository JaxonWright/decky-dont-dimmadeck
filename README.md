# Don't Dimmadeck 🎩

A [Decky](https://github.com/SteamDeckHomebrew/decky-loader) plugin that stops the Steam Deck's screen dimming and the Deck going to sleep while your chosen apps are running.

This is useful for games like the Jackbox Party Packs, where everyone plays on their phones and nobody touches the Deck for twenty minutes at a time. It is equally useful for YouTube, Netflix, Plex, or anything else you watch rather than play.

Pick the apps you care about and the plugin handles the rest. Everything else keeps Steam's normal timers, so your battery life is untouched the rest of the time.

## Installing

The plugin is not in the Decky store yet. To install it now, build it (see below) and either use the resulting zip with Decky's "Install from URL/file", or copy the built files to `~/homebrew/plugins/` on your Deck.

## Using it

Open the Decky menu and pick **Don't Dimmadeck**.

- **Keep awake now** — an immediate override, handy for a long download or an app you have not added yet.
- **Current game** — toggle this on to keep the screen awake every time this app runs.
- **Keeping these awake** — everything you have added. Toggle one off to remove it.

Steam's dim and sleep timers go back to your own settings as soon as the app exits. If you change those settings in Steam while nothing is being kept awake, the plugin notices and restores to the new values next time.

## How it works

SteamOS drives dimming and auto-sleep from Steam client settings, not from a logind idle inhibitor — `systemd-inhibit` has no effect on them. The two timers live in different protobuf messages, written through different setters, and `0` means "never":

| Setting | Message | Field | Written via |
| --- | --- | --- | --- |
| `idle_backlight_dim_battery_seconds` | `CMsgSystemManagerSettings` | 1 (float) | `SteamClient.System.UpdateSettings` |
| `idle_backlight_dim_ac_seconds` | `CMsgSystemManagerSettings` | 2 (float) | `SteamClient.System.UpdateSettings` |
| `system_idle_suspend_battery_sec` | `CMsgClientSettings` | 24003 (int32) | `SteamClient.Settings.SetSetting` |
| `system_idle_suspend_ac_sec` | `CMsgClientSettings` | 24004 (int32) | `SteamClient.Settings.SetSetting` |

Field numbers come from [SteamDatabase/Protobufs](https://github.com/SteamDatabase/Protobufs). The plugin watches `RegisterForAppLifetimeNotifications` for app starts and stops, zeroes those four timers while an enabled app is running, and puts your values back afterwards.

Because Steam persists these settings, the plugin also records what it is holding. If the Deck loses power mid-override, your timers are restored the next time the plugin loads instead of being left off forever.

If you would rather this happened automatically for apps that ask the system not to sleep — VLC, Chrome and mpv do — [DeckyInhibitScreenSaver](https://github.com/xfangfang/DeckyInhibitScreenSaver) takes that approach instead.

## Development

### Prerequisites

- Node.js 18+ and `pnpm` 9 (`sudo npm i -g pnpm@9`) — Decky's submission CI uses pnpm 9, so match it to keep the lockfile readable there.
- The [Decky CLI](https://github.com/SteamDeckHomebrew/cli) to package a zip. `.vscode/setup.sh` will fetch it into `cli/`.

### Building

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # protobuf encoding, against known-good bytes
pnpm build       # -> dist/index.js
pnpm watch       # rebuild on change
```

### Deploying to a Deck

The VS Code tasks in `.vscode/tasks.json` cover the whole loop. Copy `.vscode/defsettings.json` to `.vscode/settings.json`, fill in your Deck's IP, user and SSH details, then run the **builddeploy** task. `cli/decky plugin build .` produces the zip by hand if you would rather not use the tasks.

### Testing

`pnpm test` covers the protobuf encoder, which is the part that can be checked away from the hardware. Everything else — whether Steam accepts the messages, whether the timers actually stop — can only be confirmed on a Deck in game mode. Worth checking by hand after a change:

1. Launch an enabled app, then look at Settings → Display and Settings → Power. Both timers should read as off.
2. Exit it. They should return to whatever they were before.
3. Restart decky-loader while an app is being kept awake. The timers should be restored on load, not left off.

## License

This project is licensed with the [BSD 3-Clause](https://choosealicense.com/licenses/bsd-3-clause/) open-source license.

This allows for the free use, modification, and distribution of software. It requires that any redistributions of the software must include a copy of the license, a disclaimer of liability, and the copyright notice. This license permits commercial use without the obligation to release the source code of derivative works, making it more permissive than copyleft licenses like the GPL.
