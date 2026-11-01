import { steam } from "./client";
import type { Unregisterable } from "./client";
import { decodeScalarFields, encodeFloatField, encodeVarintField, toBase64 } from "./protobuf";

/**
 * SteamOS drives screen dimming, the screensaver and auto-sleep from Steam
 * client settings, not from a logind idle inhibitor - taking a systemd-inhibit
 * lock does nothing. The three timers live in two different protobuf messages,
 * written through two different setters. Zero means "never".
 *
 * CMsgSystemManagerSettings, via SteamClient.System.UpdateSettings:
 *   1  float  idle_backlight_dim_battery_seconds
 *   2  float  idle_backlight_dim_ac_seconds
 *
 * CMsgClientSettings, via SteamClient.Settings.SetSetting:
 *   24003  int32  system_idle_suspend_battery_sec      (default 900)
 *   24004  int32  system_idle_suspend_ac_sec           (default 3600)
 *   24008  int32  system_idle_screensaver_battery_sec  (default 0)
 *   24009  int32  system_idle_screensaver_ac_sec       (default 300)
 *
 * Field numbers, types and defaults come from SteamDatabase/Protobufs:
 * steam/steammessages_client_objects.proto (CMsgSystemManagerSettings) and
 * steam/steammessages_clientsettings.proto (CMsgClientSettings), as of commit
 * 89b77382edac5f747bfc196c2edf8996a7fe92bc (2026-10-17).
 */
const FIELD_DIM_BATTERY = 1;
const FIELD_DIM_AC = 2;
const FIELD_SUSPEND_BATTERY = 24003;
const FIELD_SUSPEND_AC = 24004;
const FIELD_SCREENSAVER_BATTERY = 24008;
const FIELD_SCREENSAVER_AC = 24009;

export interface IdleTimeouts {
  /** Seconds before the backlight dims on battery. */
  dimBattery: number;
  /** Seconds before the backlight dims on AC power. */
  dimAc: number;
  /** Seconds before the Deck suspends on battery. */
  suspendBattery: number;
  /** Seconds before the Deck suspends on AC power. */
  suspendAc: number;
  /** Seconds before the screensaver starts on battery. */
  screensaverBattery: number;
  /** Seconds before the screensaver starts on AC power. */
  screensaverAc: number;
}

export type TimeoutKey = keyof IdleTimeouts;

/**
 * Used only when Steam never tells us the real values. The suspend and
 * screensaver figures are the defaults declared in CMsgClientSettings; the dim
 * figures have no declared default, so these are SteamOS's shipped five
 * minutes. The screensaver is off by default on battery.
 */
export const STEAM_DEFAULTS: IdleTimeouts = {
  dimBattery: 300,
  dimAc: 300,
  suspendBattery: 900,
  suspendAc: 3600,
  screensaverBattery: 0,
  screensaverAc: 300,
};

/** All timers off. */
export const NEVER: IdleTimeouts = {
  dimBattery: 0,
  dimAc: 0,
  suspendBattery: 0,
  suspendAc: 0,
  screensaverBattery: 0,
  screensaverAc: 0,
};

/** The independently tracked timers. "Half" predates the third one. */
export type IdlePart = "dim" | "suspend" | "screensaver";

export const IDLE_PARTS: readonly IdlePart[] = ["dim", "suspend", "screensaver"];

/** The timeout fields that belong to each half. */
export const PART_KEYS: Record<IdlePart, readonly TimeoutKey[]> = {
  dim: ["dimBattery", "dimAc"],
  suspend: ["suspendBattery", "suspendAc"],
  screensaver: ["screensaverBattery", "screensaverAc"],
};

const TIMEOUT_KEYS: readonly TimeoutKey[] = IDLE_PARTS.flatMap((part) => PART_KEYS[part]);

/**
 * Keys a stored baseline may omit. v2 configs predate the screensaver half, so
 * a baseline written by one carries only the dim and suspend values. The
 * missing ones take Steam's defaults, which is what a never-overridden
 * screensaver half would be put back to anyway.
 */
const OPTIONAL_KEYS: ReadonlySet<TimeoutKey> = new Set(PART_KEYS.screensaver);

export function timeoutsEqual(a: IdleTimeouts, b: IdleTimeouts): boolean {
  return TIMEOUT_KEYS.every((key) => a[key] === b[key]);
}

/** Coerces an untrusted value (config file, Steam) into a sane timeout. */
export function sanitizeTimeouts(value: unknown): IdleTimeouts | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const result = {} as IdleTimeouts;
  for (const key of TIMEOUT_KEYS) {
    const seconds = candidate[key];
    if (seconds === undefined && OPTIONAL_KEYS.has(key)) {
      result[key] = STEAM_DEFAULTS[key];
      continue;
    }
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
    result[key] = Math.round(seconds);
  }
  return result;
}

/**
 * Subscribes to both settings messages, reporting whichever timeouts each
 * update carries. Steam sends partial messages, so callers must merge rather
 * than replace. Returns an unsubscribe function.
 */
