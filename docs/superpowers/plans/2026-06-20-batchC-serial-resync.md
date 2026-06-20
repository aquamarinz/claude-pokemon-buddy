# Batch C — Serial RX Resync (H3) + Fire-and-Forget Write Detection (M8) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:**
- H3: make the host serial receiver resync after line noise / a stray MAGIC / a bad-CRC frame, instead of stalling on a bogus length or skipping by an untrusted frame length. Today a single corrupt byte can swallow all subsequent uplink (BUTTON/SENSOR/ACK) frames.
- M8: give `playSound`/`setActiveCry` (fire-and-forget writes) the same async write-error → `handleDisconnect()` behavior as `sendPending`, so a write that fails because the device vanished triggers reconnect instead of being silently dropped.

**Architecture:** Both fixes live in `makeTransport` in `host/src/transport/serial.js`. H3 rewrites `readAvailableFrames` to bound `len` and advance by exactly one byte on a bogus length or a decode failure (mirroring the firmware's `pos++` resync). M8 adds a write callback to the two fire-and-forget senders.

**Tech Stack:** Node.js ESM, `node:test`. No new deps. Protocol: `proto.js` (`MAGIC=0xA5`, CRC32-validated frames; firmware uplink `len` is a `uint8` ≤ 255).

## Global Constraints
- ESM; `node --test` from `host/`; no new deps.
- Preserve all existing serial.test.js behavior (ACK/seq/queue/reconnect/sensor/button paths unchanged).
- H3 must not change the happy path (well-formed frames parse exactly as before).

---

## File Structure
- `host/src/transport/serial.js` — `readAvailableFrames` (H3); `playSound`/`setActiveCry` (M8). (modify)
- `host/test/serial.test.js` — resync tests (H3); write-error→reconnect tests (M8). (modify)

---

### Task 1: H3 — bounded length + byte-wise resync in `readAvailableFrames`

**Files:** Modify `host/src/transport/serial.js`; Test `host/test/serial.test.js`

**Interfaces:** internal `readAvailableFrames()` only; no public API change. New module-level const `MAX_RX_PAYLOAD = 512`.

- [ ] **Step 1: Write the failing tests** — add to `host/test/serial.test.js` (the file already imports `decodeFrame, encodeFrame, T` from proto; add `MAGIC` to that import: `import { decodeFrame, encodeFrame, MAGIC, T } from "../src/transport/proto.js";`):

```js
test("RX recovers from a stray MAGIC with a bogus length and still parses later frames (H3)", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  const buttons = [];
  transport.onButton((e) => buttons.push(e));

  // stray MAGIC + bogus huge length (0xFFFF), no real frame yet
  port.emitData(Uint8Array.from([MAGIC, T.BUTTON, 0x00, 0xff, 0xff]));
  // then a genuine BUTTON frame arrives
  port.emitData(encodeFrame({ type: T.BUTTON, seq: 9, payload: Uint8Array.from([1, 1]) }));

  assert.deepEqual(buttons, [{ key: "KEY", kind: "short" }]);
  transport.close();
});

test("RX resyncs past a bad-CRC frame to the next valid frame (H3)", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  const buttons = [];
  transport.onButton((e) => buttons.push(e));

  const corrupt = Uint8Array.from(encodeFrame({ type: T.BUTTON, seq: 9, payload: Uint8Array.from([1, 1]) }));
  corrupt[corrupt.length - 1] ^= 0xff; // break the CRC
  port.emitData(corrupt);
  port.emitData(encodeFrame({ type: T.BUTTON, seq: 10, payload: Uint8Array.from([2, 2]) }));

  // corrupt frame dropped; the valid second frame is still delivered
  assert.deepEqual(buttons, [{ key: "BOOT", kind: "long" }]);
  transport.close();
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/serial.test.js`
  Expected: the "stray MAGIC ... bogus length" test FAILS (`buttons` is empty — the old code returns early waiting for 0xFFFF bytes and never parses the real frame). The bad-CRC test may pass or fail depending on byte alignment; the bogus-length one is the definitive red.

- [ ] **Step 3: Implement** — in `host/src/transport/serial.js`:

Add a module-level constant near the other consts (after `const DEFAULT_MAX_RETRIES = 3;`):

```js
const MAX_RX_PAYLOAD = 512; // firmware uplink payloads are <=255 (uint8 len); bound rejects noise/desync
```

Replace `readAvailableFrames` entirely with:

```js
  function readAvailableFrames() {
    while (rx.length >= 5) {
      const magicOffset = rx.indexOf(MAGIC);
      if (magicOffset < 0) {
        rx = new Uint8Array(0);
        return;
      }
      if (magicOffset > 0) rx = rx.slice(magicOffset);
      if (rx.length < 5) return;

      const len = rx[3] | (rx[4] << 8);
      if (len > MAX_RX_PAYLOAD) {
        // Bogus length (line noise / desync) -> drop this MAGIC byte and rescan.
        rx = rx.slice(1);
        continue;
      }

      const frameLen = 5 + len + 4;
      if (rx.length < frameLen) return;

      const frameBytes = rx.slice(0, frameLen);
      try {
        handleFrame(decodeFrame(frameBytes));
        rx = rx.slice(frameLen);
      } catch {
        // Bad CRC / corrupt -> advance one byte and resync to the next MAGIC.
        rx = rx.slice(1);
      }
    }
  }
```

(The two changes vs. before: a `len > MAX_RX_PAYLOAD` guard that drops one byte instead of waiting; and consuming `frameLen` only on successful decode, dropping a single byte on CRC failure instead of skipping the whole untrusted length.)

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/serial.test.js`
  Expected: PASS — both new tests + ALL existing serial tests (happy-path frames still decode and consume exactly `frameLen`; ACK/queue/reconnect/sensor unaffected).

- [ ] **Step 5: Commit** — SKIP (orchestrator).

---

### Task 2: M8 — fire-and-forget writes detect disconnect

**Files:** Modify `host/src/transport/serial.js` (`playSound`, `setActiveCry`); Test `host/test/serial.test.js`

**Interfaces:** `playSound(soundId)` / `setActiveCry(soundId)` — unchanged signatures; an async write error now triggers `handleDisconnect()` (→ reconnect) instead of being swallowed.

- [ ] **Step 1: Write the failing tests** — add to `host/test/serial.test.js`:

```js
test("playSound write error triggers reconnect (M8)", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  let attempts = 0;
  port1.writeError = new Error("disconnected");
  const transport = makeTransport({
    port: port1,
    openPort: async () => { attempts += 1; return port2; },
    reconnectDelayMs: 5,
  });

  transport.playSound(2);
  await waitFor(() => attempts === 1);
  assert.equal(attempts, 1);
  transport.close();
});

