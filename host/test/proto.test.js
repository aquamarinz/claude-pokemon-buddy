import { test } from "node:test";
import assert from "node:assert/strict";

import { encodeFrame, decodeFrame, rleEncode, rleDecode } from "../src/transport/proto.js";

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

test("decode rejects bad crc", () => {
  const f = encodeFrame({ type: 1, seq: 1, payload: Uint8Array.from([9]) });
  f[f.length - 1] ^= 0xff;
  assert.throws(() => decodeFrame(f));
});
