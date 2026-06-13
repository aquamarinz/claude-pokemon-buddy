import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOnboarding } from "../src/render/onboarding.js";
import { CANDIDATES } from "../src/pet/onboarding-data.js";

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

test("drawEgg renders a distinct egg per candidate species (choose screen)", async () => {
  const bufs = await Promise.all(CANDIDATES.map((c, i) =>
    renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel: i }).then((r) => r.pngBuffer)));
  for (let i = 0; i < bufs.length; i += 1) {
    for (let j = i + 1; j < bufs.length; j += 1) {
      assert.ok(!bufs[i].equals(bufs[j]), `egg ${i} vs ${j} must differ`);
    }
  }
});

test("hatch mid-frame egg differs per species (species-specific eggs)", async () => {
  const bulba = await renderOnboarding({ kind: "hatch", frame: 0, species: "bulbasaur" });
  const eevee = await renderOnboarding({ kind: "hatch", frame: 0, species: "eevee" });
  assert.ok(!bulba.pngBuffer.equals(eevee.pngBuffer), "species eggs must differ even mid-hatch");
});
