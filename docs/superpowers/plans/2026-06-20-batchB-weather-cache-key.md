# Batch B — Weather Cache Keyed by Location (N1) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Fix N1 — `makeWeather().get(lat, lon)` returns the cached reading regardless of coordinates, so changing the configured location shows the *old location's* weather for up to the 30-min TTL.

**Architecture:** Add a `lastKey = "${lat},${lon}"` to the closure; a cache hit now requires both the key to match AND the TTL to be unexpired. A coordinate change is a cache miss → refetch.

**Tech Stack:** Node.js ESM, `node:test`. No new deps.

## Global Constraints
- ESM; `node --test` from `host/`; no new deps.
- Preserve existing behavior: same-coords within TTL still serves cache; `ttlMs:0` still refetches every call (existing fetch-fail test relies on this).

---

## File Structure
- `host/src/weather.js` — key the cache by lat/lon. (modify)
- `host/test/weather.test.js` — assert location change refetches; same coords cached. (modify)

---

### Task 1: Cache keyed by (lat, lon)

**Files:** Modify `host/src/weather.js`; Test `host/test/weather.test.js`

**Interfaces:** `makeWeather({fetch, ttlMs}).get(lat, lon)` — unchanged signature/return; cache now also discriminates on coordinates.

- [ ] **Step 1: Write the failing test** — add to `host/test/weather.test.js`:

```js
test("weather cache is keyed by lat/lon (location change refetches)", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        current: { temperature_2m: 19, apparent_temperature: 17, relative_humidity_2m: 64, weather_code: 3, wind_speed_10m: 11 },
        daily: { temperature_2m_max: [22], temperature_2m_min: [14], precipitation_probability_max: [30] },
      }),
    };
  };

  const w = makeWeather({ fetch: fakeFetch }); // default 30-min TTL
  await w.get(1, 2);
  await w.get(1, 2); // same coords within TTL -> cached, no refetch
  assert.equal(calls, 1);
  await w.get(3, 4); // different coords -> refetch
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/weather.test.js` → FAIL (`calls === 1` after the `(3,4)` call, because the cache ignores coordinates).

- [ ] **Step 3: Implement** — in `host/src/weather.js`, update `makeWeather`:

```js
export function makeWeather({ fetch = globalThis.fetch, ttlMs = 30 * 60 * 1000 } = {}) {
  let last = null;
  let lastAt = 0;
  let lastKey = null;

  return {
    async get(lat, lon) {
      const now = Date.now();
      const key = `${lat},${lon}`;
      if (last && key === lastKey && now - lastAt < ttlMs) return { ...last, degraded: false };

      try {
        const response = await fetch(weatherUrl(lat, lon));
        if (!response.ok) throw new Error("weather request failed");

        const json = await response.json();
        last = normalizeWeather(json);
        lastAt = now;
        lastKey = key;
        return { ...last, degraded: false };
      } catch {
        return last ? { ...last, degraded: true } : { cond: "—", temp: null, degraded: true };
      }
    },
  };
}
```

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/weather.test.js` → PASS (new test + both existing tests; the `ttlMs:0` fetch-fail test still refetches because `now - lastAt < 0` is false).

- [ ] **Step 5: Commit** — SKIP (orchestrator).

---

## Full-suite gate (orchestrator)
`cd host && mkdir -p out && node --test --test-concurrency=1` → only `scripts/play-test.js` fails.

## Self-Review
1. Spec coverage: N1 cache-by-location — Task 1 (tested). ✓
2. Placeholder scan: concrete code/commands. ✓
3. Type consistency: `lastKey` string; `get` return shape unchanged. ✓
- Existing "on fetch fail returns last-known degraded" test: `ttlMs:0`, same coords (0,0) — key matches but `now-lastAt<0` is false → refetch → throws → returns last w/ degraded:true. Behavior preserved. ✓
