import assert from "node:assert/strict";
import test from "node:test";

import { parseConfig, parseOverridden, serializeConfig } from "../src/config-schema.ts";

test("migrates v1 app entries to profiles that follow the defaults", () => {
  const config = parseConfig({
    version: 1,
    apps: { 1839700: "The Jackbox Party Pack 8", 570: "Dota 2" },
    global_override: false,
    inhibit_active: false,
  });

  assert.deepEqual(config.apps, {
    1839700: { name: "The Jackbox Party Pack 8", profile: null },
    570: { name: "Dota 2", profile: null },
  });
  assert.equal(config.version, 3);
});

test("migrates a v1 inhibit flag to the two halves that existed then", () => {
  assert.deepEqual(parseOverridden(true), { dim: true, suspend: true, screensaver: false });
  assert.deepEqual(parseOverridden(false), { dim: false, suspend: false, screensaver: false });
  assert.deepEqual(parseOverridden({ dim: true, suspend: false }), {
    dim: true,
    suspend: false,
    screensaver: false,
  });
  assert.deepEqual(parseOverridden({ dim: false, suspend: false, screensaver: true }), {
    dim: false,
    suspend: false,
    screensaver: true,
  });
});

test("migrates a v2 config, keeping a stale override recoverable", () => {
  // Exactly what a v2 build would have written while holding both halves.
  const config = parseConfig({
    version: 2,
    defaults: { preventDimming: true, preventSleep: false, condition: "plugged-in" },
    apps: { 570: { name: "Dota 2", profile: { preventDimming: false, preventSleep: true, condition: "always" } } },
    global_override: false,
    baseline: { dimBattery: 60, dimAc: 120, suspendBattery: 300, suspendAc: 600 },
    inhibit_active: { dim: true, suspend: true },
  });

  assert.equal(config.version, 3);
  // Existing profiles gain the screensaver toggle, switched on like the others.
  assert.deepEqual(config.defaults, {
    preventDimming: true,
    preventSleep: false,
    preventScreensaver: true,
    condition: "plugged-in",
  });
  assert.deepEqual(config.apps["570"].profile, {
    preventDimming: false,
    preventSleep: true,
    preventScreensaver: true,
    condition: "always",
  });
  // The baseline survives, so the dim and suspend timers still get restored.
  assert.deepEqual(config.baseline, {
    dimBattery: 60,
    dimAc: 120,
    suspendBattery: 300,
    suspendAc: 600,
    screensaverBattery: 0,
    screensaverAc: 300,
  });
  // The screensaver was never held by a v2 session, so it is not owed back.
  assert.deepEqual(config.overridden, { dim: true, suspend: true, screensaver: false });
});

test("keeps v2 entries and drops junk keys", () => {
  const config = parseConfig({
    apps: {
      570: { name: "Dota 2", profile: { preventDimming: false, condition: "plugged-in" } },
      "not-an-appid": { name: "nope" },
      123: null,
    },
  });

  assert.deepEqual(Object.keys(config.apps), ["570"]);
  assert.deepEqual(config.apps["570"].profile, {
    preventDimming: false,
    preventSleep: true,
    preventScreensaver: true,
    condition: "plugged-in",
  });
});

test("an app with no profile of its own follows the defaults", () => {
  const config = parseConfig({ apps: { 570: { name: "Dota 2" } } });

  assert.equal(config.apps["570"].profile, null);
  assert.deepEqual(config.defaults, {
    preventDimming: true,
    preventSleep: true,
    preventScreensaver: true,
    condition: "always",
  });
});

test("rejects a malformed baseline rather than restoring nonsense", () => {
  assert.equal(parseConfig({ baseline: { dimBattery: -1 } }).baseline, null);
  assert.equal(parseConfig({ baseline: "300" }).baseline, null);
  assert.equal(parseConfig({ baseline: { dimBattery: 300, screensaverAc: -1 } }).baseline, null);
  const full = {
    dimBattery: 300,
    dimAc: 300,
    suspendBattery: 900,
    suspendAc: 3600,
    screensaverBattery: 0,
    screensaverAc: 300,
  };
  assert.deepEqual(parseConfig({ baseline: full }).baseline, full);
});

test("round-trips through the stored form", () => {
  const config = parseConfig({
    defaults: {
      preventDimming: false,
      preventSleep: true,
      preventScreensaver: false,
      condition: "external-display",
    },
    apps: { 570: { name: "Dota 2", profile: null } },
    global_override: true,
    baseline: {
      dimBattery: 60,
      dimAc: 120,
      suspendBattery: 300,
      suspendAc: 600,
      screensaverBattery: 30,
      screensaverAc: 90,
    },
    inhibit_active: { dim: false, suspend: true, screensaver: true },
  });

  assert.deepEqual(parseConfig(serializeConfig(config)), config);
});
