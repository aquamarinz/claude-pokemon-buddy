import { test } from "node:test";
import assert from "node:assert/strict";

import { renderFrame } from "../src/render/frame.js";

test("renderFrame returns 400x300 png and 1bpp bitmap", async () => {
  const model = {
    p5h: 72,
    pweek: 41,
    todayCost: 4.1,
    todayTokens: 5_300_000,
    streak: 6,
    weather: {
      cond: "多云",
      temp: 19,
      feels: 17,
      hi: 22,
      lo: 14,
      precip: 30,
      wind: 11,
      humidity: 64,
    },
    room: { t: 23.4, h: 56 },
    out: { t: 19, h: 64 },
    buddy: {
      spriteGray: new Uint8Array(96 * 96).fill(120),
      mood: "focused",
      level: 7,
      bond: 3,
      expPct: 40,
    },
  };

  const { pngBuffer, bitmap } = await renderFrame(model);

  assert.ok(Buffer.isBuffer(pngBuffer));
  assert.ok(pngBuffer.length > 100);
  assert.equal(pngBuffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(bitmap.w, 400);
  assert.equal(bitmap.h, 300);
  assert.equal(bitmap.bytes.length, Math.ceil(400 / 8) * 300);
});
