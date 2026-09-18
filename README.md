<img src="assets/logo.png" alt="" width="120" align="right">

# Don't Dimmadeck

A [Decky](https://github.com/SteamDeckHomebrew/decky-loader) plugin that stops the Steam Deck's screen dimming and the Deck going to sleep while your chosen apps are running.

Built for the Jackbox Party Packs, where everyone plays on their phones and nobody touches the Deck for twenty minutes at a time. Just as good for YouTube, Netflix, Plex, or anything else you watch rather than play.

Pick the apps you care about and the plugin handles the rest. Everything else keeps Steam's normal timers, so your battery life is untouched.

## Installing

The plugin is **not** currently in the official Decky Store. This README will be updated if it ever gets put in that.

### Via URL

The plugin is not in the Decky store, so Decky installs it straight from a URL:

1. In game mode, open the Decky menu (the plug icon), then the gear icon.
2. Turn on **Developer mode**. A **Developer** tab appears in the same settings page.
3. In that tab, enter (**Steam** + **X**) this into **Install Plugin from URL** and press install:

```
https://dontdimmadeck.jaxon.dev
```

The URL redirects to the newest release, so the same link works for updates.

### Via Downloaded ZIP

Download `dont-dimmadeck-vX.Y.Z.zip` from the [latest release](https://github.com/JaxonWright/decky-dont-dimmadeck/releases/latest) onto the Deck or a USB stick, then use **Install Plugin from Zip** in the same Developer tab.

### Via SSH

Or over SSH from another machine, with [SSH enabled on the Deck](https://wiki.deckbrew.xyz/en/user-guide/ssh-setup):

```bash
curl -LO https://dontdimmadeck.jaxon.dev
scp dont-dimmadeck.zip deck@steamdeck.local:/tmp/
ssh deck@steamdeck.local 'unzip -o /tmp/dont-dimmadeck.zip -d ~/homebrew/plugins/'
```

Then reload Decky (Decky menu → gear → **Reload**) or reboot.

## Uninstalling

To uninstall, use the bin icon next to the plugin in the Decky menu.

## Usage

Open the Decky menu and pick **Don't Dimmadeck**.

- **Keep awake now** overrides everything straight away. Handy for a long download, or an app you have not got round to adding. It uses your defaults and ignores the power conditions.
- **Current game** adds whatever is running right now, so it stays awake every time you launch it.
- **Per-app settings** gives one app its own settings instead of the defaults. Also where you remove an app.
- **Defaults** apply to every app that has no settings of its own.

Every set of settings has the same three parts:

| Setting | What it does |
| --- | --- |
| **Prevent dimming** | Stops the backlight dimming. |
| **Prevent sleep** | Stops the Deck suspending. |
| **Only apply when** | Always, only when plugged in, only with an external display, or only both. |

Dimming and sleep are independent. Stop the Deck sleeping through a long download but let the screen dim anyway, or keep the screen lit for a recipe and still let it drop off eventually.

Steam's timers go back to your own settings as soon as the app exits, and the plugin only ever writes the ones it changed. Change those settings in Steam while nothing is being kept awake and it notices, restoring the new values next time.

## Under The Hood

SteamOS drives dimming and auto-sleep from Steam client settings rather than from a logind idle inhibitor, so `systemd-inhibit` has no effect on them. The two timers live in different protobuf messages, written through different setters, and `0` means never.

| Setting | Message | Field | Written via |
| --- | --- | --- | --- |
| `idle_backlight_dim_battery_seconds` | `CMsgSystemManagerSettings` | 1 (float) | `SteamClient.System.UpdateSettings` |
| `idle_backlight_dim_ac_seconds` | `CMsgSystemManagerSettings` | 2 (float) | `SteamClient.System.UpdateSettings` |
| `system_idle_suspend_battery_sec` | `CMsgClientSettings` | 24003 (int32) | `SteamClient.Settings.SetSetting` |
| `system_idle_suspend_ac_sec` | `CMsgClientSettings` | 24004 (int32) | `SteamClient.Settings.SetSetting` |

Field numbers come from [SteamDatabase/Protobufs](https://github.com/SteamDatabase/Protobufs). The plugin watches `RegisterForAppLifetimeNotifications` for app starts and stops, zeroes the relevant timers while an enabled app is running, and puts your values back afterwards. Dimming and sleep are tracked separately all the way through, so turning one off never rewrites the other.

The **only apply when** conditions come from two more sources.

*Plugged in* reads `eACState` from `RegisterForBatteryStateChanges`. That one is reliable.

*External display* reads `CMsgSystemDisplayManagerState` looking for an enabled, non-internal display. Steam exposes no real dock state at all (`SteamClient.System.Dock` only reports dock firmware updates), so this is the closest signal going, and it has the happy side effect of covering third-party hubs rather than just the official dock. If the display state cannot be read, the condition never fires, which fails towards Steam's normal behaviour instead of pinning the screen on.

Steam persists these settings, so the plugin records whatever it is holding. Lose power mid-override and your timers come back the next time the plugin loads, rather than staying off forever.

Some apps ask the system not to sleep on their own, VLC and Chrome and mpv among them. If you would rather that happened automatically, [DeckyInhibitScreenSaver](https://github.com/xfangfang/DeckyInhibitScreenSaver) takes that approach instead.

## Development

### Prerequisites

- Node.js 18+ and `pnpm` 9 (`sudo npm i -g pnpm@9`). Match the major version. Decky's submission CI runs pnpm 9 and has to be able to read the lockfile.
- `zip`, for `pnpm package`.

The [Decky CLI](https://github.com/SteamDeckHomebrew/cli) and Docker are not needed. They exist to compile plugin backends, and this plugin has none. `main.py` is plain Python that decky-loader runs itself.

### Building

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # codec, display parsing, conditions, config migration
pnpm build       # -> dist/index.js
pnpm package     # build, then -> out/dont-dimmadeck-v<version>.zip
pnpm watch       # rebuild on change
```

`pnpm package` produces exactly what the release workflow attaches. The zip holds one `dont-dimmadeck/` folder containing `dist/`, `main.py`, `package.json`, `plugin.json`, `README.md` and `LICENSE`. decky-loader wants `plugin.json` exactly one level deep and finds the plugin by the `name` inside it, so the folder gets a slug rather than the display name.

### Deploying to a Deck

Fastest loop while developing:

```bash
# pnpm package prints the archive path, so deploy that exact file.
# out/ accumulates old versions, and a glob would upload all of them.
zip=$(pnpm --silent package | tail -1)
scp "$zip" deck@steamdeck.local:/tmp/
ssh deck@steamdeck.local "unzip -o /tmp/$(basename "$zip") -d ~/homebrew/plugins/ && sudo systemctl restart plugin_loader"
```

The VS Code tasks in `.vscode/tasks.json` do the same job through the Decky CLI if you prefer them. Copy `.vscode/defsettings.json` to `.vscode/settings.json` and fill in your Deck's IP, user and SSH details first.

### Cutting a release

`.github/workflows/release.yml` builds the zip and publishes it as a GitHub release. A tag whose commit has landed on master becomes a full release; a tag cut from a branch stays a pre-release, and its notes say so.

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

Running the workflow by hand from the Actions tab (**Run workflow**) builds the same zip and uploads it as a workflow artifact without creating a release. Useful for trying a change on a Deck before you commit to a version number.

### Testing

`pnpm test` covers what can be checked away from the hardware: the protobuf codec against known-good bytes, the display-state parsing across every shape `GetState` has been seen to return, the power conditions, and config parsing including the v1 to v2 migration.

Everything else needs a Deck in game mode. Whether Steam accepts the messages, whether the timers actually stop, none of that can be proven here. Worth running through by hand after a change:

1. Launch an enabled app, then look at Settings → Display and Settings → Power. Both timers should read as off.
2. Exit it. They should go back to whatever they were before.
3. Turn off **Prevent sleep** but leave **Prevent dimming** on, and confirm only the dim timer moves.
4. Set a profile to *only when plugged in*, then unplug. The timers should return to normal.
5. Restart decky-loader while an app is being kept awake. The timers should be restored on load, not left off.

## License

[BSD 3-Clause](https://choosealicense.com/licenses/bsd-3-clause/). Use it, change it, ship it; keep the copyright notice and the disclaimer with any redistribution.

`LICENSE` also carries the original decky-plugin-template copyright, which its terms require and the Decky store checks for.
