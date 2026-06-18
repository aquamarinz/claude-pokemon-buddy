import { test } from "node:test";
import assert from "node:assert/strict";

import { renderFrame } from "../src/render/frame.js";
import { loadBuddySprite } from "../src/render/sprites.js";

async function buddyModel(animPhase) {
  const s = await loadBuddySprite("eevee");
  return {
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000,
    now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "eevee", bond: 40, expPct: 50, bubble: "Bui!", animPhase },
  };
}

test("different animPhase yields a different buddy bitmap (breathing bob)", async () => {
  const a = await renderFrame(await buddyModel(0));
  const b = await renderFrame(await buddyModel(2)); // bob 最低点
  assert.notDeepEqual([...a.bitmap.bytes], [...b.bitmap.bytes]);
});

test("animPhase 0 and a full-period multiple render identically", async () => {
  const a = await renderFrame(await buddyModel(0));
  const c = await renderFrame(await buddyModel(4)); // BUDDY_BOB 周期=4 → 同相
  assert.deepEqual([...a.bitmap.bytes], [...c.bitmap.bytes]);
});
