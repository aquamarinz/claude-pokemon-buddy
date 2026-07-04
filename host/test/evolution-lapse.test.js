import { test } from "node:test";
import assert from "node:assert/strict";

import { settleDays } from "../src/pet/settlement.js";
import { applyPetTransitions } from "../src/pet/transitions.js";

test("settlement bond lapse clears stale evolution choice prompt state", () => {
  const lapsed = settleDays(
    {
      schemaVersion: 1,
      hatched: true,
      species: "eevee",
      level: 1,
      exp: 0,
      bond: 56,
      streak: 0,
      shield: 0,
      lastSettled: "2026-05-20",
      lastGrowthDay: "2026-05-20",
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      readyToEvolve: true,
      pendingCandidates: [
        { to: "espeon", needs: { bond: 56, daytime: true }, priority: 2 },
        { to: "leafeon", needs: { bond: 56, warmHumid: true }, priority: 3 },
      ],
    },
    "2026-05-22",
    { usedDays: new Set() },
  );

  const { pet } = applyPetTransitions({
    pet: lapsed,
    weather: { cond: "多云", temp: 12, humidity: 50 },
    room: { t: 21, h: 45 },
    now: new Date(2026, 4, 22, 10),
  });

  assert.equal(lapsed.bond, 53);
  assert.equal(pet.readyToEvolve, false);
  assert.equal(pet.pendingCandidates, undefined);
});
