import { test } from "node:test";
import assert from "node:assert/strict";

import { encodeFrame, decodeFrame, rleEncode, rleDecode, T } from "../src/transport/proto.js";

test("rle roundtrip", () => {
  const b = Uint8Array.from([0, 0, 0, 0, 255, 255, 1, 2, 2, 2]);
  assert.deepEqual([...rleDecode(rleEncode(b))], [...b]);
});

test("frame roundtrip w/ crc+seq+type", () => {
  const f = encodeFrame({ type: 0x01, seq: 7, payload: Uint8Array.from([1, 2, 3, 4, 5]) });
  const d = decodeFrame(f);
  assert.equal(d.type, 1);
  assert.equal(d.seq, 7);
  assert.deepEqual([...d.payload], [1, 2, 3, 4, 5]);
});

test("VOLUME frame roundtrips a single 0-100 byte (RM12)", () => {
  assert.equal(T.VOLUME, 0x25);
  const f = encodeFrame({ type: T.VOLUME, seq: 0, payload: Uint8Array.from([70]) });
  const d = decodeFrame(f);
  assert.equal(d.type, T.VOLUME);
  assert.equal(d.seq, 0);
  assert.deepEqual([...d.payload], [70]);
});

test("decode rejects bad crc", () => {
  const f = encodeFrame({ type: 1, seq: 1, payload: Uint8Array.from([9]) });
  f[f.length - 1] ^= 0xff;
  assert.throws(() => decodeFrame(f));
});

test("encodeFrame rejects payloads larger than the 16-bit protocol length (RL10)", () => {
  assert.throws(
    () => encodeFrame({ type: 1, seq: 1, payload: new Uint8Array(0x10000) }),
    /payload length/i,
  );
});
