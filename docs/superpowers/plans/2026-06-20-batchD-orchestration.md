# Batch D — index.js Orchestration Fixes (H4, M4, H5, M5) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Fix four `index.js` orchestration bugs:
- **H4** — KEY-to-evolve presses arriving between ticks are lost (the evolution button collector lives only during the sub-second tick body). Add a persistent button buffer drained into each tick.
- **M4** — the signature animation reads `currentModel` when the queued job runs (after a tick boundary), not when the button was pressed; capture the model at press time.
- **H5** — any error inside the tick body rejects through the `while` loop and the daemon becomes a zombie (loop dead, handles leaked) instead of continuing; wrap the loop's tick in try/catch.
- **M5** — `main` and `startDashboardServer` keep two independent `config` copies synced only by a manual mirror; make `config` a single source via `getConfig`/`setConfig`.

**Architecture:** All changes are in `host/src/index.js` (`runOneTick`, `main`, `startDashboardServer`). H4 adds a `pendingButtons` param to `runOneTick` and a persistent buffer in `main`. M4 captures `currentModel` in the signature listener. H5 wraps the loop tick. M5 passes `getConfig`/`setConfig` accessors into `startDashboardServer`, removing its private `config` and the `onSettingsSaved` mirror.

**Tech Stack:** Node.js ESM, `node:test`. No new deps.

## Global Constraints
- ESM; `node --test` from `host/`; no new deps.
- `runOneTick`'s existing standalone/test behavior (transient `onButton` collection, e.g. `mockPressingKey`) MUST keep working — `pendingButtons` is additive.
- `once` mode (CPB_ONCE) must still propagate a tick error (non-zero exit); only the long-running loop becomes resilient.
- M5 must preserve the dashboard's observable behavior (existing web tests stay green).

## Test-coverage note
- **H4** gets a dedicated `runOneTick` test (the `pendingButtons` path). **M5** is behavior-preserving and covered by the existing web/integration suite + review. **M4** and **H5** live inside `main()`'s long-running closure/loop, which has no unit-test seam today; they are verified by the independent review + full-suite no-regression + diff review. (A `main()`-loop test harness is a known test-gap, recommended as follow-up.)

---

## File Structure
- `host/src/index.js` — `runOneTick` (H4), `main` signature listener (M4), `main` loop (H5), `main`+`startDashboardServer` config (M5). (modify)
- `host/test/integration.test.js` — H4 buffered-KEY evolution test. (modify)

---

### Task 1: H4 — persistent button buffer feeds each tick

**Files:** Modify `host/src/index.js`; Test `host/test/integration.test.js`

**Interfaces:** `runOneTick({..., pendingButtons})` — new optional param: an array of `{key, kind}` events pre-collected by `main`. `runOneTick` seeds its `buttonEvents` with a copy of it (still also attaching the transient `onButton` collector for standalone/test use).

- [ ] **Step 1: Write the failing test** — add to `host/test/integration.test.js`:

```js
test("a buffered KEY-short press evolves a ready pet (H4 between-tick presses)", async () => {
  const statePath = join("out", "test-h4-buffered-key-state.json");
  const framePath = join("out", "test-h4-buffered-key-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1, hatched: true, species: "eevee", level: 1, exp: 0,
      bond: 160, streak: 0, shield: 0, lastSettled: "2026-05-30", lastGrowthDay: "2026-05-30",
      todayCreditedExp: 0, todayCreditedBond: 0, readyToEvolve: true,
      nature: "Brave", iv: [1, 2, 3, 4, 5, 6], characteristic: "Likes to run",
    }),
  );

  const state = await runOneTick({
    usage: usageWithTokens(0),
    weather: sampleWeather(),
    room: { t: 21, h: 45 },
    statePath,
    framePath,
    mock: createMockTransport({ framePath }),
    now: new Date(2026, 4, 30, 21), // night -> eevee auto-evolves to umbreon
    today: "2026-05-30",
    pendingButtons: [{ key: "KEY", kind: "short" }],
    evolutionDelay: async () => {},
  });

  assert.equal(state.species, "umbreon");
  assert.equal(state.readyToEvolve, false);
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/integration.test.js` → FAIL (`runOneTick` ignores `pendingButtons`; with the plain mock no button is collected, so `species` stays `"eevee"`, `readyToEvolve` stays `true`).

