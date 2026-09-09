/**
 * The stored config's shape, and the parsing that turns whatever is on disk
 * into something the plugin can trust.
 *
 * Kept apart from config.ts so it carries no @decky/api dependency: that
 * package resolves a virtual module supplied by the bundler, so anything
 * importing it can only run inside the Steam client.
 */
import { DEFAULT_PROFILE, sanitizeProfile } from "./profile";
import { NO_PARTS, sanitizeTimeouts } from "./steam/idle";

import type { Profile } from "./profile";
import type { IdleParts, IdleTimeouts } from "./steam/idle";

export const CONFIG_VERSION = 2;

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
  /** v2: an object of halves. v1: a bare boolean meaning "both". */
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

export function parseOverridden(value: unknown): IdleParts {
  if (value === true) return { dim: true, suspend: true };
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return { dim: record.dim === true, suspend: record.suspend === true };
  }
  return { ...NO_PARTS };
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
