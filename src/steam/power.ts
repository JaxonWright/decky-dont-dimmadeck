import { steam } from "./client";
import { decodeRepeatedBytes, decodeScalarFields } from "./protobuf";

import type { PowerState } from "../profile";
import type { Unregisterable } from "./client";

/** EACState from Steam: 0 unknown, 1 disconnected, 2 connected, 3 connected slow. */
const AC_CONNECTED = 2;
const AC_CONNECTED_SLOW = 3;

/** CMsgSystemDisplayManagerState.displays */
const FIELD_DISPLAYS = 1;
/** CMsgSystemDisplay.is_enabled / .is_internal */
const FIELD_IS_ENABLED = 5;
const FIELD_IS_INTERNAL = 6;

function bytesFromBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * True when an enabled, non-internal display is attached.
 *
 * DisplayManager.GetState is undocumented and has been seen returning a
 * protobuf buffer, a base64 string of one, and an already-deserialised object,
 * so all three are handled. Returns null when the shape is not recognised, so
 * callers can tell "no external display" apart from "could not tell".
 */
export function externalDisplayFromState(state: unknown): boolean | null {
  if (state === null || state === undefined) return null;

  // Already-deserialised: either a plain object or a JsPb message with getters.
  if (typeof state === "object" && !(state instanceof ArrayBuffer) && !ArrayBuffer.isView(state)) {
    const raw = state as { displays?: unknown };
    const displays = typeof raw.displays === "function" ? raw.displays() : raw.displays;
    if (Array.isArray(displays)) {
      return displays.some((display) => {
        const entry = display as Record<string, unknown>;
        const internal = entry.is_internal ?? entry.bIsInternal;
        const enabled = entry.is_enabled ?? entry.bIsEnabled;
        return internal === false && enabled !== false;
      });
    }
    return null;
  }

  let bytes: Uint8Array;
  if (typeof state === "string") {
    try {
      bytes = bytesFromBase64(state);
    } catch {
      return null;
    }
  } else if (state instanceof ArrayBuffer) {
    bytes = new Uint8Array(state);
  } else if (ArrayBuffer.isView(state)) {
    const view = state as ArrayBufferView;
    bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  } else {
    return null;
  }

  const displays = decodeRepeatedBytes(bytes, FIELD_DISPLAYS);
  if (displays.length === 0) return null;

  return displays.some((display) => {
    const fields = decodeScalarFields(display);
    // Both default to false when absent, which is what proto3 scalars do too.
    const isInternal = fields.get(FIELD_IS_INTERNAL)?.varint === 1;
    const isEnabled = fields.get(FIELD_IS_ENABLED)?.varint === 1;
    return !isInternal && isEnabled;
  });
}

/**
 * Reports AC and external-display state, for profiles that should only apply
 * under one of them. Both default to false, so a condition the plugin cannot
 * evaluate simply never fires rather than firing at the wrong time.
 *
 * Returns an unsubscribe function.
 */
export function watchPowerState(onChange: (state: PowerState) => void): () => void {
  const client = steam();
  const subscriptions: Unregisterable[] = [];
  const current: PowerState = { onAc: false, externalDisplay: false };

  const publish = (next: Partial<PowerState>) => {
    let changed = false;
    for (const key of ["onAc", "externalDisplay"] as const) {
      const value = next[key];
      if (value !== undefined && current[key] !== value) {
        current[key] = value;
        changed = true;
      }
    }
    if (changed) onChange({ ...current });
  };

  const battery = client.System?.RegisterForBatteryStateChanges?.((state) => {
    // A Deck with no battery is on mains by definition.
    const onAc =
      state.bHasBattery === false ||
      state.eACState === AC_CONNECTED ||
      state.eACState === AC_CONNECTED_SLOW;
    publish({ onAc });
  });
  if (battery) {
    subscriptions.push(battery);
  } else {
    console.warn("[Don't Dimmadeck] battery state is unavailable; 'plugged in' conditions cannot fire");
  }

  const displayManager = client.System?.DisplayManager;
  const refreshDisplays = async () => {
    if (!displayManager?.GetState) return;
    try {
      const external = externalDisplayFromState(await displayManager.GetState());
      if (external === null) {
        console.warn("[Don't Dimmadeck] could not read display state in a recognised shape");
        return;
      }
      publish({ externalDisplay: external });
    } catch (error) {
      console.error("[Don't Dimmadeck] failed to read display state", error);
    }
  };

  if (displayManager?.RegisterForStateChanges) {
    const displays = displayManager.RegisterForStateChanges(() => void refreshDisplays());
    if (displays) subscriptions.push(displays);
    void refreshDisplays();
  } else {
    console.warn(
      "[Don't Dimmadeck] display state is unavailable; 'external display' conditions cannot fire",
    );
  }

  return () => {
    for (const subscription of subscriptions) {
      try {
        subscription.unregister();
      } catch (error) {
        console.error("[Don't Dimmadeck] failed to unregister power watcher", error);
      }
    }
  };
}