- [ ] **Step 3: Implement** — in `host/src/index.js`:

(3a) Add `pendingButtons` to the `runOneTick` destructured params (alongside `onRenderModel`):

```js
  onRenderModel,
  pendingButtons,
} = {}) {
```

(3b) Seed `buttonEvents` from `pendingButtons` (replace `const buttonEvents = [];`):

```js
  const buttonEvents = Array.isArray(pendingButtons) ? [...pendingButtons] : [];
```

(3c) In `main()`, add a persistent button buffer after `const actions = createActionQueue();`:

```js
  const buttonBuffer = [];
  const offButtonBuffer = transport.onButton?.((event) => buttonBuffer.push(event));
```

(3d) In `main()`'s `tick()`, pass the drained buffer to `runOneTick`. Change the `runOneTick({ ... })` call inside `tick()` to include:

```js
          pendingButtons: buttonBuffer.splice(0),
```

(3e) In `main()`'s `stop()`, detach the buffer listener — add after `offSignature?.();`:

```js
    offButtonBuffer?.();
```

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/integration.test.js` → PASS (new test + all existing, including the existing transient-listener evolution tests which still work because the `onButton` collector is still attached).

- [ ] **Step 5: Commit** — SKIP.

---

### Task 2: M4 — signature animates the press-time model

**Files:** Modify `host/src/index.js` (the `offSignature` listener in `main`)

**Interfaces:** none (internal closure). Review-verified (no unit-test seam in `main`).

- [ ] **Step 1: Implement** — in `host/src/index.js`, the `offSignature` listener: capture `currentModel` synchronously at press time and use the captured reference in the queued job:

```js
  const offSignature = transport.onButton?.((event) => {
    if (signaturePlaying || !currentModel || !shouldPlaySignature(event, runtime.pet)) return;
    const pressModel = currentModel; // snapshot at press time; a later tick may reassign currentModel
    signaturePlaying = true;
    actions.run(async () => {
      animator.pause();
      try { await playSignatureAnimation({ transport, model: pressModel }); }
      finally { animator.resume(); }
    }).catch(() => {}).finally(() => { signaturePlaying = false; });
  });
```

- [ ] **Step 2: Verify well-formed** — `cd host && node --check src/index.js` → exit 0. (Behavior verified by review; full-suite must stay green.)

- [ ] **Step 3: Commit** — SKIP.

---

### Task 3: H5 — the tick loop survives a failing tick

**Files:** Modify `host/src/index.js` (`main`'s tick loop)

**Interfaces:** none (internal). Review-verified.

- [ ] **Step 1: Implement** — in `host/src/index.js`, add a `runTickSafely` helper next to `tick()` (after the `async function tick() { ... }` definition):

```js
  async function runTickSafely() {
    try {
      await tick();
    } catch (error) {
      console.error("buddy tick failed; continuing:", error);
    }
  }
```

Then replace the loop bootstrap:

```js
  await tick();
  if (once) return;
  animator.start();

  while (!stopped) {
    await new Promise((resolve) => {
      timer = setTimeout(resolve, intervalMs);
    });
    if (!stopped) await tick();
  }
