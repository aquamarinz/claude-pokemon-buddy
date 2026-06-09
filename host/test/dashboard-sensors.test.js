import { test } from "node:test";
import assert from "node:assert/strict";

import { dashboardSensors } from "../src/index.js";

// Regression: cold start before the first SENSOR frame arrives, transport
// feedSensor() returns null. getView must not crash on `null.roomT`.
test("dashboardSensors handles null room (cold start, SENSOR not yet arrived)", () => {
  assert.deepEqual(dashboardSensors(null), { roomT: null, roomH: null });
});

test("dashboardSensors handles undefined room", () => {
  assert.deepEqual(dashboardSensors(undefined), { roomT: null, roomH: null });
});

test("dashboardSensors maps t/h to roomT/roomH", () => {
  assert.deepEqual(dashboardSensors({ t: 22.9, h: 31 }), { roomT: 22.9, roomH: 31 });
});

test("dashboardSensors prefers explicit roomT/roomH over t/h", () => {
  assert.deepEqual(dashboardSensors({ roomT: 20, roomH: 40, t: 99, h: 99 }), { roomT: 20, roomH: 40 });
});
