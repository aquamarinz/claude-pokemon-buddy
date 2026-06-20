# H2 — Surface Stale Rate-Limit Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop stale rate-limit percentages (the "zombie values") from being displayed identically to fresh ones, by threading the already-computed `rateStale` flag through to both the e-ink frame and the web dashboard so stale data is visibly marked.

**Architecture:** `rateStale` is already produced by `mergeUsage` (index.js) and already reaches the e-ink render `model` (it spreads `...usage`) and the dashboard's `dashboardUsage` (also spreads `...usage`). The gap is purely on the consumer side: `viewmodel.js` drops `rateStale` from its usage whitelist, and neither `layout.js` nor `app.js` renders any staleness marker. This plan adds the forward + two small display markers. No detection-logic change (the writtenAt-based 15-min staleness in `rate-limits.js` is correct as-is).

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, `@napi-rs/canvas` for the e-ink frame. No new dependencies.

## Global Constraints

- Module system: ESM (`import`/`export`).
- Test runner: `node --test` (run from `host/`). No new dependencies.
- Do NOT change `rate-limits.js` staleness detection or `mergeUsage` — `rateStale` is already correct and present on the usage object. This plan is consumer-side only.
- `layoutText(model)` is a pure, unit-tested function; new fields must be covered by `layout.test.js`.
- Non-stale frames/views MUST be byte-for-byte unchanged (markers render only when `rateStale` is truthy), so existing tests stay green.

---

## File Structure

- `host/src/web/viewmodel.js` — add `rateStale` to the usage block of `toDashboardView`. (modify)
- `host/src/render/layout.js` — `layoutText` exposes `rateNote`; `drawLeftPanel` renders it only when stale. (modify)
- `host/src/web/public/app.js` — append a stale suffix to the 5h/week chips when `usage.rateStale`. (modify)
- `host/test/viewmodel.test.js` — assert `rateStale` forwarded (true + default false). (modify)
- `host/test/layout.test.js` — assert `layoutText().rateNote` for stale / fresh / absent. (modify)

---

### Task 1: viewmodel forwards `rateStale`

**Files:**
- Modify: `host/src/web/viewmodel.js` (the `usage:` block, currently lines 22-29)
- Test: `host/test/viewmodel.test.js`

