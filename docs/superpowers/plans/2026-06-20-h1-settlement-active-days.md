# H1 — Settlement Uses ccusage Active-Day History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the pet's streak/bond from being punished for days the host was offline but the user actually used Claude, by deriving the settlement `usedDays` set from ccusage's per-day history instead of from the single `pet.lastGrowthDay`.

**Architecture:** ccusage `daily` already lists every day with usage (days with zero usage are simply absent). Task 1 surfaces those active-day periods (`activeDays: string[]`) on the usage snapshot. Task 2 adds a pure, unit-tested `buildUsedDays(pet, today, usage)` helper in `settlement.js` that maps the settlement window against `activeDays` with a fail-open rule for unknown days. Task 3 wires it into `runOneTick`, replacing the one-day `closedUsageDays` set.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, no new dependencies.

## Global Constraints

- Module system: ESM (`import`/`export`), `"type": "module"`. One line each, copied from `host/package.json`.
- Test runner: `node --test` (run from `host/`). No new dependencies may be added.
- Date strings are `YYYY-MM-DD`; comparisons are lexicographic (already the codebase convention in `index.js`/`settlement.js`).
- `settleDays`' existing public signature `settleDays(pet, today, { usedDays, maxCatchupDays, bondDecayPerMissed })` MUST keep working unchanged (existing `settlement.test.js` calls it directly).
- Fail-open policy (project decision for this fix): when active-day history is unavailable or a window day predates ccusage's earliest record, treat that day as USED (do not decay). Never punish for data we cannot see.

---

## File Structure

- `host/src/usage.js` — add `activeDays` to the normalized usage object and the degraded fallback. (modify)
- `host/src/pet/settlement.js` — add `settlementWindow`, `activeDaysFromUsage`, `buildUsedDays`; refactor `settleDays` to reuse `settlementWindow`. (modify)
- `host/src/index.js` — in `runOneTick`, replace the `closedUsageDays` block with `buildUsedDays(...)`. (modify)
- `host/test/usage.test.js` — assert `activeDays` extraction + degraded fallback. (modify)
- `host/test/settlement.test.js` — unit tests for `settlementWindow`/`activeDaysFromUsage`/`buildUsedDays`; confirm existing tests still pass. (modify)
- `host/test/integration.test.js` — H1 repro: offline-but-active days not punished; contrast: genuine inactive day still decays. (modify)

---

### Task 1: Surface ccusage active-day periods on the usage snapshot

**Files:**
- Modify: `host/src/usage.js` (`normalizeUsage` return object; `usageForDisplay` degraded-no-lastKnown fallback)
- Test: `host/test/usage.test.js`

**Interfaces:**
- Consumes: ccusage `daily` array entries each with `period: string` and `totalTokens: number` (validated by existing `stringField`/`numberField`).
- Produces: `normalizeUsage(...)` return object gains `activeDays: string[]` — the `period` of every daily entry with `totalTokens > 0`, in ccusage's order. The degraded-no-lastKnown branch of `usageForDisplay` gains `activeDays: null`.

- [ ] **Step 1: Write the failing test**

Add to `host/test/usage.test.js`:

```js
test("normalizeUsage surfaces activeDays (periods with usage)", () => {
  const expected = dailyFixture.daily
    .filter((day) => day.totalTokens > 0)
    .map((day) => day.period);
  const u = normalizeUsage({ blocksJson, dailyJson });

  assert.deepEqual(u.activeDays, expected);
  assert.equal(u.activeDays.at(-1), dailyFixture.daily.at(-1).period);
});

test("usageForDisplay degraded with no last-known reports activeDays null", () => {
  const { usage } = usageForDisplay({ ok: false }, null);
  assert.equal(usage.activeDays, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd host && node --test test/usage.test.js`
Expected: FAIL — `u.activeDays` is `undefined` (deepEqual mismatch) and the degraded `usage.activeDays` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `host/src/usage.js`, inside `normalizeUsage`, after the `const today = daily.at(-1);` / `todayPeriod` lines, compute the active days, then add the field to the returned object:

```js
  const activeDays = daily
    .filter((day) => numberField(day.totalTokens, "daily.totalTokens") > 0)
    .map((day) => stringField(day.period, "daily.period"));
```

Add `activeDays,` to the object literal returned by `normalizeUsage` (e.g. directly after `todayPeriod,`).

In `usageForDisplay`, in the final `return { usage: { ... }, lastKnown: null }` fallback object, add:

```js
      activeDays: null,
```

