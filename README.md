# Don't Dimmadeck 🎩

A [Decky](https://github.com/SteamDeckHomebrew/decky-loader) plugin that stops the Steam Deck's screen dimming and the Deck going to sleep while your chosen apps are running.

This is useful for games like the Jackbox Party Packs, where everyone plays on their phones and nobody touches the Deck for twenty minutes at a time. It is equally useful for YouTube, Netflix, Plex, or anything else you watch rather than play.

Pick the apps you care about and the plugin handles the rest. Everything else keeps Steam's normal timers, so your battery life is untouched the rest of the time.

## Installing

The plugin is not in the Decky store yet. Grab the zip from the [latest release](https://github.com/JaxonWright/decky-dont-dimmadeck/releases) — these are pre-releases, so tick **Include pre-releases** if you are browsing the releases page.

On the Deck itself:

1. Download `dont-dimmadeck-vX.Y.Z.zip`, onto the Deck or onto a USB stick.
2. In game mode, open the Decky menu (the plug icon), then the gear icon, then **Developer mode**.
3. Turn **Developer mode** on. A **Developer** tab appears in the same settings page.
4. Under **Install Plugin from Zip**, pick the file.

Or over SSH from another machine, with [SSH enabled on the Deck](https://wiki.deckbrew.xyz/en/user-guide/ssh-setup):

```bash
scp dont-dimmadeck-v1.0.0.zip deck@steamdeck.local:/tmp/
ssh deck@steamdeck.local 'unzip -o /tmp/dont-dimmadeck-v1.0.0.zip -d ~/homebrew/plugins/'
```

Then reload Decky (Decky menu → gear → **Reload**) or reboot.

To uninstall, use the bin icon next to the plugin in the Decky menu.

## Using it

Open the Decky menu and pick **Don't Dimmadeck**.

- **Keep awake now** — an immediate override, handy for a long download or an app you have not added yet. It applies your defaults straight away and ignores the power conditions.
- **Current game** — toggle this on to keep the screen awake every time this app runs.
- **Per-app settings** — pick any app you have added and give it its own settings, or leave it following the defaults. This is also where you remove an app.
- **Defaults** — what every app uses unless it overrides them.

Each set of settings has three parts:

| Setting | What it does |
| --- | --- |
| **Prevent dimming** | Stops the backlight dimming. |
| **Prevent sleep** | Stops the Deck suspending. |
| **Only apply when** | Always, only when plugged in, only with an external display, or only both. |

The two can be used separately: prevent sleep during a long download but let the screen dim, or keep the screen lit for a recipe while still letting the Deck sleep eventually.

Steam's timers go back to your own settings as soon as the app exits, and only the halves the plugin actually changed are ever written. If you change those settings in Steam while nothing is being kept awake, the plugin notices and restores to the new values next time.

## How it works

SteamOS drives dimming and auto-sleep from Steam client settings, not from a logind idle inhibitor — `systemd-inhibit` has no effect on them. The two timers live in different protobuf messages, written through different setters, and `0` means "never":

| Setting | Message | Field | Written via |
| --- | --- | --- | --- |
| `idle_backlight_dim_battery_seconds` | `CMsgSystemManagerSettings` | 1 (float) | `SteamClient.System.UpdateSettings` |
| `idle_backlight_dim_ac_seconds` | `CMsgSystemManagerSettings` | 2 (float) | `SteamClient.System.UpdateSettings` |
| `system_idle_suspend_battery_sec` | `CMsgClientSettings` | 24003 (int32) | `SteamClient.Settings.SetSetting` |
| `system_idle_suspend_ac_sec` | `CMsgClientSettings` | 24004 (int32) | `SteamClient.Settings.SetSetting` |

Field numbers come from [SteamDatabase/Protobufs](https://github.com/SteamDatabase/Protobufs). The plugin watches `RegisterForAppLifetimeNotifications` for app starts and stops, zeroes the relevant timers while an enabled app is running, and puts your values back afterwards. Dimming and sleep are tracked independently, so turning one off never rewrites the other.

The **only apply when** conditions come from two more sources:

- *Plugged in* uses `RegisterForBatteryStateChanges` and its `eACState`. Reliable.
- *External display* reads `CMsgSystemDisplayManagerState` for an enabled, non-internal display. Steam has no true dock-state API — `SteamClient.System.Dock` only reports dock firmware updates — so this is the closest available signal. It has the advantage of covering third-party hubs, not just the official dock. If the display state cannot be read, the condition simply never fires rather than firing at the wrong moment.

Because Steam persists these settings, the plugin also records what it is holding. If the Deck loses power mid-override, your timers are restored the next time the plugin loads instead of being left off forever.

If you would rather this happened automatically for apps that ask the system not to sleep — VLC, Chrome and mpv do — [DeckyInhibitScreenSaver](https://github.com/xfangfang/DeckyInhibitScreenSaver) takes that approach instead.

## Development

### Prerequisites

- Node.js 18+ and `pnpm` 9 (`sudo npm i -g pnpm@9`) — Decky's submission CI uses pnpm 9, so match it to keep the lockfile readable there.
- `zip`, for `pnpm package`.

The [Decky CLI](https://github.com/SteamDeckHomebrew/cli) and Docker are *not* needed. They exist to compile plugin backends, and this plugin has none — `main.py` is plain Python that decky-loader runs itself.

### Building

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # codec, display parsing, conditions, config migration
pnpm build       # -> dist/index.js
pnpm package     # build, then -> out/dont-dimmadeck-v<version>.zip
pnpm watch       # rebuild on change
```

`pnpm package` produces exactly what the release workflow attaches: a zip holding one `dont-dimmadeck/` folder with `dist/`, `main.py`, `package.json`, `plugin.json`, `README.md` and `LICENSE`. decky-loader needs `plugin.json` exactly one level deep and finds the plugin by the `name` inside it, so the folder name is a slug rather than the display name.

### Deploying to a Deck

Fastest loop while developing:

```bash
pnpm package
scp out/dont-dimmadeck-v*.zip deck@steamdeck.local:/tmp/
ssh deck@steamdeck.local 'unzip -o /tmp/dont-dimmadeck-v*.zip -d ~/homebrew/plugins/ && sudo systemctl restart plugin_loader'
```

The VS Code tasks in `.vscode/tasks.json` do the same thing through the Decky CLI, if you prefer them. Copy `.vscode/defsettings.json` to `.vscode/settings.json` and fill in your Deck's IP, user and SSH details first.

### Cutting a release

`.github/workflows/release.yml` builds the zip and publishes it as a GitHub **pre-release**.

```bash
# 1. Bump the version. decky-loader reads it from package.json, and the
#    workflow fails the build if the tag and package.json disagree.
npm version 1.0.1 --no-git-tag-version
git commit -am "chore: 1.0.1"

# 2. Tag and push. The tag is what triggers the release.
git tag v1.0.1
git push && git push --tags
```

The workflow typechecks, tests, builds the zip, attaches it to the release with its sha256, and writes install instructions into the release notes.

Running the workflow manually from the Actions tab (**Run workflow**) builds the same zip and uploads it as a workflow artifact without creating a release — useful for trying a change on a Deck before committing to a version.

### Testing

`pnpm test` covers the parts that can be checked away from the hardware: the protobuf codec against known-good bytes, the display-state parsing across every shape `GetState` has been seen to return, the power conditions, and config parsing including the v1 → v2 migration.

Everything else — whether Steam accepts the messages, whether the timers actually stop — can only be confirmed on a Deck in game mode. Worth checking by hand after a change:

1. Launch an enabled app, then look at Settings → Display and Settings → Power. Both timers should read as off.
2. Exit it. They should return to whatever they were before.
3. Turn off **Prevent sleep** but leave **Prevent dimming** on, and confirm only the dim timer changes.
4. Set a profile to *only when plugged in*, then unplug. The timers should return to normal.
5. Restart decky-loader while an app is being kept awake. The timers should be restored on load, not left off.

## License

This project is licensed with the [BSD 3-Clause](https://choosealicense.com/licenses/bsd-3-clause/) open-source license.

This allows for the free use, modification, and distribution of software. It requires that any redistributions of the software must include a copy of the license, a disclaimer of liability, and the copyright notice. This license permits commercial use without the obligation to release the source code of derivative works, making it more permissive than copyleft licenses like the GPL.
