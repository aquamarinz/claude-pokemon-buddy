import { test } from "node:test";
import assert from "node:assert/strict";

import { CRIES, cryFor, EEVEE_IDLE_CRY } from "../src/pet/cries.js";

test("Eevee idle cry is species themed", () => {
  assert.equal(EEVEE_IDLE_CRY, "Bui!");
});

test("EEVEE_IDLE_CRY tracks CRIES.eevee", () => {
  assert.equal(EEVEE_IDLE_CRY, CRIES.eevee);
});

test("cryFor returns the species-specific cry", () => {
  assert.equal(cryFor("bulbasaur"), "种子!");
  assert.equal(cryFor("eevee"), "Bui!");
  assert.equal(cryFor("charizard"), "吼!!");
});

test("cryFor falls back to a neutral note for unknown species", () => {
  assert.equal(cryFor("不存在"), "♪");
  assert.equal(cryFor(undefined), "♪");
});