(The `snapshot.ok` branch returns the snapshot verbatim, which now carries `activeDays`; the stale branch spreads `lastKnown`, which carries it too — no change needed there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd host && node --test test/usage.test.js`
Expected: PASS (all tests in file, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add host/src/usage.js host/test/usage.test.js
git commit -m "feat(usage): surface ccusage activeDays periods on the snapshot"
```

---

### Task 2: Add `buildUsedDays` + `settlementWindow` to settlement.js

**Files:**
- Modify: `host/src/pet/settlement.js`
- Test: `host/test/settlement.test.js`

**Interfaces:**
- Consumes: `usage.activeDays` from Task 1 (array of `YYYY-MM-DD`, or `null`/absent when unknown); `pet.lastSettled`, `pet.lastGrowthDay`, `pet.todayCreditedExp`, `pet.todayCreditedBond`.
- Produces:
  - `settlementWindow(lastSettled, today, maxCatchupDays = 30): string[]` — the capped, exclusive day list between `lastSettled` and `today` (same set `settleDays` iterates).
  - `activeDaysFromUsage(usage): Set<string> | null` — `null` when usage is missing, `usage.ok === false`, or `activeDays` is not an array; otherwise a Set of the periods.
  - `buildUsedDays(pet, today, usage, { maxCatchupDays = 30 } = {}): Set<string>` — the `usedDays` set to hand to `settleDays`.

- [ ] **Step 1: Write the failing test**

Add to `host/test/settlement.test.js` (import line becomes
`import { settleDays, settlementWindow, activeDaysFromUsage, buildUsedDays } from "../src/pet/settlement.js";`):

```js
test("settlementWindow lists capped, exclusive days between lastSettled and today", () => {
  assert.deepEqual(settlementWindow("2026-05-27", "2026-05-31"), [
    "2026-05-28",
    "2026-05-29",
    "2026-05-30",
  ]);
  assert.deepEqual(settlementWindow("2026-05-30", "2026-05-31"), []);
  assert.deepEqual(settlementWindow(null, "2026-05-31"), []);
});

test("activeDaysFromUsage returns null when history is unavailable", () => {
  assert.equal(activeDaysFromUsage(undefined), null);
  assert.equal(activeDaysFromUsage({ ok: false }), null);
  assert.equal(activeDaysFromUsage({ ok: true }), null);
  assert.equal(activeDaysFromUsage({ ok: true, activeDays: [] }), null);
});

test("buildUsedDays marks ccusage-active window days as used", () => {
  const pet = { lastSettled: "2026-05-27", lastGrowthDay: null };
  const usage = {
    ok: true,
    activeDays: ["2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30"],
  };
  const used = buildUsedDays(pet, "2026-05-31", usage);
  assert.deepEqual([...used].sort(), ["2026-05-28", "2026-05-29", "2026-05-30"]);
});

test("buildUsedDays decays genuine inactive days within ccusage's known range", () => {
  const pet = { lastSettled: "2026-05-27", lastGrowthDay: null };
  const usage = { ok: true, activeDays: ["2026-05-27", "2026-05-28", "2026-05-30"] };
  const used = buildUsedDays(pet, "2026-05-31", usage);
  // 2026-05-29 absent within known range -> NOT used (will decay)
  assert.equal(used.has("2026-05-28"), true);
  assert.equal(used.has("2026-05-29"), false);
  assert.equal(used.has("2026-05-30"), true);
});

test("buildUsedDays fails open for days before ccusage's earliest record", () => {
  const pet = { lastSettled: "2026-05-27", lastGrowthDay: null };
  const usage = { ok: true, activeDays: ["2026-05-30"] }; // earliest known = 05-30
  const used = buildUsedDays(pet, "2026-05-31", usage);
  // 05-28, 05-29 predate ccusage knowledge -> fail-open (used); 05-30 active (used)
  assert.deepEqual([...used].sort(), ["2026-05-28", "2026-05-29", "2026-05-30"]);
});

test("buildUsedDays fails open entirely when usage history is unavailable", () => {
  const pet = { lastSettled: "2026-05-27", lastGrowthDay: null };
  const used = buildUsedDays(pet, "2026-05-31", { ok: false });
  assert.deepEqual([...used].sort(), ["2026-05-28", "2026-05-29", "2026-05-30"]);
});

test("buildUsedDays counts the in-progress last growth day when it earned", () => {
  const pet = {
    lastSettled: "2026-05-29",
    lastGrowthDay: "2026-05-30",
    todayCreditedExp: 4,
    todayCreditedBond: 4,
  };
  const used = buildUsedDays(pet, "2026-05-31", { ok: false });
  assert.equal(used.has("2026-05-30"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd host && node --test test/settlement.test.js`
Expected: FAIL — `settlementWindow`, `activeDaysFromUsage`, `buildUsedDays` are not exported (import yields `undefined`, calls throw `TypeError`).

- [ ] **Step 3: Write minimal implementation**

In `host/src/pet/settlement.js`: export `settlementWindow`, refactor `settleDays` to use it, and add the two new helpers. Final file:

```js
const DAY_MS = 86_400_000;

export function settleDays(
  pet,
  today,
  { usedDays, maxCatchupDays = 30, bondDecayPerMissed = 3 },
) {
  if (!pet.lastSettled) return pet;

  const days = settlementWindow(pet.lastSettled, today, maxCatchupDays);
  if (days.length === 0) return pet;

  let bond = pet.bond;
  let streak = pet.streak;
  let shield = pet.shield;

  for (const day of days) {
    if (usedDays.has(day)) {
      streak += 1;
    } else if (shield > 0) {
      shield -= 1;
    } else {
      streak = 0;
      bond = Math.max(0, bond - bondDecayPerMissed);
    }
  }

  return { ...pet, bond, streak, shield, lastSettled: days.at(-1) };
}

export function settlementWindow(lastSettled, today, maxCatchupDays = 30) {
  if (!lastSettled) return [];
  return cappedDays(daysBetween(lastSettled, today), maxCatchupDays);
}

export function activeDaysFromUsage(usage) {
  if (!usage || usage.ok === false) return null;
  // Empty array == "no history we can trust" -> null -> fail-open (never punish
  // for data we cannot see). Non-array (missing field) is treated the same.
  if (!Array.isArray(usage.activeDays) || usage.activeDays.length === 0) return null;
  return new Set(usage.activeDays);
}

export function buildUsedDays(pet, today, usage, { maxCatchupDays = 30 } = {}) {
  const window = settlementWindow(pet.lastSettled, today, maxCatchupDays);
  const used = new Set();
  if (window.length === 0) return used;

  const active = activeDaysFromUsage(usage);
  if (!active) {
    // History unavailable -> cannot prove inactivity -> fail-open (no decay).
    for (const day of window) used.add(day);
    return used;
  }

  // Earliest day ccusage knows about; days before it are unknown -> fail-open.
  let knownFrom = null;
  for (const day of active) {
    if (knownFrom === null || day < knownFrom) knownFrom = day;
  }

  for (const day of window) {
    if (active.has(day) || (knownFrom !== null && day < knownFrom)) used.add(day);
  }

  // The in-progress last growth day, if it already earned, counts as used.
  if (
    pet.lastGrowthDay &&
    pet.lastGrowthDay < today &&
    ((pet.todayCreditedExp ?? 0) > 0 || (pet.todayCreditedBond ?? 0) > 0)
  ) {
    used.add(pet.lastGrowthDay);
  }

  return used;
}

function cappedDays(days, maxCatchupDays) {
  const start = Math.max(0, days.length - maxCatchupDays);
  return days.slice(start);
}

function daysBetween(from, to) {
  const days = [];
  let current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (true) {
    current = new Date(Number(current) + DAY_MS);
    if (current >= end) break;
    days.push(toYmd(current));
  }

  return days;
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd host && node --test test/settlement.test.js`
Expected: PASS — the 5 pre-existing tests plus all new tests pass (the refactor of `settleDays` is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add host/src/pet/settlement.js host/test/settlement.test.js
git commit -m "feat(settlement): buildUsedDays from ccusage active-day history (fail-open)"
```

---

### Task 3: Wire `buildUsedDays` into `runOneTick`

**Files:**
- Modify: `host/src/index.js` (import from `./pet/settlement.js`; replace the `closedUsageDays` block in `runOneTick`, currently `index.js:94-105`)
- Test: `host/test/integration.test.js`

**Interfaces:**
- Consumes: `buildUsedDays` (Task 2); the `usage` argument already present in `runOneTick` (now carrying `activeDays`).
- Produces: no new exports; `runOneTick` behavior change only.

- [ ] **Step 1: Write the failing test**

Add to `host/test/integration.test.js`:

```js
test("offline days with real ccusage usage are not punished as missed (H1)", async () => {
  const statePath = join("out", "test-h1-active-state.json");
  const framePath = join("out", "test-h1-active-frame.png");
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
      bond: 100,
      streak: 5,
      shield: 0,
      lastSettled: "2026-05-27",
      lastGrowthDay: null,
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      nature: "Brave",
      iv: [1, 2, 3, 4, 5, 6],
      characteristic: "Likes to run",
    }),
  );

  const state = await runOneTick({
    usage: {
      ok: true,
      p5h: 12,
      pweek: 34,
      todayCost: 1,
      todayTokens: 1_000,
      modelled: true,
      weekTokens: 5_000,
      activeDays: [
        "2026-05-26",
        "2026-05-27",
        "2026-05-28",
        "2026-05-29",
        "2026-05-30",
        "2026-05-31",
      ],
    },
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    mock: createMockTransport({ framePath }),
    today: "2026-05-31",
  });

  // window 05-28..05-30 all active -> streak +3 (settleDays only); bond not decayed.
  // applyDailyGrowth then adds firstEver bond +4 (1000 tokens) -> bond 104.
  assert.equal(state.streak, 8);
  assert.equal(state.bond, 104);
});

