import assert from "node:assert/strict";
import test from "node:test";

import { conditionMet, sanitizeProfile } from "../src/profile.ts";
import { encodeBytesField, encodeVarintField } from "../src/steam/protobuf.ts";
import { externalDisplayFromState } from "../src/steam/power.ts";

// externalDisplayFromState reaches for window.atob on the base64 path.
globalThis.window = { atob: globalThis.atob, btoa: globalThis.btoa };

// CMsgSystemDisplay: is_enabled = 5, is_internal = 6. Wrapped in
// CMsgSystemDisplayManagerState.displays = 1.
const display = (enabled, internal) =>
  encodeBytesField(1, [...encodeVarintField(5, enabled ? 1 : 0), ...encodeVarintField(6, internal ? 1 : 0)]);

const stateBytes = (...displays) => Uint8Array.from(displays.flat());

test("detects an external display from a protobuf buffer", () => {
  const internalOnly = stateBytes(display(true, true));
  const withExternal = stateBytes(display(true, true), display(true, false));

  assert.equal(externalDisplayFromState(internalOnly), false);
  assert.equal(externalDisplayFromState(withExternal), true);
});

test("ignores a disabled external display", () => {
  const bytes = stateBytes(display(true, true), display(false, false));

  assert.equal(externalDisplayFromState(bytes), false);
});

test("accepts the buffer as an ArrayBuffer or a base64 string", () => {
  const bytes = stateBytes(display(true, true), display(true, false));
  const base64 = globalThis.btoa(String.fromCharCode(...bytes));

  assert.equal(externalDisplayFromState(bytes.buffer), true);
  assert.equal(externalDisplayFromState(base64), true);
});

test("accepts an already-deserialised object or JsPb message", () => {
  const displays = [
    { is_enabled: true, is_internal: true },
    { is_enabled: true, is_internal: false },
  ];

  assert.equal(externalDisplayFromState({ displays }), true);
  assert.equal(externalDisplayFromState({ displays: () => displays }), true);
  assert.equal(externalDisplayFromState({ displays: [displays[0]] }), false);
});

test("reports null rather than guessing on an unrecognised shape", () => {
  assert.equal(externalDisplayFromState(null), null);
  assert.equal(externalDisplayFromState(undefined), null);
  assert.equal(externalDisplayFromState(42), null);
  assert.equal(externalDisplayFromState({ somethingElse: 1 }), null);
  // A buffer carrying no displays tells us nothing either.
  assert.equal(externalDisplayFromState(Uint8Array.from([])), null);
});

test("evaluates power conditions", () => {
  const off = { onAc: false, externalDisplay: false };
  const plugged = { onAc: true, externalDisplay: false };
  const docked = { onAc: true, externalDisplay: true };

  assert.equal(conditionMet("always", off), true);
  assert.equal(conditionMet("plugged-in", off), false);
  assert.equal(conditionMet("plugged-in", plugged), true);
  assert.equal(conditionMet("external-display", plugged), false);
  assert.equal(conditionMet("external-display", docked), true);
  assert.equal(conditionMet("plugged-in-and-display", plugged), false);
  assert.equal(conditionMet("plugged-in-and-display", docked), true);
});

test("sanitizes profiles from the config file", () => {
  assert.deepEqual(sanitizeProfile({}), {
    preventDimming: true,
    preventSleep: true,
    condition: "always",
  });
  assert.deepEqual(sanitizeProfile({ preventSleep: false, condition: "plugged-in" }), {
    preventDimming: true,
    preventSleep: false,
    condition: "plugged-in",
  });
  // An unknown condition falls back rather than disabling the profile.
  assert.equal(sanitizeProfile({ condition: "nonsense" }).condition, "always");
  assert.equal(sanitizeProfile(null), null);
});
