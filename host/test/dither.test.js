import { test } from "node:test";
import assert from "node:assert/strict";

import { ditherTo1bpp, thresholdTo1bpp } from "../src/render/dither.js";

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

test("hard threshold maps all black to one bits and all white to zero bits", () => {
  assert.deepEqual([...thresholdTo1bpp(new Uint8Array(16).fill(0), 8, 2).bytes], [0xff, 0xff]);
  assert.deepEqual([...thresholdTo1bpp(new Uint8Array(16).fill(255), 8, 2).bytes], [0x00, 0x00]);
});

test("hard threshold treats gray 127 as ink and gray 128 as paper", () => {
  const gray = new Uint8Array([0, 127, 128, 255, 129, 126, 128, 127]);
  const { bytes } = thresholdTo1bpp(gray, 8, 1);

  assert.equal(bytes[0], 0b11000101);
});

test("bit polarity uses 1 for black and most-significant bit for the left pixel", () => {
  const gray = new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255]);
  const { bytes } = ditherTo1bpp(gray, 8, 1);

  assert.equal(bytes[0], 0b10101010);
});
