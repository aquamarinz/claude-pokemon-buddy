import { test } from "node:test";
import assert from "node:assert/strict";
import { settleDays } from "../src/pet/settlement.js";

test("settles each missed day once and rerun for same today is idempotent", () => {
  const pet = { bond: 100, lastSettled: "2026-05-25", streak: 5, shield: 1 };

  const a = settleDays(pet, "2026-05-28", { usedDays: new Set() });
  const b = settleDays(a, "2026-05-28", { usedDays: new Set() });

  assert.deepEqual(b, a);
  assert.equal(a.lastSettled, "2026-05-27");
  assert.equal(a.shield, 0);
  assert.equal(a.streak, 0);
  assert.equal(a.bond, 97);
});

test("does not settle the current day before it is complete", () => {
  const pet = { bond: 100, lastSettled: "2026-05-29", streak: 5, shield: 0 };

  const out = settleDays(pet, "2026-05-30", { usedDays: new Set() });

  assert.deepEqual(out, pet);
});

test("settles only completed days in order", () => {
  const pet = { bond: 100, lastSettled: "2026-05-25", streak: 5, shield: 0 };
  const usedDays = new Set(["2026-05-26", "2026-05-28"]);

  const out = settleDays(pet, "2026-05-28", { usedDays });

  assert.equal(out.bond, 97);
  assert.equal(out.streak, 0);
  assert.equal(out.lastSettled, "2026-05-27");
});

test("shield is consumed before breaking streak or decaying bond", () => {
  const pet = { bond: 100, lastSettled: "2026-05-25", streak: 5, shield: 1 };

  const out = settleDays(pet, "2026-05-27", { usedDays: new Set() });

  assert.equal(out.shield, 0);
  assert.equal(out.streak, 5);
  assert.equal(out.bond, 100);
});

test("caps catch-up at maxCatchupDays", () => {
  const pet = { bond: 200, lastSettled: "2026-01-01", streak: 0, shield: 0 };

  const out = settleDays(pet, "2026-01-06", {
    usedDays: new Set(),
    maxCatchupDays: 2,
  });

  assert.equal(out.bond, 194);
  assert.equal(out.lastSettled, "2026-01-05");
});
