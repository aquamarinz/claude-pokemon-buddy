import { test } from "node:test";
import assert from "node:assert/strict";

import { validateSettings } from "../src/web/settings.js";

test("accepts only real preference settings", () => {
  const result = validateSettings({
    name: "阿布",
    quietHours: { start: 22, end: 8 },
    volume: 70,
    lat: -36.8,
    lon: 174.8,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    name: "阿布",
    quietHours: { start: 22, end: 8 },
    volume: 70,
    lat: -36.8,
    lon: 174.8,
  });
});

test("accepts partial preference updates", () => {
  const result = validateSettings({ name: "布布", volume: 0 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { name: "布布", volume: 0 });
});

test("rejects rule and hidden switch fields", () => {
  for (const field of ["difficulty", "decayRate", "eggToggle"]) {
    const result = validateSettings({ [field]: "easy" });

    assert.equal(result.ok, false);
    assert.match(result.error, /unknown setting/i);
  }
});

test("rejects invalid ranges and overlong names", () => {
  assert.equal(validateSettings({ name: "12345678901234567" }).ok, false);
  assert.equal(validateSettings({ quietHours: { start: 24, end: 8 } }).ok, false);
  assert.equal(validateSettings({ volume: 101 }).ok, false);
  assert.equal(validateSettings({ lat: -91 }).ok, false);
  assert.equal(validateSettings({ lon: 181 }).ok, false);
});
