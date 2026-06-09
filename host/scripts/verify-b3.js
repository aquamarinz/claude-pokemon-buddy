// B3 uplink verification: connect to the device over real serial and listen
// for the device -> host frames added in B3 — SENSOR (SHTC3 room temp/humidity,
// every 30s) and BUTTON (KEY/BOOT press events). The downlink (host -> device
// frame blit) is unchanged from B2, so this only exercises the new uplink path.
//
//   cd host && node scripts/verify-b3.js      then press KEY and BOOT a few times

import { createSerialTransport } from "../src/transport/serial.js";

const WINDOW_MS = 45_000;

const transport = await createSerialTransport();
if (!transport) {
  console.error("✗ no ESP device found (VID 303A). Is it plugged in and not held by another process?");
  process.exit(1);
}

console.log(`connected. listening ${WINDOW_MS / 1000}s for SENSOR + BUTTON…`);
console.log("→ press KEY and BOOT now (try single / double / long-press).\n");

let sensors = 0;
const buttons = [];

transport.onSensor((s) => {
  sensors += 1;
  console.log(`  SENSOR #${sensors}: ${s.t.toFixed(1)}°C  ${s.h}%RH`);
});
transport.onButton((b) => {
  buttons.push(b);
  console.log(`  BUTTON: ${b.key} / ${b.kind}`);
});

setTimeout(() => {
  console.log(`\n--- summary: ${sensors} SENSOR frame(s), ${buttons.length} BUTTON event(s) ---`);
  const ok = sensors > 0 && buttons.length > 0;
  console.log(ok ? "✓ B3 uplink OK" : "✗ incomplete (need ≥1 sensor and ≥1 button)");
  transport.close();
  process.exit(ok ? 0 : 2);
}, WINDOW_MS);
