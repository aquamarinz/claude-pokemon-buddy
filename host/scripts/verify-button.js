// Button-only diagnostic: listen 60s for BUTTON frames and log each as it
// arrives (with a wall-clock mark) so we can tell "nothing pressed" from
// "pressed but not detected". Diagnostic only.
import { createSerialTransport } from "../src/transport/serial.js";

const WINDOW_MS = 60_000;
const t0 = Date.now();

const transport = await createSerialTransport();
if (!transport) { console.error("✗ no device (VID 303A)"); process.exit(1); }

console.log(`listening ${WINDOW_MS / 1000}s for BUTTON only. Press KEY and BOOT now.`);

let n = 0;
transport.onButton((b) => {
  n += 1;
  console.log(`  [+${((Date.now() - t0) / 1000).toFixed(1)}s] BUTTON #${n}: ${b.key} / ${b.kind}`);
});

setTimeout(() => {
  console.log(`\n--- ${n} button event(s) in ${WINDOW_MS / 1000}s ---`);
  transport.close();
  process.exit(n > 0 ? 0 : 2);
}, WINDOW_MS);
