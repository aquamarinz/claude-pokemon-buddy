import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleBranches, resolveEvolution } from "../src/pet/evolution.js";

test("multiple eligible branches return candidates sorted by priority with no auto choice", () => {
  const cands = eligibleBranches("eevee", {
    bond: 170,
    care: true,
    daytime: true,
    warmHumid: true,
  });
  const resolved = resolveEvolution("eevee", {
    bond: 170,
    care: true,
    daytime: true,
    warmHumid: true,
  });

  assert.deepEqual(
    cands.map(({ to, priority }) => ({ to, priority })),
    [
      { to: "sylveon", priority: 1 },
      { to: "espeon", priority: 2 },
      { to: "leafeon", priority: 3 },
    ],
  );
  assert.equal(resolved.auto, null);
  assert.deepEqual(resolved.candidates, cands);
});

test("single eligible branch auto-evolves", () => {
  const resolved = resolveEvolution("eevee", { bond: 170, night: true });

  assert.deepEqual(resolved, {
    auto: "umbreon",
    candidates: [
      {
        to: "umbreon",
        needs: { bond: 56, night: true },
        priority: 2,
      },
    ],
  });
});

test("stone branch overrides when another branch is also eligible", () => {
  const resolved = resolveEvolution("eevee", {
    bond: 170,
    daytime: true,
    stone: "fire",
  });

  assert.equal(resolved.auto, "flareon");
  assert.deepEqual(
    resolved.candidates.map(({ to, priority }) => ({ to, priority })),
    [
      { to: "espeon", priority: 2 },
      { to: "flareon", priority: 9 },
    ],
  );
});

test("bulbasaur evolves to ivysaur at level 14", () => {
  assert.equal(resolveEvolution("bulbasaur", { level: 13 }).auto, null);
  assert.equal(resolveEvolution("bulbasaur", { level: 14 }).auto, "ivysaur");
});

test("charmander -> charmeleon at 14, charmeleon -> charizard at 30", () => {
  assert.equal(resolveEvolution("charmander", { level: 14 }).auto, "charmeleon");
  assert.equal(resolveEvolution("charmeleon", { level: 29 }).auto, null);
  assert.equal(resolveEvolution("charmeleon", { level: 30 }).auto, "charizard");
});

test("squirtle line loads (data-driven, no code per species)", () => {
  assert.equal(resolveEvolution("squirtle", { level: 14 }).auto, "wartortle");
});

test("eevee branches still resolve by bond (regression)", () => {
  assert.equal(resolveEvolution("eevee", { bond: 56, daytime: true }).auto, "espeon");
});
