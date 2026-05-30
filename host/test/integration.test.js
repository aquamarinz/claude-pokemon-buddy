import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runOneTick } from "../src/index.js";

test("one tick produces frame and advances state", async () => {
  const statePath = join("out", "test-state.json");
  const framePath = join("out", "test-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });

  const state = await runOneTick({
    usage: {
      p5h: 72,
      pweek: 41,
      todayCost: 4.1,
      todayTokens: 5_300_000,
      modelled: true,
      weekTokens: 30_000_000,
    },
    weather: {
      cond: "多云",
      temp: 19,
      feels: 17,
      hi: 22,
      lo: 14,
      precip: 30,
      wind: 11,
      humidity: 64,
    },
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-30",
  });

  assert.equal(existsSync(framePath), true);
  assert.equal(existsSync(statePath), true);
  assert.ok(state.level >= 1);
  assert.ok(state.expGain > 0);
  assert.equal(state.lastGrowthDay, "2026-05-30");
});
