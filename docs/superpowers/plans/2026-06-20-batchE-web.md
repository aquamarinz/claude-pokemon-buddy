# Batch E — Dashboard Web Fixes (M3, M10, L1, L10) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:**
- **M3** — blank numeric inputs become `0` (`Number("")===0`), so a never-set lat/lon is silently saved as `0,0` (Gulf of Guinea) and weather is fetched there. Make empty inputs omit the field instead.
- **M10** — `setText`/`setInput` throw on the first missing element, aborting the whole render and mislabeling it as a fetch failure. Null-guard the DOM setters.
- **L1** — the 5s poll overwrites settings fields the user is editing. Skip `renderSettings` while the settings form has focus.
- **L10** — an empty POST body validates to `{}` → a no-op disk write + a misleading `200 {ok:true}`. Reject an empty settings payload with `400`.

**Architecture:** M3/M10/L1 are in `host/src/web/public/app.js` (browser; verified by `node --check` + review — the repo has no DOM unit-test harness). L10 is in `host/src/web/server.js` and is unit-tested via `web-server.test.js`.

**Tech Stack:** Node.js ESM (server), browser JS (app.js), `node:test`. No new deps.

## Global Constraints
- ESM; `node --test` from `host/`; no new deps.
- `validateSettings` supports partial updates via `"key" in input` and requires `quietHours` to carry BOTH valid `start` and `end`. M3's body builder must omit `quietHours` unless both are present.
- Non-empty saves must keep working (existing `web-integration.test.js` POSTs a full object).

---

## File Structure
- `host/src/web/public/app.js` — `numberOf` + a `buildSettingsBody` helper (M3); `setText`/`setInput` guards (M10); `renderSettings` focus guard (L1). (modify)
- `host/src/web/server.js` — reject empty validated settings (L10). (modify)
- `host/test/web-server.test.js` — empty-body POST → 400 (L10). (modify)

---

### Task 1: L10 — reject empty settings payloads (TESTABLE)

**Files:** Modify `host/src/web/server.js`; Test `host/test/web-server.test.js`

**Interfaces:** `POST /api/settings` with a body that validates to `{}` now returns `400 {error:"no settings provided"}` and does NOT call `saveSettings`.

