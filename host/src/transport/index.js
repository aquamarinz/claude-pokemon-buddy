import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { diffRect } from "./diff.js";
import { createMockTransport } from "./mock.js";
import { rleEncode } from "./proto.js";
import { createSerialTransport } from "./serial.js";

let loggedMockFallback = false;

export async function createTransport({
  framePath = "out/frame.png",
  serialTransportFactory = createSerialTransport,
  mockFactory = createMockTransport,
  logger = console,
  ...serialOptions
} = {}) {
  const serial = await serialTransportFactory(serialOptions);
  if (!serial) {
    logMockFallback(logger);
    return wrapMockTransport(mockFactory({ framePath }));
  }
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
    sendVolume(volume) { mock.sendVolume?.(volume); },
    async push(frame) {
      return mock.push(frame?.pngBuffer ?? frame);
    },
    close() {},
  };
}

function logMockFallback(logger) {
  if (loggedMockFallback) return;
  loggedMockFallback = true;
  logger?.warn?.("ESP serial port not found; using mock transport");
}

function wrapSerialTransport(serial, { framePath }) {
  let previousBytes = null;
  let lastActiveCry = null;
  let lastVolume = null;
  serial.onReconnect?.(() => {
    previousBytes = null;
    if (lastActiveCry != null) serial.setActiveCry(lastActiveCry); // P2: 重连重放
    if (lastVolume != null) serial.sendVolume(lastVolume);
  });

  async function doPush({ pngBuffer, bitmap }) {
    if (!bitmap) throw new Error("bitmap is required");
    writePreview(framePath, pngBuffer);
    const rect = diffRect(previousBytes, bitmap.bytes, bitmap.w, bitmap.h);
    if (!rect) return { ok: true, skipped: true };
    const result = await serial.pushFrame(encodeDirtyPayload(rect));
    if (result?.ok) previousBytes = Uint8Array.from(bitmap.bytes);
    return result;
  }

  let chain = Promise.resolve();
  function push(frame) {
    const run = chain.then(() => doPush(frame));
    chain = run.then(() => {}, () => {}); // 保持链活，吞错不阻断后续
    return run;
  }

  return {
    ...serial,
    kind: "serial",
    setActiveCry(id) {                       // P2: 原样保留
      lastActiveCry = id & 0xff;
      serial.setActiveCry(lastActiveCry);
    },
    sendVolume(volume) {
      lastVolume = volumeByte(volume);
      serial.sendVolume?.(lastVolume);
    },
    push,
  };
}

function writePreview(framePath, pngBuffer) {
  if (!framePath || !pngBuffer) return;
  mkdirSync(dirname(framePath), { recursive: true });
  writeFileSync(framePath, pngBuffer);
}

function volumeByte(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(volume)));
}
