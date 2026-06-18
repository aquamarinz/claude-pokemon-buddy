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

test("cryFor returns happy/strained variants by mood", () => {
  assert.equal(cryFor("eevee", "happy"), "Bui♪");
  assert.equal(cryFor("eevee", "strained"), "bui…");
  assert.equal(cryFor("charmander", "happy"), "噗噗!");
});

test("cryFor maps fainted/shocked to strained, focused to idle", () => {
  assert.equal(cryFor("vaporeon", "fainted"), "凛~");
  assert.equal(cryFor("vaporeon", "shocked"), "凛~");
  assert.equal(cryFor("vaporeon", "focused"), "咻~");
  assert.equal(cryFor("vaporeon"), "咻~"); // 无 mood -> idle
});

test("cryFor unknown species still falls back to ♪ regardless of mood", () => {
  assert.equal(cryFor("不存在", "happy"), "♪");
});
