# Batch G — Review Remediation (H3 re-entrancy, M8 stale-callback, M5 false-green) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Context:** The multi-agent review of the 26 committed fix-commits found everything functionally correct + regression-free, with two source-hardening items (empirically reproduced) and one false-green test:
- **H3 re-entrancy (medium, latent):** the H3 fix reordered `rx = rx.slice(frameLen)` to AFTER `handleFrame`, so a synchronous re-entrant listener re-processes the same frame (double-dispatch). Restore consume-before-dispatch while keeping byte-wise resync.
- **M8 stale-callback (low):** the fire-and-forget write callbacks lack a port-identity guard, so a deferred write error from an old port can disconnect a freshly reconnected port.
- **M5 false-green (test-only):** `web-integration.test.js` exercises `startDashboardServer`'s disk-backed defaults, not `main()`'s `getConfig/setConfig` in-memory closures, so M5's actual mechanism is unverified.

**Architecture:** Source changes in `host/src/transport/serial.js` (H3, M8). Tests in `host/test/serial.test.js` (H3 re-entrancy + discriminating resync; M8 deferred-callback) and `host/test/web-integration.test.js` (M5 closure round-trip).

**Tech Stack:** Node.js ESM, `node:test`. No new deps.

## Global Constraints
- ESM; `node --test` from `host/`; no new deps.
- H3 reorder must keep ALL existing serial behavior (happy-path parse, ACK/queue/reconnect, the two H3 resync tests) and still advance exactly one byte past a bad-CRC MAGIC.
- M8 guard must not break the existing "setActiveCry writes a CONFIG frame" / M8 reconnect tests.

## Accepted follow-up gap (not in this batch)
H4 between-tick `buttonBuffer` drain and H5 `runTickSafely` loop-survival remain without `main()`-level integration tests — `main()` runs an infinite loop and would need a loop-body extraction to test cleanly. Both were confirmed correct by the independent review on inspection; deferred as a test-harness follow-up rather than refactoring correct production code speculatively.

---

## File Structure
- `host/src/transport/serial.js` — `readAvailableFrames` reorder (H3); `playSound`/`setActiveCry` port-identity guard (M8). (modify)
- `host/test/serial.test.js` — re-entrancy regression test + discriminating resync test (H3); deferred-callback test (M8). (modify)
- `host/test/web-integration.test.js` — M5 getConfig/setConfig closure round-trip test. (modify)

---

### Task 1: H3 — consume-before-dispatch (kills re-entrant double-dispatch)

**Files:** Modify `host/src/transport/serial.js`; Test `host/test/serial.test.js`

- [ ] **Step 1: Write the failing test** — add to `host/test/serial.test.js`:

```js
test("a synchronous re-entrant listener does not double-dispatch a frame (H3 invariant)", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  const buttons = [];
  let reentered = false;
  transport.onButton((e) => {
    buttons.push(e);
    if (!reentered) {
      reentered = true;
      // deliver a second, distinct frame synchronously from inside the listener
      port.emitData(encodeFrame({ type: T.BUTTON, seq: 11, payload: Uint8Array.from([2, 2]) }));
    }
  });

  port.emitData(encodeFrame({ type: T.BUTTON, seq: 9, payload: Uint8Array.from([1, 1]) }));

  assert.deepEqual(buttons, [{ key: "KEY", kind: "short" }, { key: "BOOT", kind: "long" }]);
  transport.close();
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/serial.test.js` → FAIL: current code consumes after dispatch, so the re-entrant `readAvailableFrames` re-processes frame 1 → `buttons` has `{KEY,short}` twice (length 3).

- [ ] **Step 3: Implement** — in `host/src/transport/serial.js`, replace the decode/dispatch block in `readAvailableFrames`:

```js
      const frameBytes = rx.slice(0, frameLen);
      try {
        handleFrame(decodeFrame(frameBytes));
        rx = rx.slice(frameLen);
      } catch {
        // Bad CRC / corrupt -> advance one byte and resync to the next MAGIC.
        rx = rx.slice(1);
      }
```

with (decode in try; on failure resync 1 byte; on success consume BEFORE dispatch):

