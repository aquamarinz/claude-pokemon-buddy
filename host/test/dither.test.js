import { test } from "node:test";
import assert from "node:assert/strict";

import { ditherTo1bpp } from "../src/render/dither.js";

test("packs 400x300 gray to 1bpp byte length", () => {
  const gray = new Uint8Array(400 * 300).fill(255);
  const { bytes, w, h } = ditherTo1bpp(gray, 400, 300);

  assert.equal(w, 400);
  assert.equal(h, 300);
  assert.equal(bytes.length, Math.ceil(400 / 8) * 300);
});

test("all white maps to zero bits", () => {
  const { bytes } = ditherTo1bpp(new Uint8Array(16).fill(255), 8, 2);

  assert.deepEqual([...bytes], [0x00, 0x00]);
});

test("all black maps to one bits", () => {
  const { bytes } = ditherTo1bpp(new Uint8Array(16).fill(0), 8, 2);

  assert.deepEqual([...bytes], [0xff, 0xff]);
});

test("bit polarity uses 1 for black and most-significant bit for the left pixel", () => {
  const gray = new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255]);
  const { bytes } = ditherTo1bpp(gray, 8, 1);

  assert.equal(bytes[0], 0b10101010);
});
