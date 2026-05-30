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
