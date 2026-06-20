import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";

import { main, runTickLoop } from "../src/index.js";

const blocksJson = readFileSync(new URL("./fixtures/ccusage-blocks.json", import.meta.url), "utf8");
const dailyJson = readFileSync(new URL("./fixtures/ccusage-daily.json", import.meta.url), "utf8");

test("runTickLoop runs the first tick, survives a throwing tick, and stops when asked (H5)", async () => {
  const calls = [];
  let n = 0;
  let started = false;
  await runTickLoop({
    runTick: async () => {
      n += 1;
      calls.push(n);
      if (n === 2) throw new Error("boom"); // a failing tick must NOT kill the loop
    },
    intervalMs: 0,
    isStopped: () => n >= 3,
    beforeLoop: () => { started = true; },
    setTimer: (resolve) => resolve(), // no real delay
    onError: () => {}, // swallow the expected throw quietly in the test
  });

  assert.deepEqual(calls, [1, 2, 3]); // tick 2 threw but the loop continued to tick 3
  assert.equal(started, true); // beforeLoop ran after the first tick
});

function createBitmapMockTransport({ buttonsOnSubscribe = [] } = {}) {
  const emitter = new EventEmitter();
  return {
    onButton(callback) {
      emitter.on("button", callback);
      for (const b of buttonsOnSubscribe) callback(b); // deliver pre-arrived presses on subscribe
      return () => emitter.off("button", callback);
    },
    async push() {
      return { ok: true };
    },
    feedSensor() {
      return { t: 23, h: 56 };
    },
    playSound() {},
    setActiveCry() {},
    close() {},
  };
}

test("a button that arrived before the tick is buffered and drained into the tick (H4 via main once-mode)", async () => {
  mkdirSync("out", { recursive: true });
  const statePath = join("out", "test-main-h4-state.json");
  const framePath = join("out", "test-main-h4-frame.png");
  const configPath = join("out", "test-main-h4-config.json");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(configPath, { force: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      hatched: true,
      species: "eevee",
      level: 1,
      exp: 0,
      bond: 0,
      streak: 0,
      shield: 0,
      lastSettled: "2026-05-30",
      lastGrowthDay: "2026-05-30",
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      nature: "Brave",
      iv: [1, 2, 3, 4, 5, 6],
      characteristic: "Likes to run",
    }),
  );

  await main({
    once: true,
    dashboard: false,
    statePath,
    framePath,
    configPath,
    transport: createBitmapMockTransport({ buttonsOnSubscribe: [{ key: "KEY", kind: "long" }] }),
    weatherClient: {
      get: async () => ({ cond: "多云", temp: 19, feels: 17, hi: 22, lo: 14, precip: 30, wind: 11, humidity: 64, degraded: false }),
    },
    pollUsage: async () => ({ ok: true, skipped: true }),
    usageRun: async (_command, args) => (args.includes("daily") ? dailyJson : blocksJson),
  });

  const state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(state.careCount, 1); // buffered KEY-long was drained into runOneTick -> care recorded
});