test("genuine inactive day within ccusage range still decays", async () => {
  const statePath = join("out", "test-h1-inactive-state.json");
  const framePath = join("out", "test-h1-inactive-frame.png");
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
      bond: 100,
      streak: 5,
      shield: 0,
      lastSettled: "2026-05-27",
      lastGrowthDay: null,
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      nature: "Brave",
      iv: [1, 2, 3, 4, 5, 6],
      characteristic: "Likes to run",
    }),
  );

  const state = await runOneTick({
    usage: {
      ok: true,
      p5h: 12,
      pweek: 34,
      todayCost: 1,
      todayTokens: 0,
      modelled: true,
      weekTokens: 0,
      activeDays: ["2026-05-27", "2026-05-28", "2026-05-30", "2026-05-31"],
    },
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    mock: createMockTransport({ framePath }),
    today: "2026-05-31",
  });

  // 05-28 used (+1), 05-29 absent -> streak reset to 0 + bond -3, 05-30 used (+1).
  // todayTokens 0 -> no growth bond change.
  assert.equal(state.streak, 1);
  assert.equal(state.bond, 97);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd host && node --test test/integration.test.js`
Expected: FAIL on "offline days ... not punished" — current code uses one-day `closedUsageDays`, so 05-28/05-29/05-30 are all treated as missed → `state.streak === 0`, `state.bond === 95` (100 − 9 decay + 4 growth). The "genuine inactive" test passes by coincidence under old code (all missed); it locks in correct behavior post-fix.

- [ ] **Step 3: Write minimal implementation**

In `host/src/index.js`:

Add `buildUsedDays` to the settlement import (currently `import { settleDays } from "./pet/settlement.js";`):

```js
import { buildUsedDays, settleDays } from "./pet/settlement.js";
```

In `runOneTick`, replace the block currently at `index.js:94-105`:

```js
  const closedUsageDays = new Set();
  if (
    pet.lastGrowthDay &&
    pet.lastGrowthDay < today &&
    ((pet.todayCreditedExp ?? 0) > 0 || (pet.todayCreditedBond ?? 0) > 0)
  ) {
    closedUsageDays.add(pet.lastGrowthDay);
  }

  pet = settleDays(pet, today, {
    usedDays: closedUsageDays,
  });