test("setActiveCry write error triggers reconnect (M8)", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  let attempts = 0;
  port1.writeError = new Error("disconnected");
  const transport = makeTransport({
    port: port1,
    openPort: async () => { attempts += 1; return port2; },
    reconnectDelayMs: 5,
  });

  transport.setActiveCry(7);
  await waitFor(() => attempts === 1);
  assert.equal(attempts, 1);
  transport.close();
});
```

- [ ] **Step 2: Run, verify it fails** — `cd host && node --test test/serial.test.js`
  Expected: both new tests FAIL (`attempts` stays 0 — current writes pass no callback, so the write error is ignored and no reconnect is scheduled).

- [ ] **Step 3: Implement** — in `host/src/transport/serial.js`, replace `playSound` and `setActiveCry`:

```js
    playSound(soundId) {
      if (!connected) return;
      // Fire-and-forget: the device does not ACK PLAY frames, so this bypasses
      // the stop-and-wait pump — but an async write error still means the device
      // vanished, so surface it to the reconnect path.
      try {
        currentPort.write(
          encodeFrame({ type: T.PLAY, seq: 0, payload: Uint8Array.from([soundId & 0xff]) }),
          (error) => { if (error) handleDisconnect(); },
        );
      } catch {
        handleDisconnect();
      }
    },
    setActiveCry(soundId) {
      if (!connected) return;
      // Fire-and-forget CONFIG frame: device stores it as the KEY-press cry id.
      try {
        currentPort.write(
          encodeFrame({ type: T.CONFIG, seq: 0, payload: Uint8Array.from([soundId & 0xff]) }),
          (error) => { if (error) handleDisconnect(); },
        );
      } catch {
        handleDisconnect();
      }
    },
```

- [ ] **Step 4: Run, verify pass** — `cd host && node --test test/serial.test.js`
  Expected: PASS — new tests + the existing "setActiveCry writes a CONFIG frame" test (FakePort calls the callback with `writeError=null` → no disconnect, frame still written).

- [ ] **Step 5: Commit** — SKIP.

---

## Full-suite gate (orchestrator)
`cd host && mkdir -p out && node --test --test-concurrency=1` → only `scripts/play-test.js` fails.

## Self-Review
1. Spec coverage: H3 bounded-len + byte resync (Task 1, two tests); M8 write-error detection (Task 2, two tests). ✓
2. Placeholder scan: concrete code/commands/expected output. ✓
3. Type consistency: `MAX_RX_PAYLOAD` number; `readAvailableFrames` internal; `handleDisconnect` already defined above the returned object (closure hoisting — `playSound`/`setActiveCry` are methods called later, so `handleDisconnect` is in scope). ✓

## Notes for reviewer
- Confirm the happy path is byte-identical: a well-formed frame still hits `decodeFrame` OK and consumes exactly `frameLen` (now inside the try, before nothing else mutates `rx`).
- Confirm `MAX_RX_PAYLOAD=512` rejects no legitimate uplink frame (firmware `send_frame` caps payload at a `uint8` len ≤ 255; host only receives ACK/NACK/BUTTON/SENSOR, all ≤ a few bytes).
- Confirm `handleDisconnect` is reachable from `playSound`/`setActiveCry` (it is a function declaration in the same `makeTransport` closure, defined before the returned object).
- Confirm the bad-CRC resync test is deterministic for the given bytes (corrupt frame's body contains no embedded `0xA5` that would form a second valid frame; if the implementer finds a collision, adjust the payload, keeping the assertion on the SECOND frame).
