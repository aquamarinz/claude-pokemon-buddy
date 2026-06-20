# Firmware Fixes SPEC (M9, M12, L9, L8) — APPLIED + build-verified

> ✅ **APPLIED + BUILD-VERIFIED (2026-06-20).** ESP-IDF v5.4.4 turned out to be available in-session (`. ~/esp/esp-idf/export.sh`); all four diffs below were applied and `cd firmware && idf.py build` (target esp32s3) compiles cleanly (exit 0, "Project build complete"). NOT yet board-smoke-tested (no hardware attached) — flash + serial round-trip recommended before shipping. Committed alongside this doc.

**Scope:** `firmware/main/main.cpp` (M9, L9, L8) and `firmware/components/port_bsp/display_bsp.cpp` (M12).
**Constants (verified):** `RX_MAX = 48*1024 = 49152`, `RECT_MAX = (W*H)/8 = 15000`, `W=400 H=300`, `width_/height_` are `DisplayPort` members.

---

## M12 (Medium) — `RLCD_SetPixel` (LUT path) has no bounds check

**Why:** The active build (`AlgorithmOptimization==3`) uses the LUT `RLCD_SetPixel`, which indexes `PixelIndexLUT[x][y]` (a `[400][300]` array) and writes `DispBuffer[idx]` with **no bounds check** — unlike the non-LUT variants (`display_bsp.cpp:231` and `:271`) which both guard `x >= width_ || y >= height_`. Safety currently rests entirely on the single caller's check at `main.cpp:155`. Any future caller, or a weakening of that one check, becomes a direct OOB read/write driven by host-supplied coordinates.

**Fix — `firmware/components/port_bsp/display_bsp.cpp:357`:**
```c
 void DisplayPort::RLCD_SetPixel(uint16_t x, uint16_t y, uint8_t color) {
+    if (x >= width_ || y >= height_) return;   // match the guarded non-LUT variants
     uint32_t idx = PixelIndexLUT[x][y];
     uint8_t  mask = PixelBitLUT[x][y];
```
**Risk:** minimal (one early-return mirroring existing guards). **Verify:** `idf.py build`; boot marker + a normal frame still render.

---

## L9 (Low) — `synth_tone` relies on `assert` for a runtime alloc failure

**Why:** `*out = heap_caps_malloc(...); assert(*out);` then dereferences `*out` unconditionally (`main.cpp:266-286`). If assertions are compiled out (release `NDEBUG`), a failed PSRAM alloc returns NULL and the loop writes through a NULL pointer. `play_sound`/`audio_task` already null-guard `g_snd[id]`, so returning NULL/0 here degrades safely.

**Fix — `firmware/main/main.cpp:266`:**
```c
     *out = (int16_t *) heap_caps_malloc(*bytes, MALLOC_CAP_SPIRAM);
-    assert(*out);
+    if (*out == NULL) {
+        ESP_LOGE(TAG, "synth_tone: PSRAM alloc of %zu bytes failed", *bytes);
+        *bytes = 0;                 // caller stores g_snd[i]=NULL, g_snd_bytes[i]=0 -> play_sound skips it
+        return;
+    }
```
**Risk:** low. **Verify:** `idf.py build`; audio still plays (BUI/EVOLVE/HOUR + species cries) on a healthy board.

---

## M9 (Medium→Low) — RX overflow discards the whole accumulator instead of draining first

**Why:** `rx_task` (`main.cpp:219-220`):
```c
if (rxlen + (size_t)n > RX_MAX) rxlen = 0;   // drops ALL buffered bytes, incl. a valid partial
if ((size_t)n > RX_MAX) n = RX_MAX;          // dead: n <= 1024
```
On overflow it throws away the entire buffer (losing an in-flight valid frame), and line 220 is dead (`n` is always ≤ 1024). Note: a single valid full-screen FRAME (~30 KB) fits in `RX_MAX` (48 KB), so normal traffic does not hit this; it triggers under noise/desync backlog. The fix drains complete frames first and only resets as a last resort.

**Fix — `firmware/main/main.cpp:216-223` (`rx_task` loop body):**
```c
         int n = usb_serial_jtag_read_bytes(tmp, sizeof(tmp), pdMS_TO_TICKS(100));
         if (n <= 0) continue;
-        if (rxlen + (size_t)n > RX_MAX) rxlen = 0;
-        if ((size_t)n > RX_MAX) n = RX_MAX;
+        if (rxlen + (size_t)n > RX_MAX) {
+            parse_frames();                       // drain any complete frames before dropping
+            if (rxlen + (size_t)n > RX_MAX) {
+                rxlen = 0;                        // backlog is unparseable garbage -> last-resort resync
+            }
+        }
         memcpy(rxbuf + rxlen, tmp, n);
         rxlen += n;
         parse_frames();
```
**Note:** `n <= sizeof(tmp) = 1024 < RX_MAX`, so after the (possible) reset `rxlen + n <= RX_MAX` and the `memcpy` stays in-bounds. **Risk:** moderate (touches the RX hot path) — **must** be board-verified: push frames continuously across a reconnect/noise burst and confirm the display keeps updating without permanent stalls.

---

## L8 (Low, OPTIONAL — largely subsumed by M9) — inbound length bound is looser than the real max

**Why:** `parse_frames` accepts any `len <= RX_MAX` (49152), but the largest *valid* inbound FRAME payload is RLE-worst-case ≈ `2 * RECT_MAX + header` ≈ 30 KB. A corrupt `len` in `(available, 49152]` makes the parser `break` (wait) until M9's overflow handling clears it. Tightening the bound lets it `pos++`-resync immediately.

> ⚠️ The earlier scan suggested `RECT_MAX + 8` (~15 KB) — **that is too tight and would reject valid full-screen RLE frames** (RLE worst case is ~2×). Use `2 * RECT_MAX + 16`.

**Fix (optional) — add near the `RECT_MAX` constant (`main.cpp:83`):**
```c
static constexpr size_t MAX_INBOUND_PAYLOAD = 2 * RECT_MAX + 16; // RLE worst-case (~2x) + rect header slack
```
**and `main.cpp:188`:**
```c
-        if (len > RX_MAX) { pos++; continue; }
+        if (len > MAX_INBOUND_PAYLOAD) { pos++; continue; }
```
**Risk:** low, but **only safe once the true RLE worst-case is confirmed** against the host encoder for the largest frame. If unsure, skip L8 and rely on M9. **Verify:** `idf.py build`; full-screen frame still accepted; a frame with a corrupt length byte recovers.

---

## Application checklist (build environment)
1. Source ESP-IDF (`. ~/esp/esp-idf/export.sh`), confirm `idf.py` on PATH.
2. Apply M12, L9, M9 (and optionally L8).
3. `cd firmware && idf.py build` → clean compile.
4. Flash + serial: confirm boot, a normal frame render (M12), audio (L9), and sustained frame pushing across a reconnect (M9).
5. Commit per-fix once the build + smoke test pass.
