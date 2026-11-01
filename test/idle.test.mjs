import assert from "node:assert/strict";
import test from "node:test";

import {
  NEVER,
  STEAM_DEFAULTS,
  anyPart,
  encodeDimSettings,
  encodeScreensaverSettings,
  encodeSuspendSettings,
  partsEqual,
  partsIn,
  sanitizeTimeouts,
} from "../src/steam/idle.ts";
import { statusText } from "../src/status.ts";

// toBase64 reaches for window.btoa, which is what it has in the Steam client.
globalThis.window = { btoa: globalThis.btoa };

const bytesOf = (base64) => [...globalThis.atob(base64)].map((c) => c.charCodeAt(0));

test("each half encodes only its own fields", () => {
  const timeouts = {
    dimBattery: 300,
    dimAc: 600,
    suspendBattery: 900,
    suspendAc: 3600,
    screensaverBattery: 120,
    screensaverAc: 300,
  };

  // Fields 1 and 2 as floats.
  assert.deepEqual(bytesOf(encodeDimSettings(timeouts)), [
    0x0d, 0x00, 0x00, 0x96, 0x43, 0x15, 0x00, 0x00, 0x16, 0x44,
  ]);
  // Fields 24003 and 24004 as varints.
  assert.deepEqual(bytesOf(encodeSuspendSettings(timeouts)), [
    0x98, 0xdc, 0x0b, 0x84, 0x07, 0xa0, 0xdc, 0x0b, 0x90, 0x1c,
  ]);
  // Fields 24008 and 24009 as varints - and nothing from the suspend half,
  // even though both live in CMsgClientSettings.
  assert.deepEqual(bytesOf(encodeScreensaverSettings(timeouts)), [
    0xc0, 0xdc, 0x0b, 0x78, 0xc8, 0xdc, 0x0b, 0xac, 0x02,
  ]);
});

test("zeroing the screensaver writes both fields as zero", () => {
  assert.deepEqual(bytesOf(encodeScreensaverSettings(NEVER)), [
    0xc0, 0xdc, 0x0b, 0x00, 0xc8, 0xdc, 0x0b, 0x00,
  ]);
});

test("fills in screensaver values missing from a v2 baseline", () => {
  const v2 = { dimBattery: 60, dimAc: 120, suspendBattery: 300, suspendAc: 600 };

  assert.deepEqual(sanitizeTimeouts(v2), {
    ...v2,
    screensaverBattery: STEAM_DEFAULTS.screensaverBattery,
    screensaverAc: STEAM_DEFAULTS.screensaverAc,
  });
  // But a present-and-broken value is still rejected outright.
  assert.equal(sanitizeTimeouts({ ...v2, screensaverAc: -1 }), null);
  assert.equal(sanitizeTimeouts({ ...v2, screensaverBattery: "300" }), null);
  // And the older halves are still required.
  assert.equal(sanitizeTimeouts({ dimBattery: 60 }), null);
});

test("tells which halves a partial update carries", () => {
  assert.deepEqual(partsIn({ screensaverAc: 300 }), {
    dim: false,
    suspend: false,
    screensaver: true,
  });
  assert.deepEqual(partsIn({ dimBattery: 300, suspendAc: 3600 }), {
    dim: true,
    suspend: true,
    screensaver: false,
  });
  assert.deepEqual(partsIn({}), { dim: false, suspend: false, screensaver: false });
});

test("compares parts across all three halves", () => {
  const some = { dim: true, suspend: false, screensaver: true };
  assert.equal(partsEqual(some, { ...some }), true);
  assert.equal(partsEqual(some, { ...some, screensaver: false }), false);
  assert.equal(anyPart({ dim: false, suspend: false, screensaver: true }), true);
  assert.equal(anyPart({ dim: false, suspend: false, screensaver: false }), false);
});

test("describes every combination of held timers", () => {
  assert.equal(
    statusText({ dim: true, suspend: true, screensaver: true }),
    "The screen will not dim, the screensaver will not start and the Deck will not sleep.",
  );
  assert.equal(
    statusText({ dim: false, suspend: false, screensaver: false }),
    "Steam's normal dim, screensaver and sleep timers apply.",
  );
  assert.equal(
    statusText({ dim: true, suspend: false, screensaver: false }),
    "The screen will not dim. The screensaver and sleep are on Steam's normal timers.",
  );
  assert.equal(
    statusText({ dim: false, suspend: false, screensaver: true }),
    "The screensaver will not start. Dimming and sleep are on Steam's normal timers.",
  );
  assert.equal(
    statusText({ dim: true, suspend: true, screensaver: false }),
    "The screen will not dim and the Deck will not sleep. The screensaver is on Steam's normal timer.",
  );
  assert.equal(
    statusText({ dim: false, suspend: true, screensaver: true }),
    "The screensaver will not start and the Deck will not sleep. Dimming is on Steam's normal timer.",
  );
});
