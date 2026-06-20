# Batch F — Cleanup Fixes (L3, L5, L7, L11) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:**
- **L3** — `runOneTick` credits `usage.todayTokens` to "today" even when ccusage's latest day isn't today (no usage yet today → `daily.at(-1)` is yesterday), attributing yesterday's tokens to today. Guard growth by `usage.todayPeriod === today`.
- **L5** — `diffRect` can emit a non-multiple-of-8 rect width when the frame width isn't byte-aligned, violating the firmware's "w is a multiple of 8" contract. Round the right edge up to a multiple of 8.
- **L7** — `expPct` is computed in `runOneTick` with no finite guard (a corrupt/legacy `pet.exp` yields `NaN`); guard at the source (downstream `clampPct` already defends, this hardens the producer).
- **L11** — `evolution-trigger.test.js` writes state files under `out/` before `out/` exists on a fresh checkout, producing spurious ENOENT failures. `mkdir` in its `writeState` helper.

**Architecture:** L3 + L7 in `host/src/index.js`; L5 in `host/src/transport/diff.js`; L11 in `host/test/evolution-trigger.test.js`.

**Tech Stack:** Node.js ESM, `node:test`. No new deps.

## Global Constraints
- ESM; `node --test` from `host/`; no new deps.
- Behavior-preserving for the common path: at `W=400` (multiple of 8) L5 is a no-op; when `usage.todayPeriod` is absent or equals `today`, L3 is a no-op.

---

## File Structure
- `host/src/index.js` — guard growth tokens by `todayPeriod` (L3); finite-guard `expPct` (L7). (modify)
- `host/src/transport/diff.js` — byte-align the rect right edge (L5). (modify)
- `host/test/integration.test.js` — L3 test. (modify)
- `host/test/diff.test.js` — L5 test. (modify)
- `host/test/evolution-trigger.test.js` — `mkdir` in `writeState` (L11). (modify)

---

### Task 1: L3 — don't credit growth from a non-today ccusage day

**Files:** Modify `host/src/index.js`; Test `host/test/integration.test.js`

