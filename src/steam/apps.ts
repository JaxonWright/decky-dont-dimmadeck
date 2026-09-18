import { Router } from "@decky/ui";

import { appName, steam } from "./client";

export interface RunningApp {
  appId: number;
  name: string;
}

/**
 * Reports which app is in the foreground, or null when the user is back on the
 * library. Steam can have several apps alive at once, so the most recently
 * started one wins; when it exits we fall back to whatever is still running.
 *
 * Returns an unsubscribe function. The callback fires only on change.
 */
export function watchRunningApp(onChange: (app: RunningApp | null) => void): () => void {
  // Insertion-ordered, so the last entry is the most recently started app.
  const running = new Set<number>();
  let current: number | null = null;

  // RegisterForAppLifetimeNotifications only reports transitions, so an app
  // already running when the plugin loads would otherwise go unnoticed until
  // it exits - which is exactly the case after decky restarts mid-game.
  try {
    const startup = Router.MainRunningApp;
    if (startup?.appid !== undefined) running.add(Number(startup.appid));
  } catch (error) {
    console.error("[Don't Dimmadeck] failed to read the running app at startup", error);
  }

  const publish = () => {
    let latest: number | null = null;
    for (const appId of running) latest = appId;
    if (latest === current) return;
    current = latest;
    onChange(latest === null ? null : { appId: latest, name: appName(latest) });
  };

  const subscription = steam().GameSessions?.RegisterForAppLifetimeNotifications?.(
    (notification) => {
      if (notification.bRunning) {
        // Re-insert so a relaunch moves the app back to the end of the set.
        running.delete(notification.unAppID);
        running.add(notification.unAppID);
      } else {
        running.delete(notification.unAppID);
      }
      publish();
    },
  );

  // Report the seeded app before returning, so callers see it immediately.
  publish();

  if (!subscription) {
    console.warn(
      "[Don't Dimmadeck] SteamClient.GameSessions.RegisterForAppLifetimeNotifications is " +
        "unavailable; per-app keep-awake will not trigger",
    );
    return () => {};
  }

  return () => {
    try {
      subscription.unregister();
    } catch (error) {
      console.error("[Don't Dimmadeck] failed to unregister app lifetime watcher", error);
    }
  };
}
