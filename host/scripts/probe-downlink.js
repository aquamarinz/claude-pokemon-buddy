// Quick liveness probe: push one 8x8 all-ink frame and report whether the
// device ACKs. ACK => rx_task is alive (not boot-looping); timeout => device
// crashed / boot-loop. Diagnostic only.
import { createSerialTransport } from "../src/transport/serial.js";
import { encodeDirtyPayload } from "../src/transport/index.js";

const t = await createSerialTransport();
if (!t) { console.error("✗ no device (VID 303A)"); process.exit(1); }

const rect = { x: 0, y: 0, w: 8, h: 8, bytes: new Uint8Array(8).fill(0xff) };
console.log("pushing 8x8 test frame (top-left should turn black)…");
const res = await t.pushFrame(encodeDirtyPayload(rect));
console.log("result:", JSON.stringify(res));
t.close();
process.exit(res?.ok ? 0 : 2);
