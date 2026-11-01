/**
 * What the plugin overrides, and under what conditions.
 *
 * There is one set of defaults, and any app may override it. An app whose
 * profile is null simply follows the defaults.
 */

/** When a profile is allowed to take effect. */
export type PowerCondition = "always" | "plugged-in" | "external-display" | "plugged-in-and-display";

export const POWER_CONDITIONS: PowerCondition[] = [
  "always",
  "plugged-in",
  "external-display",
  "plugged-in-and-display",
];

export const POWER_CONDITION_LABELS: Record<PowerCondition, string> = {
  always: "Always",
  "plugged-in": "Only when plugged in",
  "external-display": "Only with an external display",
  "plugged-in-and-display": "Only when plugged in with a display",
};

export interface Profile {
  /** Stop the backlight dimming. */
  preventDimming: boolean;
  /** Stop the Deck suspending. */
  preventSleep: boolean;
  /** Stop the screensaver starting. */
  preventScreensaver: boolean;
  condition: PowerCondition;
}

export const DEFAULT_PROFILE: Profile = {
  preventDimming: true,
  preventSleep: true,
  preventScreensaver: true,
  condition: "always",
};

export interface PowerState {
  /** Running on external power. */
  onAc: boolean;
  /**
   * An enabled, non-internal display is attached. Steam has no true dock-state
   * API, so this is the closest available signal - and it is arguably the more
   * useful one, since it also covers third-party hubs.
   */
  externalDisplay: boolean;
}

/** Whether a profile's condition is met by the current power state. */
export function conditionMet(condition: PowerCondition, power: PowerState): boolean {
  switch (condition) {
    case "plugged-in":
      return power.onAc;
    case "external-display":
      return power.externalDisplay;
    case "plugged-in-and-display":
      return power.onAc && power.externalDisplay;
    case "always":
    default:
      return true;
  }
}

/** True when a profile would not actually change anything. */
export function profileIsNoop(profile: Profile): boolean {
  return !profile.preventDimming && !profile.preventSleep && !profile.preventScreensaver;
}

function isPowerCondition(value: unknown): value is PowerCondition {
  return typeof value === "string" && (POWER_CONDITIONS as string[]).includes(value);
}

/**
 * Coerces an untrusted value from the config file into a profile.
 *
 * A missing toggle reads as on. That is also the v2 migration: profiles
 * written before the screensaver half existed gain it switched on, matching
 * the other two, since a screensaver starting mid-show defeats the point of
 * keeping the screen awake just as much as dimming does.
 */
export function sanitizeProfile(value: unknown): Profile | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  return {
    preventDimming: candidate.preventDimming !== false,
    preventSleep: candidate.preventSleep !== false,
    preventScreensaver: candidate.preventScreensaver !== false,
    condition: isPowerCondition(candidate.condition) ? candidate.condition : "always",
  };
}
