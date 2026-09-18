import { callable } from "@decky/api";

import { defaultConfig, parseConfig, serializeConfig } from "./config-schema";

import type { Config, StoredConfig } from "./config-schema";

export { CONFIG_VERSION, defaultConfig } from "./config-schema";
export type { Config, ManagedApp } from "./config-schema";

const getConfig = callable<[], StoredConfig>("get_config");
const setConfig = callable<[config: Record<string, unknown>], boolean>("set_config");

/** Reads the stored config, replacing anything malformed with its default. */
export async function loadConfig(): Promise<Config> {
  try {
    return parseConfig(await getConfig());
  } catch (error) {
    console.error("[Don't Dimmadeck] failed to load config", error);
    return defaultConfig();
  }
}

/**
 * Returns whether the write landed. Callers must check: this file records the
 * timeouts we owe the user, so overriding them after a failed write would
 * leave nothing to restore from.
 */
export async function saveConfig(config: Config): Promise<boolean> {
  try {
    const written = await setConfig(serializeConfig(config));
    if (written === false) {
      console.error("[Don't Dimmadeck] the backend rejected the config write");
      return false;
    }
    return true;
  } catch (error) {
    console.error("[Don't Dimmadeck] failed to save config", error);
    return false;
  }
}
