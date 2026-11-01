/**
 * The stored config's shape, and the parsing that turns whatever is on disk
 * into something the plugin can trust.
 *
 * Kept apart from config.ts so it carries no @decky/api dependency: that
 * package resolves a virtual module supplied by the bundler, so anything
 * importing it can only run inside the Steam client.
 */
import { DEFAULT_PROFILE, sanitizeProfile } from "./profile";
import { IDLE_PARTS, NO_PARTS, sanitizeTimeouts } from "./steam/idle";

import type { Profile } from "./profile";
import type { IdleParts, IdleTimeouts } from "./steam/idle";

/**
 * v1: apps as `{ "<appid>": "<name>" }`, `inhibit_active` a bare boolean.
 * v2: per-app profiles, `inhibit_active` an object of halves, `baseline`.
 * v3: the screensaver half - `preventScreensaver` on profiles, `screensaver`
 *     in `inhibit_active`, `screensaverBattery`/`screensaverAc` in `baseline`.
 *     Every v2 field keeps its meaning; the new ones default when absent.
 */
export const CONFIG_VERSION = 3;

export interface ManagedApp {
  name: string;
  /** null means "follow the defaults". */
  profile: Profile | null;
}

/**
 * What the plugin remembers between sessions.
 *
 * `baseline` and `overridden` are not user settings: they exist so that a Deck
 * which loses power while an app is being kept awake can put Steam's timers
 * back on the next load. Steam persists those timers itself, so without this
 * the screen would simply never dim again.
 */
export interface Config {
  version: number;
  defaults: Profile;
  /** Keyed by app ID as a string. */
  apps: Record<string, ManagedApp>;
  globalOverride: boolean;
  /** The timeouts to restore once nothing needs keeping awake. */
  baseline: IdleTimeouts | null;
  /** Which halves were left overridden. */
  overridden: IdleParts;
}

export function defaultConfig(): Config {
  return {
    version: CONFIG_VERSION,
    defaults: { ...DEFAULT_PROFILE },
    apps: {},
    globalOverride: false,
    baseline: null,
    overridden: { ...NO_PARTS },
  };
}

/** The backend stores snake_case JSON; the frontend works in camelCase. */
export interface StoredConfig {
  version?: unknown;
  defaults?: unknown;
  apps?: unknown;
  global_override?: unknown;
  baseline?: unknown;
  /** v2+: an object of halves. v1: a bare boolean meaning "both". */
  inhibit_active?: unknown;
}

/**
 * v1 stored apps as `{ "<appid>": "<name>" }` with no per-app settings. Those
 * entries become apps that follow the defaults, which is what they effectively
 * were.
 */
export function parseApps(value: unknown): Record<string, ManagedApp> {
  if (typeof value !== "object" || value === null) return {};
  const apps: Record<string, ManagedApp> = {};

  for (const [appId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(appId)) continue;

    if (typeof entry === "string") {
      apps[appId] = { name: entry || `App ${appId}`, profile: null };
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;

    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" && record.name ? record.name : `App ${appId}`;
    // An absent profile means "follow the defaults"; a present one is validated.
    const profile =
      record.profile === null || record.profile === undefined
        ? null
        : sanitizeProfile(record.profile);
    apps[appId] = { name, profile };
  }

  return apps;
}

/**
 * A v1 `true` meant both of the halves that existed then. The screensaver half
 * did not, so a v1 or v2 session cannot have left it overridden, and it stays
 * false unless recorded.
 */
export function parseOverridden(value: unknown): IdleParts {
  if (value === true) return { dim: true, suspend: true, screensaver: false };
  const parts = { ...NO_PARTS };
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const part of IDLE_PARTS) parts[part] = record[part] === true;
  }
  return parts;
}

/** Turns whatever was stored into a valid config, defaulting anything broken. */
export function parseConfig(stored: StoredConfig): Config {
  return {
    version: CONFIG_VERSION,
    defaults: sanitizeProfile(stored.defaults) ?? { ...DEFAULT_PROFILE },
    apps: parseApps(stored.apps),
    globalOverride: stored.global_override === true,
    baseline: sanitizeTimeouts(stored.baseline),
    overridden: parseOverridden(stored.inhibit_active),
  };
}

/** The snake_case form written back to the backend. */
export function serializeConfig(config: Config): Record<string, unknown> {
  return {
    version: config.version,
    defaults: config.defaults,
    apps: config.apps,
    global_override: config.globalOverride,
    baseline: config.baseline,
    inhibit_active: config.overridden,
  };
}
