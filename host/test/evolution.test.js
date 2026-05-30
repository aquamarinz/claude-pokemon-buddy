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
        needs: { bond: 160, night: true },
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