```js
      const frameBytes = rx.slice(0, frameLen);
      let frame;
      try {
        frame = decodeFrame(frameBytes);
      } catch {
        // Bad CRC / corrupt -> advance one byte and resync to the next MAGIC.
        rx = rx.slice(1);
        continue;
      }
      rx = rx.slice(frameLen); // consume BEFORE dispatch so a re-entrant read can't re-process this frame
      handleFrame(frame);
```

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/serial.test.js` → PASS (new test + the two existing H3 resync tests + all others; bad-CRC still slices 1 byte, happy-path consumes frameLen).

- [ ] **Step 5: Commit** — SKIP.

---

### Task 2: H3 — discriminating byte-resync test (pins resync vs whole-frame-skip)

**Files:** Test `host/test/serial.test.js`

- [ ] **Step 1: Add the test** (passes on the post-Task-1 code; would fail under a whole-frame-skip implementation):

```js
test("RX resyncs byte-wise past a frame with a corrupt length field (H3)", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  const buttons = [];
  transport.onButton((e) => buttons.push(e));

  // valid BUTTON frame, but corrupt the LENGTH byte to a wrong-but-small value (magic intact, len<=512)
  const corrupt = Uint8Array.from(encodeFrame({ type: T.BUTTON, seq: 9, payload: Uint8Array.from([1, 1]) }));
  corrupt[3] = 3; // real len is 2; a whole-frame skip would mis-align by len -> swallow the next frame
  port.emitData(corrupt);
  port.emitData(encodeFrame({ type: T.BUTTON, seq: 10, payload: Uint8Array.from([2, 2]) }));

  // the corrupt frame fails CRC; byte-wise resync recovers the following valid frame
  assert.deepEqual(buttons, [{ key: "BOOT", kind: "long" }]);
  transport.close();
});
```

- [ ] **Step 2: Run, verify pass** — `cd host && node --test test/serial.test.js` → PASS. (If it does not, the corrupt bytes happened to embed a spurious valid frame — adjust the corrupt payload, keeping the assertion that the SECOND frame is delivered exactly once.)

- [ ] **Step 3: Commit** — SKIP.

---

### Task 3: M8 — port-identity guard on fire-and-forget writes

**Files:** Modify `host/src/transport/serial.js`; Test `host/test/serial.test.js`

- [ ] **Step 1: Write the failing test** — add to `host/test/serial.test.js`:

```js
test("a deferred write error from an old port does not disconnect the reconnected port (M8 stale-callback)", async () => {
  const deferred = [];
  const port1 = new FakePort();
  // port1 defers its write callback instead of firing it synchronously
  port1.write = function write(bytes, callback) {
    this.writes.push(Uint8Array.from(bytes));
    if (callback) deferred.push(() => callback(new Error("late write error")));
    return true;
  };
  const port2 = new FakePort();
  let attempts = 0;
  const transport = makeTransport({
    port: port1,
    openPort: async () => { attempts += 1; return port2; },
    reconnectDelayMs: 5,
    timeoutMs: 50,
    maxRetries: 0,
  });

  transport.playSound(2);           // write deferred on port1
  port1.emitClose();                // disconnect -> reconnect to port2
  await waitFor(() => attempts === 1 && port2.listenerCount("data") > 0);

  deferred.forEach((fn) => fn());   // now fire the STALE port1 callback with an error

  // port2 must still be connected: a pushFrame writes to port2 and ACKs normally
  const sent = transport.pushFrame(Uint8Array.from([1]));
  assert.equal(port2.writes.length, 1);
  const frame = decodeFrame(port2.writes[0]);
  port2.emitData(encodeFrame({ type: T.ACK, seq: frame.seq, payload: Uint8Array.from([frame.seq]) }));
  assert.deepEqual(await sent, { ok: true, seq: 0 });
  transport.close();
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/serial.test.js` → FAIL: the stale callback (bare `if (error) handleDisconnect()`) tears down the reconnected port2, so `port2.writes.length === 0` and `sent` resolves `{ok:false,disconnected:true}`.

- [ ] **Step 3: Implement** — in `host/src/transport/serial.js`, update both fire-and-forget senders to capture the port and guard the callback:

```js
    playSound(soundId) {
      if (!connected) return;
      // Fire-and-forget: device doesn't ACK PLAY. Surface an async write error to the
      // reconnect path, but only if it's still THIS port (a stale callback from an old
      // port must not tear down a reconnected session).
      const writePort = currentPort;
      try {
        writePort.write(
          encodeFrame({ type: T.PLAY, seq: 0, payload: Uint8Array.from([soundId & 0xff]) }),
          (error) => { if (error && writePort === currentPort && connected) handleDisconnect(); },
        );
      } catch {
        handleDisconnect();
      }
    },
    setActiveCry(soundId) {
      if (!connected) return;
      const writePort = currentPort;
      try {
        writePort.write(
          encodeFrame({ type: T.CONFIG, seq: 0, payload: Uint8Array.from([soundId & 0xff]) }),
          (error) => { if (error && writePort === currentPort && connected) handleDisconnect(); },
        );
      } catch {
        handleDisconnect();
      }
    },
```

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/serial.test.js` → PASS (new test + the existing M8 reconnect tests + "setActiveCry writes a CONFIG frame": the synchronous-callback FakePort fires `callback(null)` with `writePort===currentPort` → no disconnect; the existing M8 write-error tests fire synchronously before any reconnect so `writePort===currentPort` holds → still reconnect).

- [ ] **Step 5: Commit** — SKIP.

---

### Task 4: M5 — verify the getConfig/setConfig in-memory closure (fix the false-green)

**Files:** Test `host/test/web-integration.test.js`

**Interfaces:** exercises `startDashboardServer({getConfig, setConfig})` the way `main()` wires it, asserting the in-memory object updates on save (not just the disk file).

- [ ] **Step 1: Add the test** — add to `host/test/web-integration.test.js` (reuse its existing import of `startDashboardServer` and temp-path/fetch/close helpers; representative form):

```js
test("dashboard reads and writes config through main()'s in-memory closures (M5)", async () => {
  const configPath = join("out", "test-m5-config.json");
  const statePath = join("out", "test-m5-state.json");
  const framePath = join("out", "test-m5-frame.png");
  rmSync(configPath, { force: true });
  rmSync(statePath, { force: true });

  let config = { name: "old", quietHours: { start: 22, end: 8 }, volume: 50, lat: 1, lon: 2 };
  const handle = await startDashboardServer({
    port: 0,
    statePath,
    configPath,
    framePath,
    getRuntime: () => ({}),
    getConfig: () => config,
    setConfig: (next) => { config = next; },
  });

  try {
    const before = await (await fetch(`http://127.0.0.1:${handle.port}/api/state`)).json();
    assert.equal(before.settings.name, "old");

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "new" }),
    });
    assert.equal(res.status, 200);

    // the in-memory object main()'s next tick reads is updated (not just the disk file)
    assert.equal(config.name, "new");

    const after = await (await fetch(`http://127.0.0.1:${handle.port}/api/state`)).json();
    assert.equal(after.settings.name, "new");
  } finally {
    await handle.close();
  }
});
```
(If `web-integration.test.js` lacks `rmSync`/`join` imports, add them; match the file's existing server-start/fetch/close style.)

- [ ] **Step 2: Run, verify it passes** — `cd host && mkdir -p out && node --test test/web-integration.test.js` → PASS, proving `getConfig`/`setConfig` are wired (GET reads the closure, POST mutates the in-memory object via `setConfig`). This converts the prior disk-only ("false-green") coverage into real closure coverage.

- [ ] **Step 3: Commit** — SKIP.

---

## Full-suite gate (orchestrator)
`cd host && mkdir -p out && node --test --test-concurrency=1` → only `scripts/play-test.js` fails.

## Self-Review
1. Spec coverage: H3 reorder + re-entrancy test (Task 1) + discriminating resync (Task 2); M8 guard + deferred-callback test (Task 3); M5 closure coverage (Task 4). ✓
2. Placeholder scan: concrete code/commands. ✓
3. Type consistency: `frame` decoded then dispatched; `writePort` captured const; M5 closures `getConfig`/`setConfig`. ✓

## Notes for reviewer
- Task 1: confirm the reorder still resyncs 1 byte on bad CRC (the `continue` after `rx.slice(1)`), still consumes `frameLen` on success BEFORE `handleFrame`, and the two existing H3 tests stay green.
- Task 3: confirm the synchronous-FakePort existing tests still pass (callback fires with `writePort===currentPort` true), and the deferred test truly reproduces the stale-callback race.
- Task 4: confirm `startDashboardServer` is exported and the closure path (not the `loadConfig` default) is what the test exercises.