- [ ] **Step 1: Write the failing test** — add to `host/test/web-server.test.js` (follow the existing test's server-start + fetch pattern; if a helper exists, reuse it). Representative test:

```js
test("POST /api/settings with an empty body is rejected and does not save", async () => {
  let saved = 0;
  const handle = await startWebServer({
    port: 0,
    getView: () => ({}),
    saveSettings: () => { saved += 1; },
  });
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /no settings/i);
    assert.equal(saved, 0);
  } finally {
    await handle.close();
  }
});
```
(If `web-server.test.js` already imports `startWebServer` and has a fetch helper, use those; match the file's existing style for starting/closing the server.)

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/web-server.test.js` → FAIL (current code returns `200 {ok:true,settings:{}}` and calls `saveSettings`).

- [ ] **Step 3: Implement** — in `host/src/web/server.js` `routeRequest`, after the `if (!result.ok)` block and before `await context.saveSettings(...)`:

```js
    if (Object.keys(result.value).length === 0) {
      respondJson(res, 400, { error: "no settings provided" });
      return;
    }
```

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/web-server.test.js` → PASS (new test + existing).

- [ ] **Step 5: Commit** — SKIP.

---

### Task 2: M3 — blank numeric inputs omit the field (browser; node --check)

**Files:** Modify `host/src/web/public/app.js`

**Interfaces:** `numberOf(id)` returns `undefined` for a blank/non-finite input; the submit handler builds the POST body from only the filled fields via a new `buildSettingsBody()`.

- [ ] **Step 1: Implement** — in `host/src/web/public/app.js`:

(2a) Replace `numberOf`:

```js
function numberOf(id) {
  const raw = document.getElementById(id).value;
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
```

(2b) Add a `buildSettingsBody` helper (near `valueOf`/`numberOf`):

```js
function buildSettingsBody() {
  const body = {};
  const name = valueOf("settings-name").trim();
  if (name !== "") body.name = name;
  const start = numberOf("quiet-start");
  const end = numberOf("quiet-end");
  if (start !== undefined && end !== undefined) body.quietHours = { start, end };
  const volume = numberOf("settings-volume");
  if (volume !== undefined) body.volume = volume;
  const lat = numberOf("settings-lat");
  if (lat !== undefined) body.lat = lat;
  const lon = numberOf("settings-lon");
  if (lon !== undefined) body.lon = lon;
  return body;
}
```

(2c) Replace the `const body = { ... }` literal in the submit handler with a call + empty guard:

```js
    const body = buildSettingsBody();
    if (Object.keys(body).length === 0) {
      setStatus("没有要保存的更改", true);
      return;
    }
```

- [ ] **Step 2: Verify well-formed** — `cd host && node --check src/web/public/app.js` → exit 0. (Behavior: blank lat/lon → omitted → server keeps existing value, never saves 0,0.)

- [ ] **Step 3: Commit** — SKIP.

---

### Task 3: M10 — null-guard the DOM setters (browser; node --check)

**Files:** Modify `host/src/web/public/app.js`

**Interfaces:** `setText`/`setInput` no-op on a missing element instead of throwing.

- [ ] **Step 1: Implement** — replace both:

```js
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setInput(id, value) {
  const input = document.getElementById(id);
  if (input && document.activeElement !== input) input.value = value;
}
```

- [ ] **Step 2: Verify well-formed** — `cd host && node --check src/web/public/app.js` → exit 0.

- [ ] **Step 3: Commit** — SKIP.

---

### Task 4: L1 — don't clobber the settings form while editing (browser; node --check)

**Files:** Modify `host/src/web/public/app.js`

**Interfaces:** `renderSettings` early-returns while the settings form holds focus.

- [ ] **Step 1: Implement** — at the top of `renderSettings`:

```js
function renderSettings(settings) {
  if (form.contains(document.activeElement)) return; // don't overwrite an in-progress edit
  setInput("settings-name", settings.name ?? "");
  setInput("quiet-start", settings.quietHours?.start ?? "");
  setInput("quiet-end", settings.quietHours?.end ?? "");
  setInput("settings-volume", settings.volume ?? 0);
  volumeValue.textContent = String(settings.volume ?? 0);
  setInput("settings-lat", settings.lat ?? "");
  setInput("settings-lon", settings.lon ?? "");
}
```

(`form` is the module-level `const form` used by the submit listener.)

- [ ] **Step 2: Verify well-formed** — `cd host && node --check src/web/public/app.js` → exit 0.

- [ ] **Step 3: Commit** — SKIP.

---

## Full-suite gate (orchestrator)
`cd host && mkdir -p out && node --test --test-concurrency=1` → only `scripts/play-test.js` fails; web-server + web-integration green.

## Self-Review
1. Spec coverage: M3 (Task 2), M10 (Task 3), L1 (Task 4), L10 (Task 1, tested). ✓
2. Placeholder scan: concrete code/commands. ✓
3. Type consistency: `numberOf` → number|undefined; `buildSettingsBody` → object; setters no-op on null; L10 guard on `Object.keys(result.value).length`. ✓

## Notes for reviewer
- M3: confirm `valueOf("settings-name")` won't throw (the field exists in index.html) and that omitting an empty `name` is correct (validateSettings rejects empty name anyway, so omission preserves the existing name). Confirm `quietHours` only sent when BOTH start+end present (validateSettings requires both).
- L10: confirm rejecting `{}` doesn't break the M3-fixed frontend (it now guards empty client-side too) nor `web-integration.test.js` (posts a full object). Confirm `web-server.test.js` import/start/fetch pattern matches the new test.
- M10/L1: browser-only; confirm `form` and `volumeValue` are module-level and in scope for `renderSettings`.