**Interfaces:** `runOneTick` credits growth only when `usage.todayPeriod` is absent (degraded — can't verify) or equals `today`.

- [ ] **Step 1: Write the failing test** — add to `host/test/integration.test.js`:

```js
test("growth is not credited from a ccusage day that isn't today (L3)", async () => {
  const statePath = join("out", "test-l3-period-state.json");
  const framePath = join("out", "test-l3-period-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1, hatched: true, species: "eevee", level: 1, exp: 0,
      bond: 0, streak: 0, shield: 0, lastSettled: "2026-05-29", lastGrowthDay: "2026-05-29",
      todayCreditedExp: 0, todayCreditedBond: 0,
      nature: "Brave", iv: [1, 2, 3, 4, 5, 6], characteristic: "Likes to run",
    }),
  );

  const state = await runOneTick({
    usage: { ...usageWithTokens(5_000), todayPeriod: "2026-05-29" }, // ccusage's latest day is yesterday
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    mock: createMockTransport({ framePath }),
    today: "2026-05-30",
  });

  // yesterday's 5000 tokens must NOT be credited to today
  assert.equal(state.expGain, 0);
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/integration.test.js` → FAIL: without the guard, `applyDailyGrowth({todayTokens:5000})` on a non-firstEver pet (lastGrowthDay set, not sameDay) credits `expGain = 10`.

- [ ] **Step 3: Implement** — in `host/src/index.js`, replace the growth line:

```js
  pet = applyDailyGrowth(pet, { todayTokens: usage.todayTokens, today });
```

with:

```js
  const creditedTokens =
    usage.todayPeriod == null || usage.todayPeriod === today ? usage.todayTokens : 0;
  pet = applyDailyGrowth(pet, { todayTokens: creditedTokens, today });
```

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/integration.test.js` → PASS (new test + all existing; existing tests pass `usage` without `todayPeriod`, so the guard is a no-op for them).

- [ ] **Step 5: Commit** — SKIP.

---

### Task 2: L5 — byte-align the dirty-rect right edge

**Files:** Modify `host/src/transport/diff.js`; Test `host/test/diff.test.js`

**Interfaces:** `diffRect(...).w` is always a multiple of 8.

- [ ] **Step 1: Write the failing test** — add to `host/test/diff.test.js`:

```js
test("diffRect keeps rect width byte-aligned for non-multiple-of-8 widths (L5)", () => {
  // w=12 (rowBytes=2); flip the bit at x=10 (byte 1, bit 5)
  const prev = Uint8Array.from([0x00, 0x00]);
  const next = Uint8Array.from([0x00, 0x20]);
  const rect = diffRect(prev, next, 12, 1);

  assert.equal(rect.x, 8);
  assert.equal(rect.w, 8);
  assert.equal(rect.w % 8, 0);
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/diff.test.js` → FAIL (`rect.w === 4`, clamped to `w=12` then `12-8=4`).

- [ ] **Step 3: Implement** — in `host/src/transport/diff.js`, change line 23:

```js
  const right = Math.min(w, Math.ceil((maxX + 1) / 8) * 8);
```

to:

```js
  const right = Math.min(Math.ceil(w / 8) * 8, Math.ceil((maxX + 1) / 8) * 8);
```

(Both operands are now multiples of 8, so `rectW = right - x` is too. `copyRectBytes` reads up to `ceil(w/8)` bytes/row — the rightmost packed byte exists, so no over-read.)

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/diff.test.js` → PASS (new test + existing; the existing `w=16` tests are unchanged since `ceil(16/8)*8 === 16`).

- [ ] **Step 5: Commit** — SKIP.

---

### Task 3: L7 — finite-guard `expPct` at the source (review-verified)

**Files:** Modify `host/src/index.js`

**Interfaces:** `model.buddy.expPct` is `0` instead of `NaN` when `pet.exp` is non-finite (corrupt/legacy state). No new test (the downstream `clampPct` already maps NaN→0; this hardens the producer; injecting a non-finite `pet.exp` cleanly through `runOneTick` is contrived).

- [ ] **Step 1: Implement** — in `host/src/index.js`, change:

```js
      expPct: Math.round((pet.exp / PARAMS.levelExp) * 100),
```

to:

```js
      expPct: Number.isFinite(pet.exp) ? Math.round((pet.exp / PARAMS.levelExp) * 100) : 0,
```

- [ ] **Step 2: Verify well-formed** — `cd host && node --check src/index.js` → exit 0. (No behavior change for finite `pet.exp`, which is the normal case.)

- [ ] **Step 3: Commit** — SKIP.

---

### Task 4: L11 — test `writeState` creates `out/` (test-infra)

**Files:** Modify `host/test/evolution-trigger.test.js`

**Interfaces:** `writeState` ensures `out/` exists before writing, so a fresh checkout / CI doesn't ENOENT.

- [ ] **Step 1: Implement** — in `host/test/evolution-trigger.test.js`:
  - Update the `node:fs` import to include `mkdirSync`:
    `import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";`
  - Update the `node:path` import to include `dirname`:
    `import { dirname, join } from "node:path";`
  - In the `writeState` helper, add a `mkdirSync` before `writeFileSync`:

```js
function writeState(statePath, overrides) {
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(
    statePath,
    // ...existing JSON.stringify body unchanged...
```

- [ ] **Step 2: Verify** — `cd host && rm -rf out && node --test test/evolution-trigger.test.js` → PASS with NO ENOENT (the helper now creates `out/` before writing). Then `mkdir -p out` again for the rest of the suite.

- [ ] **Step 3: Commit** — SKIP.

---

## Full-suite gate (orchestrator)
`cd host && mkdir -p out && node --test --test-concurrency=1` → only `scripts/play-test.js` fails.

## Self-Review
1. Spec coverage: L3 (Task 1, tested), L5 (Task 2, tested), L7 (Task 3, review), L11 (Task 4, infra). ✓
2. Placeholder scan: concrete code/commands. ✓ (Task 4 keeps the existing JSON body; only adds mkdir + imports.)
3. Type consistency: `creditedTokens` number; `right` multiple of 8; `expPct` finite number. ✓

## Notes for reviewer
- L3: confirm existing integration/evolution tests pass `usage` without `todayPeriod` (guard is a no-op for them) and that the L3 test's pet is non-firstEver (lastGrowthDay set) so the discriminator (expGain 10 vs 0) is real.
- L5: confirm `copyRectBytes` does not over-read when `right` rounds up beyond `w` (rowBytes = ceil(w/8) includes the padding byte).
- L11: confirm `writeState` is the only out/-writing helper in that file that runs before `runOneTick` (which already mkdirs).
