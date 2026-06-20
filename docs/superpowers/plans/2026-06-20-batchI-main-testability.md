# Batch I — main() Testability: runTickLoop extraction + DI, covering H4/H5 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Close the last test-gap from the multi-agent review: `main()`'s orchestration glue (H4 between-tick button buffering, H5 loop-survives-a-throwing-tick) has no automated coverage because `main()` runs an infinite loop and hard-wires its external deps. Add minimal, idiomatic dependency injection + extract the loop into a testable `runTickLoop`, then cover H5 (unit) and H4 (via once-mode `main()`).

**Architecture:** In `host/src/index.js`: (1) extract an exported pure `runTickLoop({ runTick, intervalMs, isStopped, beforeLoop, setTimer, onError })` and have `main()` use it (behavior-preserving). (2) Add injectable deps to `main()` with production defaults — `transport`, `weatherClient`, `pollUsage`. No existing test imports `main()`, so the refactor's only contract is preserving runtime behavior (verified by review + the new tests).

**Tech Stack:** Node.js ESM, `node:test`. No new deps.

## Global Constraints
- ESM; `node --test` from `host/`; no new deps.
- Behavior-preserving: production defaults reproduce today's exact behavior (transport=`createTransport`, weatherClient=`makeWeather()`, pollUsage=`pollUsageOnce`); `runTickLoop` preserves order (first tick → `animator.start()` → interval loop) and `timer` cleanup.
- `runOneTick` is untouched.

---

## File Structure
- `host/src/index.js` — export `runTickLoop`; `main()` DI + loop via `runTickLoop`. (modify)
- `host/test/main-orchestration.test.js` — H5 `runTickLoop` unit test + H4 once-mode buffer test. (create)

---

### Task 1: Extract `runTickLoop` and wire `main()` DI

**Files:** Modify `host/src/index.js`

**Interfaces:**
- Produces: `export async function runTickLoop({ runTick, intervalMs, isStopped, beforeLoop?, setTimer?, onError? })` — runs one tick (error-swallowed), calls `beforeLoop()`, then loops `sleep(intervalMs)`+tick (error-swallowed) until `isStopped()`.
- `main(opts)` gains optional `transport`, `weatherClient`, `pollUsage` (production defaults).

- [ ] **Step 1: Add the exported `runTickLoop`** — in `host/src/index.js`, add (e.g. right after `main`):

```js
export async function runTickLoop({
  runTick,
  intervalMs,
  isStopped,
  beforeLoop = () => {},
  setTimer = (resolve, ms) => setTimeout(resolve, ms),
  onError = (error) => console.error("buddy tick failed; continuing:", error),
}) {
  const safe = async () => {
    try {
      await runTick();
    } catch (error) {
      onError(error);
    }
  };

  await safe();
  beforeLoop();
  while (!isStopped()) {
    await new Promise((resolve) => setTimer(resolve, intervalMs));
    if (!isStopped()) await safe();
  }
}
```

- [ ] **Step 2: Wire `main()` DI** — change the `main` destructured params to add the three injectables (place alongside the existing ones):

```js
export async function main({
  once = process.env.CPB_ONCE === "1",
  intervalMs = Number(process.env.CPB_INTERVAL_MS ?? 60_000),
  configPath = "config.json",
  statePath = "out/state.json",
  framePath = "out/frame.png",
  usageRun,
  dashboard = process.env.CPB_DASHBOARD !== "0" && !once,
  dashboardHost = "127.0.0.1",
  dashboardPort = Number(process.env.CPB_DASHBOARD_PORT ?? 8765),
  transport: injectedTransport,
  weatherClient: injectedWeatherClient,
  pollUsage = pollUsageOnce,
} = {}) {
```

Then replace the two hard-wired constructions:
- `const transport = await createTransport({ framePath });` → `const transport = injectedTransport ?? await createTransport({ framePath });`
- `const weatherClient = makeWeather();` → `const weatherClient = injectedWeatherClient ?? makeWeather();`

And in `tick()`, replace `await pollUsageOnce().catch(() => {});` → `await pollUsage().catch(() => {});`

- [ ] **Step 3: Replace the loop tail with `runTickLoop`** — replace the current block:

```js
  async function runTickSafely() {
    try {
      await tick();
    } catch (error) {
      console.error("buddy tick failed; continuing:", error);
    }
  }

  if (once) {
    await tick(); // once mode: let errors propagate to the exit code
    return;
  }

  await runTickSafely();
  animator.start();

  while (!stopped) {
    await new Promise((resolve) => {
      timer = setTimeout(resolve, intervalMs);
    });
    if (!stopped) await runTickSafely();
  }
}
```

with:

```js
  if (once) {
    await tick(); // once mode: let errors propagate to the exit code
    return;
  }

  await runTickLoop({
    runTick: tick,
    intervalMs,
    isStopped: () => stopped,
    beforeLoop: () => animator.start(),
    setTimer: (resolve, ms) => { timer = setTimeout(resolve, ms); },
  });
}
```

