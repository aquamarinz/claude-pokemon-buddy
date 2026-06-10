// Manually fire PLAY frames to audition the device's sounds without waiting for
// a real evolution / top-of-hour. Sends EVOLVE (id 1) then HOUR (id 2); press
// KEY yourself to hear BUI (id 0). Diagnostic only.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SerialPort } from "serialport";

import { encodeFrame, T } from "../src/transport/proto.js";
import { findEspPort } from "../src/transport/serial.js";

async function main() {
  const path = await findEspPort();
  if (!path) { console.error("✗ no device (VID 303A)"); process.exit(1); }

  const port = new SerialPort({ path, baudRate: 115200 });
  await new Promise((resolve) => port.on("open", resolve));

  function play(id, name, delay) {
    setTimeout(() => {
      port.write(encodeFrame({ type: T.PLAY, seq: 0, payload: Uint8Array.from([id]) }));
      console.log(`→ sent PLAY ${name} (id=${id})`);
    }, delay);
  }

  console.log("auditioning: EVOLVE in 3s, HOUR in 8s. Also press KEY for BUI.");
  play(1, "EVOLVE", 3000);
  play(2, "HOUR", 8000);
  setTimeout(() => { port.close(); process.exit(0); }, 11000);
}

// Diagnostic CLI only. The filename ends in -test.js so `node --test` collects it;
// guard the serial work behind a direct-run check so importing it never locks a port.
const isCli = process.argv[1] && existsSync(process.argv[1])
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isCli) await main();
