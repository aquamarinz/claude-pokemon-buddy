import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldPlaySignature, createActionQueue } from "../src/index.js";

test("KEY short on a non-evolving pet triggers signature", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, { readyToEvolve: false }), true);
});

test("readyToEvolve pet does NOT trigger signature (evolution owns KEY)", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, { readyToEvolve: true }), false);
});

test("long/double/boot presses do not trigger signature", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "long" }, { readyToEvolve: false }), false);
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "double" }, { readyToEvolve: false }), false);
  assert.equal(shouldPlaySignature({ key: "BOOT", kind: "short" }, { readyToEvolve: false }), false);
});

test("missing pet/event is safe (no trigger)", () => {
  assert.equal(shouldPlaySignature(undefined, undefined), false);                 // undefined!==false
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, undefined), false);
});

test("action queue serializes: 2nd action starts only after 1st resolves", async () => {
  const q = createActionQueue();
  const log = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const a = q.run(async () => { log.push("a-start"); await gate; log.push("a-end"); });
  const b = q.run(async () => { log.push("b-start"); });
  await Promise.resolve();
  assert.deepEqual(log, ["a-start"]);                 // b 尚未开始 → tick 帧不会插进招牌
  release();
  await Promise.all([a, b]);
  assert.deepEqual(log, ["a-start", "a-end", "b-start"]);
});
