import { test } from "node:test";
import assert from "node:assert/strict";

import { playSignatureAnimation, SIGNATURE_HOP } from "../src/render/signature-anim.js";
import { loadBuddySprite } from "../src/render/sprites.js";

function spyTransport() {
  let inFlight = 0;
  const order = [];
  return {
    playSoundCalls: 0,
    playSound() { this.playSoundCalls += 1; },
    async push(frame) {
      assert.equal(inFlight, 0, "pushes must be sequential (no overlap)");
      inFlight += 1;
      order.push(frame.buddy.hop);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true };
    },
    _order: order,
  };
}

const baseModel = () => ({ buddy: { species: "charmander", spriteGray: new Uint8Array(4), spriteW: 2, spriteH: 2 } });

test("plays the full hop sequence sequentially", async () => {
  const t = spyTransport();
  await playSignatureAnimation({
    transport: t, model: baseModel(),
    render: (m) => ({ buddy: { hop: m.buddy.hop } }),
    delay: () => Promise.resolve(),
  });
  assert.equal(t._order.length, SIGNATURE_HOP.length);
  assert.deepEqual(t._order, SIGNATURE_HOP);
});

test("signature is visual-only: never calls playSound (firmware plays local cry)", async () => {
  const t = spyTransport();
  await playSignatureAnimation({
    transport: t, model: baseModel(),
    render: (m) => ({ buddy: { hop: m.buddy.hop } }),
    delay: () => Promise.resolve(),
  });
  assert.equal(t.playSoundCalls, 0);
});

test("default renderFrame produces valid {pngBuffer,bitmap} frames from a real model", async () => {
  const s = await loadBuddySprite("charmander");
  const model = {
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000, now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "charmander", bond: 40, expPct: 50, bubble: "嘎喔!" },
  };
  const frames = [];
  await playSignatureAnimation({
    transport: { push: async (f) => { frames.push(f); return { ok: true }; } },
    model, delay: () => Promise.resolve(), // 用默认 renderFrame
  });
  assert.equal(frames.length, SIGNATURE_HOP.length);
  for (const f of frames) {
    assert.ok(f.pngBuffer && f.pngBuffer.length > 0);
    assert.ok(f.bitmap?.bytes?.length > 0 && f.bitmap.w === 400 && f.bitmap.h === 300);
  }
});