(Order preserved: first tick error-swallowed → `animator.start()` → interval loop; `timer` is still assigned via `setTimer` so `stop()`'s `clearTimeout(timer)` works.)

- [ ] **Step 4: Verify well-formed + no regression** — `cd host && node --check src/index.js` → exit 0; then the full suite (final section) stays green. (No existing test imports `main`; `runOneTick` untouched.)

- [ ] **Step 5: Commit** — SKIP.

---

### Task 2: H5 — `runTickLoop` survives a throwing tick (unit test)

**Files:** Create `host/test/main-orchestration.test.js`

- [ ] **Step 1: Write the test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";

import { main, runTickLoop } from "../src/index.js";

test("runTickLoop runs the first tick, survives a throwing tick, and stops when asked (H5)", async () => {
  const calls = [];
  let n = 0;
  let started = false;
  await runTickLoop({
    runTick: async () => {
      n += 1;
      calls.push(n);
      if (n === 2) throw new Error("boom"); // a failing tick must NOT kill the loop
    },
    intervalMs: 0,
    isStopped: () => n >= 3,
    beforeLoop: () => { started = true; },
    setTimer: (resolve) => resolve(), // no real delay
  });

  assert.deepEqual(calls, [1, 2, 3]); // tick 2 threw but the loop continued to tick 3
  assert.equal(started, true);        // beforeLoop ran after the first tick
});
```

- [ ] **Step 2: Run, verify pass** — `cd host && node --test test/main-orchestration.test.js` → PASS. (This fails to even import before Task 1 exports `runTickLoop`; with Task 1 it passes.)

- [ ] **Step 3: Commit** — SKIP.

---

### Task 3: H4 — a between-tick button is buffered and drained into the tick (via once-mode `main()`)

**Files:** `host/test/main-orchestration.test.js` (add to the file from Task 2)

**Interfaces:** drives `main({ once:true, transport, weatherClient, pollUsage, usageRun, dashboard:false })` with a mock transport that delivers a `KEY long` to each `onButton` subscriber on subscribe (simulating a press that arrived before the tick). Asserts the pet's `careCount` became 1 — proving `main()`'s `buttonBuffer` captured it and the tick drained it into `runOneTick` (which, per M7, records care on KEY-long).

- [ ] **Step 1: Add the test + helpers** (uses the ccusage fixtures already in `test/fixtures/`):

```js
const blocksJson = readFileSync(new URL("./fixtures/ccusage-blocks.json", import.meta.url), "utf8");
const dailyJson = readFileSync(new URL("./fixtures/ccusage-daily.json", import.meta.url), "utf8");

function createBitmapMockTransport({ buttonsOnSubscribe = [] } = {}) {
  const emitter = new EventEmitter();
  return {
    onButton(callback) {
      emitter.on("button", callback);
      for (const b of buttonsOnSubscribe) callback(b); // deliver pre-arrived presses on subscribe
      return () => emitter.off("button", callback);
    },
    async push() { return { ok: true }; },
    feedSensor() { return { t: 23, h: 56 }; },
    playSound() {},
    setActiveCry() {},
    close() {},
  };
}

test("a button that arrived before the tick is buffered and drained into the tick (H4 via main once-mode)", async () => {
  mkdirSync("out", { recursive: true });
  const statePath = join("out", "test-main-h4-state.json");
  const framePath = join("out", "test-main-h4-frame.png");
  const configPath = join("out", "test-main-h4-config.json");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(configPath, { force: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1, hatched: true, species: "eevee", level: 1, exp: 0,
      bond: 0, streak: 0, shield: 0, lastSettled: "2026-05-30", lastGrowthDay: "2026-05-30",
      todayCreditedExp: 0, todayCreditedBond: 0,
      nature: "Brave", iv: [1, 2, 3, 4, 5, 6], characteristic: "Likes to run",
    }),
  );

  await main({
    once: true,
    dashboard: false,
    statePath,
    framePath,
    configPath,
    transport: createBitmapMockTransport({ buttonsOnSubscribe: [{ key: "KEY", kind: "long" }] }),
    weatherClient: { get: async () => ({ cond: "多云", temp: 19, feels: 17, hi: 22, lo: 14, precip: 30, wind: 11, humidity: 64, degraded: false }) },
    pollUsage: async () => ({ ok: true, skipped: true }),
    usageRun: async (_command, args) => (args.includes("daily") ? dailyJson : blocksJson),
  });

  const state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(state.careCount, 1); // buffered KEY-long was drained into runOneTick -> care recorded
});
```

- [ ] **Step 2: Run, verify pass** — `cd host && mkdir -p out && node --test test/main-orchestration.test.js` → PASS (both tests).

- [ ] **Step 3: Commit** — SKIP.

---

## Full-suite gate (orchestrator)
`cd host && mkdir -p out && node --test --test-concurrency=1` → only `scripts/play-test.js` fails; everything else green (the refactor is behavior-preserving; new file adds 2 passing tests).

## Self-Review
1. Spec coverage: H5 loop-survival (Task 2, runTickLoop unit); H4 buffer drain (Task 3, once-mode main). H5 once-mode propagation stays as-is (`if (once) await tick()`), already correct. ✓
2. Placeholder scan: concrete code/commands. ✓
3. Type consistency: `runTickLoop` async; DI params default to production fns; `setTimer(resolve, ms)`. ✓

## Notes for reviewer
- Confirm the `runTickLoop` extraction preserves runtime order + `timer` cleanup (so `stop()`'s `clearTimeout(timer)` still cancels a pending interval).
- Confirm DI defaults reproduce production exactly (no behavior change when params omitted) and that `await createTransport` can't be a param default (must resolve in body via `?? await`).
- Confirm the H4 test path: once-mode `main()` with hatched state skips onboarding; buffer+signature listeners subscribe; the on-subscribe KEY-long is buffered (signature ignores non-short); the single tick drains it → `runOneTick` records `careCount` (M7). Confirm `loadUsageSnapshot({...config, run: usageRun})` consumes the fixture and `loadWeatherSnapshot` accepts the stubbed weather (temp != null, cond != "—").
- Confirm no existing test imports `main` (so the refactor breaks nothing) and `runOneTick` is untouched.