export function watchIdleTimeouts(onChange: (partial: Partial<IdleTimeouts>) => void): () => void {
  const client = steam();
  const subscriptions: Unregisterable[] = [];

  const system = client.System?.RegisterForSettingsChanges?.((data) => {
    const fields = decodeScalarFields(data);
    const partial: Partial<IdleTimeouts> = {};
    const dimBattery = fields.get(FIELD_DIM_BATTERY)?.float;
    const dimAc = fields.get(FIELD_DIM_AC)?.float;
    if (dimBattery !== undefined) partial.dimBattery = Math.round(dimBattery);
    if (dimAc !== undefined) partial.dimAc = Math.round(dimAc);
    if (Object.keys(partial).length > 0) onChange(partial);
  });
  if (system) subscriptions.push(system);

  const settings = client.Settings?.RegisterForSettingsArrayChanges?.((data) => {
    const fields = decodeScalarFields(data);
    const partial: Partial<IdleTimeouts> = {};
    const suspendBattery = fields.get(FIELD_SUSPEND_BATTERY)?.varint;
    const suspendAc = fields.get(FIELD_SUSPEND_AC)?.varint;
    const screensaverBattery = fields.get(FIELD_SCREENSAVER_BATTERY)?.varint;
    const screensaverAc = fields.get(FIELD_SCREENSAVER_AC)?.varint;
    if (suspendBattery !== undefined) partial.suspendBattery = suspendBattery;
    if (suspendAc !== undefined) partial.suspendAc = suspendAc;
    if (screensaverBattery !== undefined) partial.screensaverBattery = screensaverBattery;
    if (screensaverAc !== undefined) partial.screensaverAc = screensaverAc;
    if (Object.keys(partial).length > 0) onChange(partial);
  });
  if (settings) subscriptions.push(settings);

  return () => {
    for (const subscription of subscriptions) {
      try {
        subscription.unregister();
      } catch (error) {
        console.error("[Don't Dimmadeck] failed to unregister settings watcher", error);
      }
    }
  };
}

/** Encodes the dim half of a CMsgSystemManagerSettings message. */
export function encodeDimSettings(timeouts: IdleTimeouts): string {
  return toBase64([
    ...encodeFloatField(FIELD_DIM_BATTERY, timeouts.dimBattery),
    ...encodeFloatField(FIELD_DIM_AC, timeouts.dimAc),
  ]);
}

/** Encodes the suspend half of a CMsgClientSettings message. */
export function encodeSuspendSettings(timeouts: IdleTimeouts): string {
  return toBase64([
    ...encodeVarintField(FIELD_SUSPEND_BATTERY, timeouts.suspendBattery),
    ...encodeVarintField(FIELD_SUSPEND_AC, timeouts.suspendAc),
  ]);
}

/** Encodes the screensaver half of a CMsgClientSettings message. */
export function encodeScreensaverSettings(timeouts: IdleTimeouts): string {
  return toBase64([
    ...encodeVarintField(FIELD_SCREENSAVER_BATTERY, timeouts.screensaverBattery),
    ...encodeVarintField(FIELD_SCREENSAVER_AC, timeouts.screensaverAc),
  ]);
}

/** Which halves of the settings to write. */
export type IdleParts = Record<IdlePart, boolean>;

export const ALL_PARTS: IdleParts = { dim: true, suspend: true, screensaver: true };
export const NO_PARTS: IdleParts = { dim: false, suspend: false, screensaver: false };

export function partsEqual(a: IdleParts, b: IdleParts): boolean {
  return IDLE_PARTS.every((part) => a[part] === b[part]);
}

export function anyPart(parts: IdleParts): boolean {
  return IDLE_PARTS.some((part) => parts[part]);
}

/** Which halves a partial settings update carries values for. */
export function partsIn(partial: Partial<IdleTimeouts>): IdleParts {
  const parts = { ...NO_PARTS };
  for (const part of IDLE_PARTS) {
    parts[part] = PART_KEYS[part].some((key) => partial[key] !== undefined);
  }
  return parts;
}

/**
 * Pushes timers to Steam, writing only the requested halves.
 *
 * Writing only what changed matters: a user who wants sleep prevented but
 * dimming left alone must not have their dim setting rewritten underneath
 * them. The halves are also independent for failure - if one setter is
 * missing from this Steam build the others still apply. Suspend and
 * screensaver share a setter but still go as separate messages, so a failure
 * in one leaves the other's record accurate.
 *
 * Returns which halves actually landed. Callers must not record a half as
 * restored, or as overridden, unless it is reported here: a setter that threw
 * leaves Steam holding the old value, and losing track of that is what strands
 * the timers at zero with nothing to recover from.
 */
export async function applyIdleTimeouts(
  timeouts: IdleTimeouts,
  parts: IdleParts = ALL_PARTS,
): Promise<IdleParts> {
  const client = steam();
  const applied: IdleParts = { ...NO_PARTS };

  const system = client.System;
  if (!parts.dim) {
    // Nothing to do for this half.
  } else if (system?.UpdateSettings) {
    try {
      await system.UpdateSettings(encodeDimSettings(timeouts));
      applied.dim = true;
    } catch (error) {
      console.error("[Don't Dimmadeck] failed to set dim timeouts", error);
    }
  } else {
    console.warn("[Don't Dimmadeck] SteamClient.System.UpdateSettings is unavailable");
  }

  const settings = client.Settings;
  const clientSettingsHalves: Array<[IdlePart, (timeouts: IdleTimeouts) => string]> = [
    ["suspend", encodeSuspendSettings],
    ["screensaver", encodeScreensaverSettings],
  ];
  for (const [part, encode] of clientSettingsHalves) {
    if (!parts[part]) {
      // Nothing to do for this half.
    } else if (settings?.SetSetting) {
      try {
        await settings.SetSetting(encode(timeouts));
        applied[part] = true;
      } catch (error) {
        console.error(`[Don't Dimmadeck] failed to set ${part} timeouts`, error);
      }
    } else {
      console.warn("[Don't Dimmadeck] SteamClient.Settings.SetSetting is unavailable");
    }
  }

  return applied;
}
