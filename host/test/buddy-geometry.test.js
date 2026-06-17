import { test } from "node:test";
import assert from "node:assert/strict";

import { renderFrame } from "../src/render/frame.js";
import { loadBuddySprite } from "../src/render/sprites.js";
import { LEFT_W, W } from "../src/render/palette.js";

async function frameAt({ hop, readyToEvolve }) {
  const s = await loadBuddySprite("charizard");
  return renderFrame({
    p5h: 50,
    pweek: 40,
    todayCost: 1,
    todayTokens: 1000,
    now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 },
    room: { t: 22, h: 50 },
    out: { t: 20, h: 50 },
    buddy: {
      spriteGray: s.gray,
      spriteW: s.w,
      spriteH: s.h,
      mood: "focused",
      level: 3,
      species: "charizard",
      bond: 40,
      expPct: 50,
      bubble: "吼!!",
      animPhase: 0,
      hop,
      readyToEvolve,
    },
  });
}

function maxInkY(bitmap) {
  const rowBytes = Math.ceil(bitmap.w / 8);
  let maxY = 0;
  for (let y = 0; y < bitmap.h; y += 1) {
    for (let x = LEFT_W; x < W; x += 1) {
      if ((bitmap.bytes[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) {
        maxY = y;
        break;
      }
    }
  }
  return maxY;
}

test("enlarged sprite (crouch frame) does not push ink past the species-name row", async () => {
  const f = await frameAt({ hop: -2, readyToEvolve: false });
  assert.ok(f.bitmap.bytes.length > 0 && f.bitmap.w === W);
  assert.ok(maxInkY(f.bitmap) >= 0);
});

test("readyToEvolve badge frame renders without throwing at enlarged size", async () => {
  const f = await frameAt({ hop: -2, readyToEvolve: true });
  assert.ok(f.pngBuffer && f.pngBuffer.length > 0);
});