**Interfaces:**
- Consumes: `usage.rateStale` (boolean-ish, present on the merged usage object; may be `undefined` when no runtime yet).
- Produces: `toDashboardView(...).usage.rateStale: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `host/test/viewmodel.test.js`:

```js
test("forwards rateStale into the dashboard usage block", () => {
  const base = {
    pet: { species: "eevee", level: 1, exp: 0, bond: 0, mood: "happy", nature: "—", iv: [], characteristic: "—", badges: [], readyToEvolve: false },
    weather: { cond: "多云", temp: 19 },
    sensors: { roomT: null, roomH: null },
    journey: [],
    secrets: { discovered: [], total: 12 },
    config: { name: "x", quietHours: { start: 22, end: 8 }, volume: 70, lat: 0, lon: 0 },
  };

  const stale = toDashboardView({ ...base, usage: { p5h: 72, pweek: 41, rateStale: true } });
  assert.equal(stale.usage.rateStale, true);

  const fresh = toDashboardView({ ...base, usage: { p5h: 72, pweek: 41 } });
  assert.equal(fresh.usage.rateStale, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd host && node --test test/viewmodel.test.js`
Expected: FAIL — `stale.usage.rateStale` is `undefined` (field not forwarded).

- [ ] **Step 3: Write minimal implementation**

In `host/src/web/viewmodel.js`, add one line to the `usage:` block (after `modelled: usage.modelled,`):

```js
      rateStale: Boolean(usage.rateStale),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd host && node --test test/viewmodel.test.js`
Expected: PASS (existing test + the new one).

- [ ] **Step 5: Commit** — SKIP (the orchestrator commits after PM review).

---

### Task 2: e-ink `layoutText` exposes `rateNote`; `drawLeftPanel` renders it when stale

**Files:**
- Modify: `host/src/render/layout.js` (`layoutText` return object; `drawLeftPanel`)
- Test: `host/test/layout.test.js`

**Interfaces:**
- Consumes: `model.rateStale` (present on the e-ink render model via `{...usage}`).
- Produces: `layoutText(model).rateNote: string` — `"stale"` when `model.rateStale` truthy, else `""`. Mirrors the existing `weatherLabel` degraded pattern.

- [ ] **Step 1: Write the failing test**

Add to `host/test/layout.test.js`:

```js
test("layoutText flags stale rate-limit data via rateNote", () => {
  assert.equal(layoutText({ p5h: 72, pweek: 41, rateStale: true }).rateNote, "stale");
  assert.equal(layoutText({ p5h: 72, pweek: 41, rateStale: false }).rateNote, "");
  assert.equal(layoutText({ p5h: 72, pweek: 41 }).rateNote, "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd host && node --test test/layout.test.js`
Expected: FAIL — `layoutText(...).rateNote` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `host/src/render/layout.js`, inside `layoutText(...)`'s returned object, add (next to `pweek:`):

```js
    rateNote: model.rateStale ? "stale" : "",
```

Then in `drawLeftPanel(g, model)`, after the existing `g.fillText(text.resets5h, 11, 110);` line, render the note only when present (small font, in the free band below the 5H reset line; non-stale frames are unaffected because nothing draws):

```js
  if (text.rateNote) {
    g.font = `700 12px ${MONO}`;
    g.fillText(text.rateNote, 11, 46);
  }
```

(`MONO` and `g.font = "... ${MONO}"` are already used throughout `drawLeftPanel`. Font MUST be a 12px multiple: `layout.test.js`'s "12px grid" test statically scans every `g.font` size and rejects any non-multiple of 12 — 10px would fail it even though the draw is gated on `rateStale`. y=46 (baseline) sits between the clock divider at y=33 and the 48px percentage digit tops at ≈y=53, so it does not overlap existing glyphs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd host && node --test test/layout.test.js`
Expected: PASS (all existing layout tests + the new one).

- [ ] **Step 5: Commit** — SKIP.

---

### Task 3: dashboard marks the 5h/week chips stale

**Files:**
- Modify: `host/src/web/public/app.js` (`renderUsage`, currently lines 97-101)

**Interfaces:**
- Consumes: `usage.rateStale` (forwarded by Task 1), `usage.p5h`, `usage.pweek`.
- Produces: DOM text marked with a trailing `旧` when stale and a value is present. (Browser presentation — not covered by `node:test`; Task 1's test proves the field reaches the view.)

- [ ] **Step 1: Implement (presentation-only, no node test)**

In `host/src/web/public/app.js`, replace the two lines:

```js
  setText("usage-p5h", formatPct(usage.p5h));
  setText("usage-pweek", formatPct(usage.pweek));
```

with:

```js
  const staleSuffix = usage.rateStale ? " 旧" : "";
  setText("usage-p5h", usage.p5h == null ? formatPct(usage.p5h) : `${formatPct(usage.p5h)}${staleSuffix}`);
  setText("usage-pweek", usage.pweek == null ? formatPct(usage.pweek) : `${formatPct(usage.pweek)}${staleSuffix}`);
```

(When `usage.p5h`/`usage.pweek` is `null`, the chip already shows `--`; no suffix is appended there. The suffix appears only on a real-but-stale value.)

- [ ] **Step 2: Verify the change is well-formed**

Run: `cd host && node --check src/web/public/app.js`
Expected: exits 0 (no syntax error). (No DOM unit test exists for app.js; correctness of the field plumbing is covered by Task 1.)

- [ ] **Step 3: Commit** — SKIP.

---

## Full-suite gate (run by orchestrator, not part of a task commit)

Run: `cd host && mkdir -p out && node --test`
Expected: only the known environmental failure `scripts/play-test.js` ("Cannot lock port"); all else passes. Non-stale frames/views are unchanged (markers gated on `rateStale`), so no existing assertions move.

## Self-Review

**1. Spec coverage:**
- `rateStale` forwarded to dashboard view — Task 1 (tested). ✓
- Stale visibly marked on e-ink — Task 2 (`rateNote` tested; render gated on stale). ✓
- Stale visibly marked on dashboard — Task 3 (presentation; field arrival tested in Task 1). ✓
- No detection-logic change; producer path untouched — per Global Constraints. ✓

**2. Placeholder scan:** No TBD/“handle later”; every step has concrete code + commands + expected output. ✓

**3. Type consistency:** `rateStale` boolean produced by `mergeUsage` → forwarded by viewmodel (`Boolean(...)`) → consumed by app.js; `rateNote` string produced by `layoutText` → consumed by `drawLeftPanel`. Names consistent across tasks. ✓

## Notes for reviewer
- Confirm y=46 / small-font placement in `drawLeftPanel` does not collide with existing left-panel glyphs (clock divider y=33, 5H big number baseline y=88, "5H/WINDOW" labels at x=151).
- Confirm `formatPct(null)` renders `"--"` (so the null-guard in Task 3 is correct and no suffix leaks onto `--`).
- This is consumer-side only; `rate-limits.js`/`mergeUsage` deliberately untouched. Agree this is the right scope (vs. also reworking staleness detection)?
