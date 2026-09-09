import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeScalarFields,
  encodeFloatField,
  encodeVarintField,
  toBase64,
} from "../src/steam/protobuf.ts";

// toBase64 reaches for window.btoa, which is what it has in the Steam client.
globalThis.window = { btoa: globalThis.btoa };

test("encodes a float field with the expected key and little-endian payload", () => {
  // Field 1 (idle_backlight_dim_battery_seconds), wire type 5:
  // key = (1 << 3) | 5 = 0x0d, then 300.0f = 0x43960000 little-endian.
  assert.deepEqual(encodeFloatField(1, 300), [0x0d, 0x00, 0x00, 0x96, 0x43]);
  // Field 2 (idle_backlight_dim_ac_seconds): key = (2 << 3) | 5 = 0x15.
  assert.deepEqual(encodeFloatField(2, 0), [0x15, 0x00, 0x00, 0x00, 0x00]);
});

test("encodes a varint field with a multi-byte key", () => {
  // Field 24003 (system_idle_suspend_battery_sec), wire type 0:
  // key = 24003 << 3 = 192024, then 900 as a varint.
  assert.deepEqual(encodeVarintField(24003, 900), [0x98, 0xdc, 0x0b, 0x84, 0x07]);
  // Field 24004 (system_idle_suspend_ac_sec): key = 24004 << 3 = 192032.
  assert.deepEqual(encodeVarintField(24004, 3600), [0xa0, 0xdc, 0x0b, 0x90, 0x1c]);
  // Zero still has to be written out, or Steam keeps the previous value.
  assert.deepEqual(encodeVarintField(24003, 0), [0x98, 0xdc, 0x0b, 0x00]);
});

test("round-trips the four fields the plugin writes", () => {
  const bytes = [
    ...encodeFloatField(1, 300),
    ...encodeFloatField(2, 600),
    ...encodeVarintField(24003, 900),
    ...encodeVarintField(24004, 3600),
  ];

  const fields = decodeScalarFields(Uint8Array.from(bytes));

  assert.equal(fields.get(1)?.float, 300);
  assert.equal(fields.get(2)?.float, 600);
  assert.equal(fields.get(24003)?.varint, 900);
  assert.equal(fields.get(24004)?.varint, 3600);
});

test("skips fields it does not understand", () => {
  const bytes = [
    // Field 3, length-delimited: two bytes of payload we must step over.
    (3 << 3) | 2,
    2,
    0xff,
    0xff,
    // Field 4, fixed64: eight bytes to step over.
    (4 << 3) | 1,
    ...new Array(8).fill(0xff),
    ...encodeVarintField(24003, 42),
  ];

  const fields = decodeScalarFields(Uint8Array.from(bytes));

  assert.equal(fields.get(24003)?.varint, 42);
});

test("stops cleanly on a truncated message", () => {
  const bytes = [...encodeVarintField(24003, 900), ...encodeFloatField(1, 300).slice(0, 3)];

  const fields = decodeScalarFields(Uint8Array.from(bytes));

  assert.equal(fields.get(24003)?.varint, 900);
  assert.equal(fields.has(1), false);
});

test("base64 encodes the raw bytes", () => {
  const bytes = encodeFloatField(1, 300);

  const decoded = [...globalThis.atob(toBase64(bytes))].map((c) => c.charCodeAt(0));

  assert.deepEqual(decoded, bytes);
});
