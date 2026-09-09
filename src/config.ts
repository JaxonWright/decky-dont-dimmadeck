import { callable } from "@decky/api";

import { IdleTimeouts, sanitizeTimeouts } from "./steam/idle";

/**
 * What the plugin remembers between sessions.
 *
 * `baseline` and `inhibitActive` are not user settings: they exist so that a
 * Deck which loses power while an app is being kept awake can put Steam's
 * timers back on the next load. Steam persists those timers itself, so without
 * this the screen would simply never dim again.
 */
export interface Config {
  version: number;
  /** App ID (as a string key) to the display name it had when it was added. */
  apps: Record<string, string>;
  globalOverride: boolean;
  /** The timeouts to restore once nothing needs keeping awake. */
  baseline: IdleTimeouts | null;
  /** Whether the timers were left overridden. */
  inhibitActive: boolean;
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  apps: {},
  globalOverride: false,
  baseline: null,
  inhibitActive: false,
};

// The backend stores snake_case JSON; the frontend works in camelCase.
interface StoredConfig {
  version?: unknown;
  apps?: unknown;
  global_override?: unknown;
  baseline?: unknown;
  inhibit_active?: unknown;
}

const getConfig = callable<[], StoredConfig>("get_config");
const setConfig = callable<[config: Record<string, unknown>], boolean>("set_config");

function parseApps(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const apps: Record<string, string> = {};
  for (const [appId, name] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(appId)) continue;
    apps[appId] = typeof name === "string" && name ? name : `App ${appId}`;
  }
  return apps;
}

/** Reads the stored config, replacing anything malformed with its default. */
export async function loadConfig(): Promise<Config> {
  let stored: StoredConfig;
  try {
    stored = await getConfig();
  } catch (error) {
    console.error("[Don't Dimmadeck] failed to load config", error);
    return { ...DEFAULT_CONFIG };
  }

  return {
    version: typeof stored.version === "number" ? stored.version : DEFAULT_CONFIG.version,
    apps: parseApps(stored.apps),
    globalOverride: stored.global_override === true,
    baseline: sanitizeTimeouts(stored.baseline),
    inhibitActive: stored.inhibit_active === true,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  try {
    await setConfig({
      version: config.version,
      apps: config.apps,
      global_override: config.globalOverride,
      baseline: config.baseline,
      inhibit_active: config.inhibitActive,
    });
  } catch (error) {
    console.error("[Don't Dimmadeck] failed to save config", error);
  }
}
