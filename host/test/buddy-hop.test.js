import { test } from "node:test";
import assert from "node:assert/strict";

import { renderFrame } from "../src/render/frame.js";
import { loadBuddySprite } from "../src/render/sprites.js";

async function model(hop) {
  const s = await loadBuddySprite("eevee");
  return {
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000,
    now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "eevee", bond: 40, expPct: 50, bubble: "Bui!", animPhase: 0, hop },
  };
}

test("buddy.hop raises the sprite (different bitmap)", async () => {
  const a = await renderFrame(await model(0));
  const b = await renderFrame(await model(8));
  assert.notDeepEqual([...a.bitmap.bytes], [...b.bitmap.bytes]);
});

test("hop defaults to 0 (absent hop == hop 0)", async () => {
  const s = await loadBuddySprite("eevee");
  const base = {
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000, now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "eevee", bond: 40, expPct: 50, bubble: "Bui!", animPhase: 0 },
  };
  const noHop = await renderFrame(base);
  const hop0 = await renderFrame({ ...base, buddy: { ...base.buddy, hop: 0 } });
  assert.deepEqual([...noHop.bitmap.bytes], [...hop0.bitmap.bytes]);
});
