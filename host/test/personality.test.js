import { test } from "node:test";
import assert from "node:assert/strict";
import { rollPersonality } from "../src/pet/personality.js";

test("rollPersonality is deterministic with seeded rng and valid IVs", () => {
  const a = rollPersonality(mulberry32(42));
  const b = rollPersonality(mulberry32(42));

  assert.deepEqual(a, b);
  assert.equal(a.iv.length, 6);
  assert.ok(a.iv.every((v) => Number.isInteger(v) && v >= 0 && v <= 31));
  assert.equal(typeof a.nature, "string");
  assert.equal(typeof a.characteristic, "string");
});

test("rollPersonality picks characteristic from the first max IV stat", () => {
  const rng = sequenceRng([0, 0.1, 0.999, 0.5, 0.2, 0.3, 0.4]);

  const p = rollPersonality(rng);

  assert.deepEqual(p.iv, [0, 3, 31, 16, 6, 9]);
  assert.equal(p.characteristic, "耐打");
});

function sequenceRng(values) {
  let index = 0;
  return () => values[index++];
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