```

with:

```js
  pet = settleDays(pet, today, {
    usedDays: buildUsedDays(pet, today, usage),
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd host && node --test test/integration.test.js`
Expected: PASS (both new tests + all pre-existing integration tests, including "cross-day settlement freezes yesterday once" — that test passes `usage` without `activeDays`, so `buildUsedDays` fails open and 05-30 stays used → `streak === 1` as asserted).

- [ ] **Step 5: Run the full suite**

Run: `cd host && node --test`
Expected: Only the known environmental failure (`scripts/play-test.js` serial "Cannot lock port"); everything else passes. Ensure `host/out/` exists first (`mkdir -p host/out`) to avoid spurious ENOENT (see finding L11).

- [ ] **Step 6: Commit**

```bash
git add host/src/index.js host/test/integration.test.js
git commit -m "fix(settlement): credit offline-but-active days from ccusage history (H1)"
```

---

## Self-Review

**1. Spec coverage:**
- Root cause (one-day `closedUsageDays`) removed in Task 3. ✓
- `usedDays` now derived from real per-day usage (Task 1 surfaces it, Task 2 maps it, Task 3 wires it). ✓
- Fail-open for unavailable history and pre-history days (global constraint) — Task 2 `buildUsedDays` both branches, tested. ✓
- In-progress last-growth-day still counted (preserves old correct behavior) — Task 2, tested. ✓
- `settleDays` public signature unchanged; existing tests still pass — Task 2 refactor is behavior-preserving. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every step has concrete code/commands/expected output. ✓

**3. Type consistency:** `activeDays: string[]` produced in Task 1, consumed as `usage.activeDays` in Task 2 `activeDaysFromUsage`; `buildUsedDays`/`settlementWindow` names identical across Tasks 2 and 3; `settleDays` signature unchanged. ✓

## Open Design Question (flag for reviewer)

Fail-open for days *before* ccusage's earliest record is deliberately generous: if ccusage retention is shorter than `maxCatchupDays` (30), older window days never decay. In practice ccusage retains well beyond 30 days, so the window is normally fully covered by real activity. Alternative (fail-closed on pre-history) would risk re-introducing false decay after a long gap. Confirm fail-open is acceptable.
