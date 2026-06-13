import { test } from "node:test";
import assert from "node:assert/strict";
import { SPECIES_ZH, zhName } from "../src/pet/species-meta.js";

const ALL = [
  "eevee", "vaporeon", "jolteon", "flareon", "espeon", "umbreon", "leafeon", "glaceon", "sylveon",
  "bulbasaur", "ivysaur", "venusaur", "charmander", "charmeleon", "charizard", "squirtle", "wartortle", "blastoise",
];

test("all 18 species have a non-empty Chinese name", () => {
  for (const sp of ALL) {
    assert.equal(typeof SPECIES_ZH[sp], "string");
    assert.ok(SPECIES_ZH[sp].length > 0, `${sp} missing`);
  }
});

test("zhName falls back to the raw species id for unknown", () => {
  assert.equal(zhName("eevee"), "伊布");
  assert.equal(zhName("missingno"), "missingno");
});
