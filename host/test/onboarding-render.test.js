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

const HATCH_END = 5; // HATCH_FRAMES - 1

test("hatch end-frame shows the chosen species' real sprite", async () => {
  const bulba = await renderOnboarding({ kind: "hatch", frame: HATCH_END, species: "bulbasaur" });
  const eevee = await renderOnboarding({ kind: "hatch", frame: HATCH_END, species: "eevee" });
  assert.ok(!bulba.pngBuffer.equals(eevee.pngBuffer), "different species must render different end-frame sprites");
});

test("hatch mid-frame egg animation is species-agnostic", async () => {
  const bulba = await renderOnboarding({ kind: "hatch", frame: 0, species: "bulbasaur" });
  const eevee = await renderOnboarding({ kind: "hatch", frame: 0, species: "eevee" });
  assert.ok(bulba.pngBuffer.equals(eevee.pngBuffer), "non-end frames are just the egg, identical across species");
});
