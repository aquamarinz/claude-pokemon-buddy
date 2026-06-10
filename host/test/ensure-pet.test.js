import { test } from "node:test";
import assert from "node:assert/strict";
import { ensurePet } from "../src/index.js";

const TODAY = "2026-06-10";

test("no hatched flag → newborn eevee bond 0 (fresh start)", () => {
  const pet = ensurePet({ schemaVersion: 1 }, TODAY, () => 0.5);
  assert.equal(pet.species, "eevee");
  assert.equal(pet.level, 1);
  assert.equal(pet.bond, 0);
  assert.equal(pet.hatched, true);
});

test("dirty pre-hatched save (level 7 / bond 129 / no hatched) → reset newborn", () => {
  const dirty = { schemaVersion: 1, _rebuilt: true, species: "eevee", level: 7, bond: 129 };
  const pet = ensurePet(dirty, TODAY, () => 0.5);
  assert.equal(pet.level, 1);
  assert.equal(pet.bond, 0);
  assert.equal(pet.hatched, true);
});

test("hatched save is preserved (not reset)", () => {
  const saved = { schemaVersion: 1, hatched: true, species: "umbreon", level: 9, bond: 70,
    nature: "佛系1", iv: [1,2,3,4,5,6], characteristic: "爱睡午觉" };
  const pet = ensurePet(saved, TODAY, () => 0.5);
  assert.equal(pet.species, "umbreon");
  assert.equal(pet.level, 9);
  assert.equal(pet.bond, 70);
});
