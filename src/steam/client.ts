/**
 * Typed view of the parts of Steam's client API this plugin uses.
 *
 * @decky/ui declares the SteamClient global but types System, Settings and
 * GameSessions as `any`, so the shapes we depend on are written down here and
 * applied by casting rather than by redeclaring the global.
 *
 * Every member is optional: Steam moves these between client builds, and a
 * missing method should degrade to a logged warning, not a crash.
 */

export interface Unregisterable {
  unregister(): void;
}

export interface AppLifetimeNotification {
  unAppID: number;
  nInstanceID: number;
  bRunning: boolean;
}

interface SystemApi {
  /**
   * Applies a base64-encoded, partially populated CMsgSystemManagerSettings.
   * Only the fields present in the message are changed.
   */
  UpdateSettings?(base64: string): Promise<unknown>;
  /** Emits a serialised CMsgSystemManagerSettings whenever it changes. */
  RegisterForSettingsChanges?(cb: (data: ArrayBuffer) => void): Unregisterable;
}

interface SettingsApi {
  /** Applies a base64-encoded, partially populated CMsgClientSettings. */
  SetSetting?(base64: string): Promise<unknown>;
  /** Emits a serialised CMsgClientSettings whenever it changes. */
  RegisterForSettingsArrayChanges?(cb: (data: ArrayBuffer) => void): Unregisterable;
}

interface GameSessionsApi {
  RegisterForAppLifetimeNotifications?(
    cb: (notification: AppLifetimeNotification) => void,
  ): Unregisterable;
}

export interface SteamClientApi {
  System?: SystemApi;
  Settings?: SettingsApi;
  GameSessions?: GameSessionsApi;
}

/** Resolved lazily so a missing global never breaks module evaluation. */
export function steam(): SteamClientApi {
  return (typeof SteamClient === "undefined" ? {} : SteamClient) as SteamClientApi;
}

/** Steam's display name for an app, or a readable placeholder. */
export function appName(appId: number): string {
  try {
    const name = window.appStore?.GetAppOverviewByAppID(appId)?.display_name;
    if (name) return name;
  } catch (error) {
    console.error("[Don't Dimmadeck] failed to look up app name", error);
  }
  return `App ${appId}`;
}
