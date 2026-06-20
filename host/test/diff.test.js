import { test } from "node:test";
import assert from "node:assert/strict";

import { diffRect } from "../src/transport/diff.js";

test("diffRect returns null when frames are identical", () => {
  const prev = Uint8Array.from([0, 1, 2, 3]);
  const next = Uint8Array.from([0, 1, 2, 3]);

  assert.equal(diffRect(prev, next, 16, 2), null);
});

test("diffRect returns full screen for first frame", () => {
  const next = Uint8Array.from([0xaa, 0x55, 0x00, 0xff]);

  assert.deepEqual(diffRect(null, next, 16, 2), {
    x: 0,
    y: 0,
    w: 16,
    h: 2,
    bytes: next,
  });
});

test("diffRect returns byte-aligned minimal dirty rectangle", () => {
  const prev = Uint8Array.from([0, 0, 0, 0, 0, 0]);
  const next = Uint8Array.from([0, 0, 0, 0x40, 0, 0]);

  assert.deepEqual(diffRect(prev, next, 16, 3), {
    x: 8,
    y: 1,
    w: 8,
    h: 1,
    bytes: Uint8Array.from([0x40]),
  });
});

test("diffRect keeps rect width byte-aligned for non-multiple-of-8 widths (L5)", () => {
  // w=12 (rowBytes=2); flip the bit at x=10 (byte 1, bit 5)
  const prev = Uint8Array.from([0x00, 0x00]);
  const next = Uint8Array.from([0x00, 0x20]);
  const rect = diffRect(prev, next, 12, 1);

  assert.equal(rect.x, 8);
  assert.equal(rect.w, 8);
  assert.equal(rect.w % 8, 0);
});

test("diffRect includes all dirty rows in row-major byte order", () => {
  const prev = Uint8Array.from([0, 0, 0, 0, 0, 0]);
  const next = Uint8Array.from([0x40, 0, 0, 0, 0, 0x20]);

  assert.deepEqual(diffRect(prev, next, 16, 3), {
    x: 0,
    y: 0,
    w: 16,
    h: 3,
    bytes: Uint8Array.from([0x40, 0, 0, 0, 0, 0x20]),
  });
});
