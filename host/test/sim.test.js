import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMood, applyDailyGrowth, PARAMS } from "../src/pet/sim.js";

test("deriveMood maps 5h percentage thresholds and cost spike", () => {
  assert.equal(deriveMood({ p5h: 0, todayCost: 1 }), "happy");
  assert.equal(deriveMood({ p5h: 49, todayCost: 1 }), "happy");
  assert.equal(deriveMood({ p5h: 50, todayCost: 1 }), "focused");
  assert.equal(deriveMood({ p5h: 79, todayCost: 1 }), "focused");
  assert.equal(deriveMood({ p5h: 80, todayCost: 1 }), "strained");
  assert.equal(deriveMood({ p5h: 99, todayCost: 1 }), "strained");
  assert.equal(deriveMood({ p5h: 100, todayCost: 1 }), "fainted");
  assert.equal(deriveMood({ p5h: 40, todayCost: 30 }), "shocked");
});

test("applyDailyGrowth caps EXP gain and bond gain per day", () => {
  const pet = { level: 1, exp: 90, bond: 100 };

  const out = applyDailyGrowth(pet, { todayTokens: 99_999_999 });

  assert.equal(out.expGain, PARAMS.dailyExpCap);
  assert.equal(out.level, 2);
  assert.equal(out.exp, 90);
  assert.ok(out.bond <= pet.bond + PARAMS.dailyBondCap);
});

test("applyDailyGrowth respects the daily bond soft cap", () => {
  const pet = { level: 1, exp: 0, bond: PARAMS.bondSoftCap - 1 };

  const out = applyDailyGrowth(pet, { todayTokens: 10_000 });

  assert.equal(out.bond, PARAMS.bondSoftCap);
});

test("evolveBond is the ~2-week-from-zero threshold (56)", () => {
  assert.equal(PARAMS.evolveBond, 56);
});

test("newborn bond 0 reaches evolveBond in ~14 active days at bondPerActiveDay", () => {
  let pet = { level: 1, exp: 0, bond: 0, todayCreditedExp: 0, todayCreditedBond: 0, lastGrowthDay: null };
  let days = 0;
  for (let i = 0; i < 30; i += 1) {
    const day = `2026-06-${String(10 + i).padStart(2, "0")}`;
    pet = applyDailyGrowth(pet, { todayTokens: 60_000, today: day });
    days += 1;
    if (pet.bond >= PARAMS.evolveBond) break;
  }
  assert.ok(days >= 12 && days <= 16, `expected ~14 days, got ${days}`);
});