```

with:

```js
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
```

- [ ] **Step 2: Verify well-formed** — `cd host && node --check src/index.js` → exit 0.

- [ ] **Step 3: Commit** — SKIP.

---

### Task 4: M5 — single config source for the dashboard

**Files:** Modify `host/src/index.js` (`startDashboardServer` + `main`'s call site)

**Interfaces:** `startDashboardServer({..., getConfig, setConfig})` replaces its private `config`/`configPath`-load and the `onSettingsSaved` callback. `getConfig(): config`, `setConfig(next): void`.

- [ ] **Step 1: Implement** — in `host/src/index.js`:

(4a) Replace the `startDashboardServer` signature + body's config handling. Change the parameter list to drop `onSettingsSaved` and add `getConfig`/`setConfig`, remove `let config = loadConfig(configPath);`, and read/write config through the accessors:

```js
export function startDashboardServer({
  host = "127.0.0.1",
  port = 0,
  statePath = "out/state.json",
  configPath = "config.json",
  framePath = "out/frame.png",
  getRuntime = () => ({}),
  getConfig = () => loadConfig(configPath),
  setConfig = () => {},
} = {}) {
  return startWebServer({
    host,
    port,
    framePath,
    getView: () => {
      const config = getConfig();
      const runtime = getRuntime();
      const pet = dashboardPet(runtime.pet ?? loadState(statePath), runtime.usage);
      const view = toDashboardView({
        pet,
        usage: dashboardUsage(runtime.usage, pet),
        weather: runtime.weather ?? DEFAULT_WEATHER,
        sensors: dashboardSensors(runtime.room),
        journey: dashboardJourney(pet),
        secrets: dashboardSecrets(pet),
        config,
      });
      return {
        ...view,
        box: Array.isArray(config.box) && config.box.length > 0 ? config.box : [pet.species],
      };
    },
    saveSettings: (input) => {
      const result = validateSettings(input);
      if (!result.ok) throw new Error(result.error);
      const next = { ...getConfig(), ...result.value };
      setConfig(next);
      saveConfig(configPath, next);
      return result.value;
    },
  });
}
```

(4b) Update `main`'s call site — replace the `onSettingsSaved` option with `getConfig`/`setConfig`:

```js
  const dashboardServer = dashboard
    ? await startDashboardServer({
        host: dashboardHost,
        port: dashboardPort,
        statePath,
        configPath,
        framePath,
        getRuntime: () => runtime,
        getConfig: () => config,
        setConfig: (next) => { config = next; },
      })
    : null;
```

- [ ] **Step 2: Verify well-formed + no regression** — `cd host && node --check src/index.js` → exit 0; then the full suite (next section) must stay green (web-server / web-integration tests cover the dashboard view + save path).

- [ ] **Step 3: Commit** — SKIP.

---

## Full-suite gate (orchestrator)
`cd host && mkdir -p out && node --test --test-concurrency=1` → only `scripts/play-test.js` fails; everything else (incl. web + integration + evolution-trigger) green.

## Self-Review
1. Spec coverage: H4 buffer (Task 1, tested), M4 press-time model (Task 2), H5 loop resilience (Task 3), M5 single config (Task 4). ✓
2. Placeholder scan: concrete code/commands. ✓
3. Type consistency: `pendingButtons` array of `{key,kind}`; `buttonBuffer.splice(0)` returns array; `getConfig`/`setConfig` accessors; `runTickSafely` async. ✓

## Notes for reviewer
- H4: confirm the existing `mockPressingKey`-based evolution tests still pass (transient `onButton` collector retained; `pendingButtons` is additive). Confirm `buttonBuffer.splice(0)` drains+clears so a press is consumed exactly once. Confirm no double-evolution (signature handler ignores KEY when `readyToEvolve`, evolution path only fires when `readyToEvolve`).
- M4: confirm `pressModel` capture doesn't change the guard semantics; `currentModel` non-null checked before capture.
- H5: confirm `once` mode still propagates errors (exit code) and loop mode swallows+continues; confirm `runTickSafely` is defined before first use.
- M5: confirm `startDashboardServer` default `getConfig`/`setConfig` keep standalone behavior; confirm no remaining reference to the removed `onSettingsSaved`; confirm `saveSettings` still persists via `saveConfig` and updates `main`'s `config` through `setConfig` so the next tick sees new settings. Confirm existing web tests still pass.
