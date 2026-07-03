import { test } from "node:test";
import assert from "node:assert/strict";

import { buddyBold } from "../src/render/layout.js";
import { grayToBitmap, imageDataToFrame, renderFrame } from "../src/render/frame.js";

test("buddyBold: all species render thin by default", () => {
  for (const sp of [
    "eevee", "vaporeon", "jolteon", "flareon", "espeon", "umbreon",
    "leafeon", "glaceon", "sylveon", "bulbasaur", "ivysaur", "venusaur",
    "charmander", "charmeleon", "charizard", "squirtle", "wartortle", "blastoise",
    undefined,
  ]) {
    assert.equal(buddyBold(sp), false, `${sp} should render thin`);
  }
});

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

test("grayToBitmap hard-thresholds canvas gray without Bayer pattern", () => {
  const bitmap = grayToBitmap(new Uint8Array(8 * 8).fill(216), 8, 8);

  assert.equal(countOnPixels(bitmap, 0, 0, 8, 8), 0);
});

test("imageDataToFrame rejects dimensions other than the panel size", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const g = createCanvas(10, 10).getContext("2d");

  await assert.rejects(
    () => imageDataToFrame(g.getImageData(0, 0, 10, 10)),
    /expected 400x300, got 10x10/,
  );
});

test("bold dilation adds ink versus thin for the same sprite", async () => {
  const spriteGray = singleInkPixelSprite(16, 16);
  const { drawSprite, BUDDY_SPRITE_SLOT } = await import("../src/render/layout.js");
  const { createCanvas } = await import("@napi-rs/canvas");
  const ink = (bold) => {
    const c = createCanvas(BUDDY_SPRITE_SLOT, BUDDY_SPRITE_SLOT);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, BUDDY_SPRITE_SLOT, BUDDY_SPRITE_SLOT);
    g.fillStyle = "#000";
    drawSprite(g, spriteGray, { x: 0, y: 0, maxSize: BUDDY_SPRITE_SLOT, srcW: 16, srcH: 16, bold });
    const d = g.getImageData(0, 0, BUDDY_SPRITE_SLOT, BUDDY_SPRITE_SLOT).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n += 1; return n;
  };
  assert.ok(ink(true) > ink(false), "bold dilation must add ink");
});

function countOnPixels(bitmap, x, y, w, h) {
  const rowBytes = Math.ceil(bitmap.w / 8);
  let count = 0;

  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      count += (bitmap.bytes[yy * rowBytes + (xx >> 3)] >> (7 - (xx & 7))) & 1;
    }
  }

  return count;
}

function singleInkPixelSprite(w, h) {
  const spriteGray = new Uint8Array(w * h).fill(255);
  spriteGray[Math.floor(h / 2) * w + Math.floor(w / 2)] = 0;
  return spriteGray;
}
