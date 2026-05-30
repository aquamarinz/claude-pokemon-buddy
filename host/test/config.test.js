import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("loadConfig fills defaults when file missing", () => {
  const c = loadConfig("/nonexistent.json");

  assert.equal(c.planTokenBudget5h > 0, true);
  assert.equal(typeof c.lat, "number");
  assert.ok(Array.isArray(c.box) && c.box.includes("eevee"));
  assert.deepEqual(c.quietHours, { start: 22, end: 8 });
});
