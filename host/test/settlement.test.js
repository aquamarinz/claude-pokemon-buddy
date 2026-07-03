import { test } from "node:test";
import assert from "node:assert/strict";
import { settleDays, settlementWindow, activeDaysFromUsage, buildUsedDays } from "../src/pet/settlement.js";

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

test("care count decays by one for each completed daily settlement and never goes negative", () => {
  const oneCare = settleDays(
    { bond: 100, lastSettled: "2026-05-25", streak: 0, shield: 0, careCount: 1 },
    "2026-05-27",
    { usedDays: new Set(["2026-05-26"]) },
  );
  const noCare = settleDays(
    { bond: 100, lastSettled: "2026-05-25", streak: 0, shield: 0, careCount: 0 },
    "2026-05-27",
    { usedDays: new Set(["2026-05-26"]) },
  );

  assert.equal(oneCare.careCount, 0);
  assert.equal(noCare.careCount, 0);
});

test("active streak crossing 7-day multiples grants shields capped at two", () => {
  const firstShield = settleDays(
    { bond: 100, lastSettled: "2026-05-25", streak: 6, shield: 0 },
    "2026-05-27",
    { usedDays: new Set(["2026-05-26"]) },
  );
  const secondShield = settleDays(
    { bond: 100, lastSettled: "2026-05-25", streak: 13, shield: 1 },
    "2026-05-27",
    { usedDays: new Set(["2026-05-26"]) },
  );
  const capped = settleDays(
    { bond: 100, lastSettled: "2026-05-25", streak: 20, shield: 2 },
    "2026-05-27",
    { usedDays: new Set(["2026-05-26"]) },
  );

  assert.equal(firstShield.streak, 7);
  assert.equal(firstShield.shield, 1);
  assert.equal(secondShield.streak, 14);
  assert.equal(secondShield.shield, 2);
  assert.equal(capped.streak, 21);
  assert.equal(capped.shield, 2);
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

test("settlementWindow lists capped, exclusive days between lastSettled and today", () => {
  assert.deepEqual(settlementWindow("2026-05-27", "2026-05-31"), [
    "2026-05-28",
    "2026-05-29",
    "2026-05-30",
  ]);
  assert.deepEqual(settlementWindow("2026-05-30", "2026-05-31"), []);
  assert.deepEqual(settlementWindow(null, "2026-05-31"), []);
});

test("activeDaysFromUsage returns null when history is unavailable", () => {
  assert.equal(activeDaysFromUsage(undefined), null);
  assert.equal(activeDaysFromUsage({ ok: false }), null);
  assert.equal(activeDaysFromUsage({ ok: true }), null);
  assert.equal(activeDaysFromUsage({ ok: true, activeDays: [] }), null);
});

test("buildUsedDays marks ccusage-active window days as used", () => {
  const pet = { lastSettled: "2026-05-27", lastGrowthDay: null };
  const usage = {
    ok: true,
    activeDays: ["2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30"],
  };
  const used = buildUsedDays(pet, "2026-05-31", usage);
  assert.deepEqual([...used].sort(), ["2026-05-28", "2026-05-29", "2026-05-30"]);
});

test("buildUsedDays decays genuine inactive days within ccusage's known range", () => {
  const pet = { lastSettled: "2026-05-27", lastGrowthDay: null };
  const usage = { ok: true, activeDays: ["2026-05-27", "2026-05-28", "2026-05-30"] };
  const used = buildUsedDays(pet, "2026-05-31", usage);
  // 2026-05-29 absent within known range -> NOT used (will decay)
  assert.equal(used.has("2026-05-28"), true);
  assert.equal(used.has("2026-05-29"), false);
  assert.equal(used.has("2026-05-30"), true);
});

test("buildUsedDays fails open for days before ccusage's earliest record", () => {
  const pet = { lastSettled: "2026-05-27", lastGrowthDay: null };
  const usage = { ok: true, activeDays: ["2026-05-30"] }; // earliest known = 05-30
  const used = buildUsedDays(pet, "2026-05-31", usage);
  // 05-28, 05-29 predate ccusage knowledge -> fail-open (used); 05-30 active (used)
  assert.deepEqual([...used].sort(), ["2026-05-28", "2026-05-29", "2026-05-30"]);
});

test("buildUsedDays fails open entirely when usage history is unavailable", () => {
  const pet = { lastSettled: "2026-05-27", lastGrowthDay: null };
  const used = buildUsedDays(pet, "2026-05-31", { ok: false });
  assert.deepEqual([...used].sort(), ["2026-05-28", "2026-05-29", "2026-05-30"]);
});

test("buildUsedDays counts the in-progress last growth day when it earned", () => {
  const pet = {
    lastSettled: "2026-05-29",
    lastGrowthDay: "2026-05-30",
    todayCreditedExp: 4,
    todayCreditedBond: 4,
  };
  const used = buildUsedDays(pet, "2026-05-31", { ok: false });
  assert.equal(used.has("2026-05-30"), true);
});
