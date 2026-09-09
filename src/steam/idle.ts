import { steam, Unregisterable } from "./client";
import { decodeScalarFields, encodeFloatField, encodeVarintField, toBase64 } from "./protobuf";

/**
 * SteamOS drives screen dimming and auto-sleep from Steam client settings, not
 * from a logind idle inhibitor - taking a systemd-inhibit lock does nothing.
 * The two timers live in two different protobuf messages, written through two
 * different setters. Zero means "never".
 *
 * CMsgSystemManagerSettings, via SteamClient.System.UpdateSettings:
 *   1  float  idle_backlight_dim_battery_seconds
 *   2  float  idle_backlight_dim_ac_seconds
 *
 * CMsgClientSettings, via SteamClient.Settings.SetSetting:
 *   24003  int32  system_idle_suspend_battery_sec
 *   24004  int32  system_idle_suspend_ac_sec
 */
const FIELD_DIM_BATTERY = 1;
const FIELD_DIM_AC = 2;
const FIELD_SUSPEND_BATTERY = 24003;
const FIELD_SUSPEND_AC = 24004;

export interface IdleTimeouts {
  /** Seconds before the backlight dims on battery. */
  dimBattery: number;
  /** Seconds before the backlight dims on AC power. */
  dimAc: number;
  /** Seconds before the Deck suspends on battery. */
  suspendBattery: number;
  /** Seconds before the Deck suspends on AC power. */
  suspendAc: number;
}

/**
 * Used only when Steam never tells us the real values. The suspend figures are
 * the defaults declared in CMsgClientSettings; the dim figures have no declared
 * default, so these are SteamOS's shipped five minutes.
 */
export const STEAM_DEFAULTS: IdleTimeouts = {
  dimBattery: 300,
  dimAc: 300,
  suspendBattery: 900,
  suspendAc: 3600,
};

/** All timers off. */
export const NEVER: IdleTimeouts = {
  dimBattery: 0,
  dimAc: 0,
  suspendBattery: 0,
  suspendAc: 0,
};

export function timeoutsEqual(a: IdleTimeouts, b: IdleTimeouts): boolean {
  return (
    a.dimBattery === b.dimBattery &&
    a.dimAc === b.dimAc &&
    a.suspendBattery === b.suspendBattery &&
    a.suspendAc === b.suspendAc
  );
}

/** Coerces an untrusted value (config file, Steam) into a sane timeout. */
export function sanitizeTimeouts(value: unknown): IdleTimeouts | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const result = {} as IdleTimeouts;
  for (const key of ["dimBattery", "dimAc", "suspendBattery", "suspendAc"] as const) {
    const seconds = candidate[key];
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
    if (suspendBattery !== undefined) partial.suspendBattery = suspendBattery;
    if (suspendAc !== undefined) partial.suspendAc = suspendAc;
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

/**
 * Pushes all four timers to Steam. The two halves are independent: if one
 * setter is missing from this Steam build the other still applies, which is
 * better than doing nothing at all.
 */
export async function applyIdleTimeouts(timeouts: IdleTimeouts): Promise<void> {
  const client = steam();

  const system = client.System;
  if (system?.UpdateSettings) {
    try {
      await system.UpdateSettings(encodeDimSettings(timeouts));
    } catch (error) {
      console.error("[Don't Dimmadeck] failed to set dim timeouts", error);
    }
  } else {
    console.warn("[Don't Dimmadeck] SteamClient.System.UpdateSettings is unavailable");
  }

  const settings = client.Settings;
  if (settings?.SetSetting) {
    try {
      await settings.SetSetting(encodeSuspendSettings(timeouts));
    } catch (error) {
      console.error("[Don't Dimmadeck] failed to set suspend timeouts", error);
    }
  } else {
    console.warn("[Don't Dimmadeck] SteamClient.Settings.SetSetting is unavailable");
  }
}
