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

const HATCH_BLACK = 9;

test("hatch final frame is a full-black flash (reveal moved to born screen)", async () => {
  const { bitmap } = await renderOnboarding({ kind: "hatch", frame: HATCH_BLACK, species: "eevee" });
  const allBlack = bitmap.bytes.every((b) => b === 0xff);
  assert.ok(allBlack, "final hatch frame must be a black flash");
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

test("choose screen highlights selected chip distinctly (inverted)", async () => {
  const sel0 = await renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel: 0 });
  const sel1 = await renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel: 1 });
  assert.ok(!sel0.pngBuffer.equals(sel1.pngBuffer), "different selection must render differently");

  const bx = 24;
  const bw = Math.round((400 - 48 - 18) / 4);
  const y = 194;
  const h = 64;
  const selected = inkRatio(sel0.bitmap, bx, y, bw, h);
  const unselected = inkRatio(sel0.bitmap, bx + bw + 6, y, bw, h);
  assert.ok(selected > unselected + 0.25, `selected chip should be inverted (${selected} vs ${unselected})`);
});

test("oak screen page dots reflect current page", async () => {
  const lines = ["a", "b", "c", "d"];
  const p1 = await renderOnboarding({ kind: "oak", lines, page: 1, total: 4 });
  const p4 = await renderOnboarding({ kind: "oak", lines, page: 4, total: 4 });
  assert.ok(!p1.pngBuffer.equals(p4.pngBuffer), "different page must render different dots");
});

test("born screen renders rays + sparkle title for the species", async () => {
  const born = await renderOnboarding({ kind: "born", species: "bulbasaur", name: "妙蛙种子" });
  assert.ok(born.pngBuffer.length > 0);
  const sideRays = inkRatio(born.bitmap, 88, 72, 36, 56) + inkRatio(born.bitmap, 276, 72, 36, 56);
  assert.ok(sideRays > 0.02, "born screen should add visible side rays behind the sprite");

  const eevee = await renderOnboarding({ kind: "born", species: "eevee", name: "伊布" });
  assert.ok(!born.pngBuffer.equals(eevee.pngBuffer), "different species born differ");
});

function inkRatio(bitmap, x, y, w, h) {
  const rowBytes = Math.ceil(bitmap.w / 8);
  let ink = 0;
  let total = 0;
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      ink += (bitmap.bytes[yy * rowBytes + (xx >> 3)] >> (7 - (xx & 7))) & 1;
      total += 1;
    }
  }
  return ink / total;
}
