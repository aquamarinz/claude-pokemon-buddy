import { test } from "node:test";
import assert from "node:assert/strict";

import { createTransport } from "../src/transport/index.js";

// 可控 serial：pushFrame 在 release() 前挂起，记录每次的 dirty payload
function gatedSerialFactory() {
  let release;
  const gate = new Promise((r) => { release = r; });
  const seen = [];
  const serial = {
    async pushFrame(payload) { seen.push(payload); await gate; return { ok: true }; },
    playSound() {}, setActiveCry() {},
    onReconnect() { return () => {}; }, onButton() { return () => {}; },
    onSensor() { return () => {}; }, feedSensor() { return null; }, close() {},
    _release: () => release(), _seen: seen,
  };
  return { factory: async () => serial, serial };
}

function frame(bytes) { // bytes: 每字节 8px，h=1
  return { pngBuffer: null, bitmap: { bytes: Uint8Array.from(bytes), w: bytes.length * 8, h: 1 } };
}

test("concurrent pushes serialize and 2nd diffs against 1st's baseline", async () => {
  const { factory, serial } = gatedSerialFactory();
  const t = await createTransport({ serialTransportFactory: factory, framePath: null });

  const p1 = t.push(frame([0xff, 0xff])); // 16px 全墨
  const p2 = t.push(frame([0xff, 0x00])); // 仅后 8px 变白
  // 互斥下，第一帧未完成时第二帧的 pushFrame 不应被调用
  await Promise.resolve();
  assert.equal(serial._seen.length, 1);

  serial._release();
  await Promise.all([p1, p2]);
  assert.equal(serial._seen.length, 2);

  const p = serial._seen[1];              // 第二帧 dirty payload: [x u16][y u16][w u16][h u16][rle]
  const x = p[0] | (p[1] << 8);
  const w = p[4] | (p[5] << 8);
  assert.equal(x, 8);                     // 局部 rect → 证明 diff 用的是第一帧的 baseline
  assert.equal(w, 8);
});
