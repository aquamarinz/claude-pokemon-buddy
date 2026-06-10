import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOnboarding } from "../src/render/onboarding.js";

for (const scene of [
  { kind: "oak", lines: ["……这个世界，", "生活着宝可梦。"] },
  { kind: "choose", candidates: [{ species: "eevee", name: "伊布" }, { species: "bulbasaur", name: "妙蛙种子" }], sel: 1 },
  { kind: "hatch", frame: 2 },
  { kind: "born", species: "eevee", name: "伊布" },
]) {
  test(`renderOnboarding(${scene.kind}) → 400x300 bitmap, no throw`, async () => {
    const { pngBuffer, bitmap } = await renderOnboarding(scene);
    assert.equal(bitmap.w, 400);
    assert.equal(bitmap.h, 300);
    assert.ok(pngBuffer && pngBuffer.length > 0);
  });
}
