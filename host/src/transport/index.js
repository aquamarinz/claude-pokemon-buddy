import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { diffRect } from "./diff.js";
import { createMockTransport } from "./mock.js";
import { rleEncode } from "./proto.js";
import { createSerialTransport } from "./serial.js";

export async function createTransport({
  framePath = "out/frame.png",
  serialTransportFactory = createSerialTransport,
  mockFactory = createMockTransport,
  ...serialOptions
} = {}) {
  const serial = await serialTransportFactory(serialOptions);
  if (!serial) return wrapMockTransport(mockFactory({ framePath }));
  return wrapSerialTransport(serial, { framePath });
}

export function encodeDirtyPayload(rect) {
  const rle = rleEncode(rect.bytes);
  const payload = new Uint8Array(8 + rle.length);
  const view = new DataView(payload.buffer);
  view.setUint16(0, rect.x, true);
  view.setUint16(2, rect.y, true);
  view.setUint16(4, rect.w, true);
  view.setUint16(6, rect.h, true);
  payload.set(rle, 8);
  return payload;
}

function wrapMockTransport(mock) {
  return {
    ...mock,
    kind: "mock",
    setActiveCry() {},
    async push(frame) {
      return mock.push(frame?.pngBuffer ?? frame);
    },
    close() {},
  };
}

function wrapSerialTransport(serial, { framePath }) {
  let previousBytes = null;
  let lastActiveCry = null;
  serial.onReconnect?.(() => {
    previousBytes = null;
    if (lastActiveCry != null) serial.setActiveCry(lastActiveCry);
  });

  return {
    ...serial,
    kind: "serial",
    setActiveCry(id) {
      lastActiveCry = id & 0xff;
      serial.setActiveCry(lastActiveCry);
    },
    async push({ pngBuffer, bitmap }) {
      if (!bitmap) throw new Error("bitmap is required");
      writePreview(framePath, pngBuffer);

      const rect = diffRect(previousBytes, bitmap.bytes, bitmap.w, bitmap.h);
      if (!rect) return { ok: true, skipped: true };

      const result = await serial.pushFrame(encodeDirtyPayload(rect));
      if (result?.ok) previousBytes = Uint8Array.from(bitmap.bytes);
      return result;
    },
  };
}

function writePreview(framePath, pngBuffer) {
  if (!framePath || !pngBuffer) return;
  mkdirSync(dirname(framePath), { recursive: true });
  writeFileSync(framePath, pngBuffer);
}
