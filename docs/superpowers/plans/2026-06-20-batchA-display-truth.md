# Batch A — Display-vs-Truth Fixes (M1, M2, N2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Fix three independent "what's shown ≠ the truth" bugs: (M1) `deriveMood` shows "happy" when utilization is unknown; (M2) the e-ink frame always shows streak 0 because the render model never carries it; (N2) the dashboard shows evolution threshold 160 while the real threshold is 56.

**Architecture:** Three small, independent edits, each with its own test. M1 guards `deriveMood` against non-finite inputs. M2 adds `streak` to the `runOneTick` render model from `pet.streak`. N2 replaces the hard-coded `EVOLVE_BOND = 160` in `viewmodel.js` with `PARAMS.evolveBond` (single source of truth in `sim.js`).

**Tech Stack:** Node.js ESM, `node:test`. No new dependencies.

## Global Constraints

- ESM; `node --test` from `host/`; no new deps.
- Do not change unrelated behavior; each fix is minimal.
- `deriveMood` must keep its existing tested mappings exactly (p5h 0→happy, 50→focused, 80→strained, 100→fainted, cost≥30→shocked). Only the *null/undefined* case changes.

---

## File Structure

- `host/src/pet/sim.js` — guard `deriveMood` against non-finite `p5h`/`todayCost`. (modify)
- `host/src/index.js` — add `streak: pet.streak ?? 0` to the `runOneTick` render model. (modify)
- `host/src/web/viewmodel.js` — import `PARAMS`, use `PARAMS.evolveBond` for `nextEvo.threshold`. (modify)
- `host/test/sim.test.js` — null/undefined mood cases. (modify)
- `host/test/integration.test.js` — render model carries pet streak. (modify)
- `host/test/viewmodel.test.js` — threshold equals `PARAMS.evolveBond`. (modify)

---

### Task 1: M1 — `deriveMood` treats unknown utilization as neutral

**Files:** Modify `host/src/pet/sim.js`; Test `host/test/sim.test.js`

**Interfaces:** `deriveMood({ p5h, todayCost })` — unchanged signature; null/undefined `p5h` now returns `"focused"` instead of `"happy"`; a known cost spike still wins.

- [ ] **Step 1: Write the failing test** — add to `host/test/sim.test.js`:

```js
test("deriveMood treats unknown (null/undefined) utilization as neutral, not happy", () => {
  assert.equal(deriveMood({ p5h: null, todayCost: 0 }), "focused");
  assert.equal(deriveMood({ p5h: null, todayCost: null }), "focused");
  assert.equal(deriveMood({ p5h: undefined, todayCost: 1 }), "focused");
  assert.equal(deriveMood({ p5h: null, todayCost: 30 }), "shocked");
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/sim.test.js` → FAIL (`deriveMood({p5h:null,todayCost:0})` returns `"happy"`).

- [ ] **Step 3: Implement** — replace `deriveMood` in `host/src/pet/sim.js`:

```js
export function deriveMood({ p5h, todayCost } = {}) {
  if (Number.isFinite(todayCost) && todayCost >= PARAMS.costSpikeUSD) return "shocked";
  if (!Number.isFinite(p5h)) return "focused"; // unknown utilization -> neutral, never falsely happy
  if (p5h >= 100) return "fainted";
  if (p5h >= 80) return "strained";
  if (p5h >= 50) return "focused";
  return "happy";
}
```

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/sim.test.js` → PASS (existing threshold test + new test). The existing test's `p5h:0→happy`, `p5h:40,cost:30→shocked` still hold (0 is finite; cost check is first).

- [ ] **Step 5: Commit** — SKIP (orchestrator commits).

---

### Task 2: M2 — render model carries the pet's streak

**Files:** Modify `host/src/index.js` (the `model` object built in `runOneTick`, currently lines 127-148); Test `host/test/integration.test.js`

**Interfaces:** `runOneTick`'s render `model` gains a top-level `streak: number` sourced from `pet.streak`. Consumed by `layout.js` (`model.streak`, already wired).

- [ ] **Step 1: Write the failing test** — add to `host/test/integration.test.js` (uses existing helpers `usageWithTokens`, `sampleWeather`, `createMockTransport`):

```js
test("render model carries the pet's streak from state, not a missing field", async () => {
  const statePath = join("out", "test-model-streak-state.json");
  const framePath = join("out", "test-model-streak-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      hatched: true,
      species: "eevee",
      level: 1,
      exp: 0,
      bond: 0,
      streak: 5,
      shield: 0,
      lastSettled: "2026-05-30",
      lastGrowthDay: "2026-05-30",
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      nature: "Brave",
      iv: [1, 2, 3, 4, 5, 6],
      characteristic: "Likes to run",
    }),
  );

  const models = [];
  await runOneTick({
    usage: usageWithTokens(0),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    mock: createMockTransport({ framePath }),
    today: "2026-05-30",
    onRenderModel: (m) => models.push(m),
  });

  // lastSettled === today => settlement window empty => streak unchanged at 5.
  assert.equal(models[0].streak, 5);
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/integration.test.js` → FAIL (`models[0].streak` is `undefined`).

- [ ] **Step 3: Implement** — in `host/src/index.js`, in the `model` object inside `runOneTick`, add a `streak` line right after `room: sensor,` (and before `out: {`):

```js
    streak: pet.streak ?? 0,
```

(The `...usage` spread does not contain `streak`; this adds it explicitly from `pet`.)

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/integration.test.js` → PASS (new test + all existing, including the H1 settlement tests and "render model shape" test).

- [ ] **Step 5: Commit** — SKIP.

---

### Task 3: N2 — dashboard evolution threshold uses the real `PARAMS.evolveBond`

**Files:** Modify `host/src/web/viewmodel.js`; Test `host/test/viewmodel.test.js`

**Interfaces:** `toDashboardView(...).buddy.nextEvo.threshold` becomes `PARAMS.evolveBond` (56) instead of the hard-coded 160.

- [ ] **Step 1: Update the existing assertion to the truth (failing first)** — in `host/test/viewmodel.test.js`: add the import at the top
`import { PARAMS } from "../src/pet/sim.js";`
and change line 44 from `assert.equal(v.buddy.nextEvo.threshold, 160);` to:

```js
  assert.equal(v.buddy.nextEvo.threshold, PARAMS.evolveBond);
  assert.equal(v.buddy.nextEvo.threshold, 56);
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/viewmodel.test.js` → FAIL (current code returns 160, assertion now expects 56).

- [ ] **Step 3: Implement** — in `host/src/web/viewmodel.js`:
  - Add at the top: `import { PARAMS } from "../pet/sim.js";`
  - Delete the line `const EVOLVE_BOND = 160;`
  - Change `threshold: EVOLVE_BOND,` to `threshold: PARAMS.evolveBond,`

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/viewmodel.test.js` → PASS (including the H2 `rateStale` test added earlier).

- [ ] **Step 5: Commit** — SKIP.

---

## Full-suite gate (orchestrator)

Run: `cd host && mkdir -p out && node --test --test-concurrency=1`
Expected: only `scripts/play-test.js` ("Cannot lock port") fails; all else passes.

## Self-Review

**1. Spec coverage:** M1 null-mood (Task 1, tested), M2 streak-in-model (Task 2, tested), N2 threshold (Task 3, tested). ✓
**2. Placeholder scan:** all steps have concrete code/commands. ✓
**3. Type consistency:** `deriveMood` returns one of the 5 mood strings; `model.streak` number; `PARAMS.evolveBond` number (56). `import { PARAMS }` path is `../pet/sim.js` from `viewmodel.js` (web/ -> pet/) and `../src/pet/sim.js` from the test. ✓

## Notes for reviewer
- Confirm `import { PARAMS } from "../pet/sim.js"` resolves from `host/src/web/viewmodel.js` (web/ is one level under src/, sibling of pet/). And `../src/pet/sim.js` from `host/test/viewmodel.test.js`.
- Confirm no OTHER test asserts `nextEvo.threshold === 160` (grep showed only viewmodel.test.js:44).
- Confirm M1 keeps every existing `deriveMood` mapping (p5h 0/49→happy, 50/79→focused, 80/99→strained, 100→fainted, cost 30→shocked).
- M2: `layout.js` already reads `model.streak` (it renders `${streak}天`); this fix supplies it. Confirm no double-source conflict.
