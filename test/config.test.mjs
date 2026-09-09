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
  assert.equal(config.version, 2);
});

test("migrates a v1 inhibit flag to both halves", () => {
  assert.deepEqual(parseOverridden(true), { dim: true, suspend: true });
  assert.deepEqual(parseOverridden(false), { dim: false, suspend: false });
  assert.deepEqual(parseOverridden({ dim: true, suspend: false }), { dim: true, suspend: false });
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
    condition: "plugged-in",
  });
});

test("an app with no profile of its own follows the defaults", () => {
  const config = parseConfig({ apps: { 570: { name: "Dota 2" } } });

  assert.equal(config.apps["570"].profile, null);
  assert.deepEqual(config.defaults, {
    preventDimming: true,
    preventSleep: true,
    condition: "always",
  });
});

test("rejects a malformed baseline rather than restoring nonsense", () => {
  assert.equal(parseConfig({ baseline: { dimBattery: -1 } }).baseline, null);
  assert.equal(parseConfig({ baseline: "300" }).baseline, null);
  assert.deepEqual(
    parseConfig({ baseline: { dimBattery: 300, dimAc: 300, suspendBattery: 900, suspendAc: 3600 } })
      .baseline,
    { dimBattery: 300, dimAc: 300, suspendBattery: 900, suspendAc: 3600 },
  );
});

test("round-trips through the stored form", () => {
  const config = parseConfig({
    defaults: { preventDimming: false, preventSleep: true, condition: "external-display" },
    apps: { 570: { name: "Dota 2", profile: null } },
    global_override: true,
    baseline: { dimBattery: 60, dimAc: 120, suspendBattery: 300, suspendAc: 600 },
    inhibit_active: { dim: false, suspend: true },
  });

  assert.deepEqual(parseConfig(serializeConfig(config)), config);
});
