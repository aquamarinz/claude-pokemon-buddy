import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

import { ditherSpriteGray, loadBuddySprite, loadSpriteGray } from "../src/render/sprites.js";

test("loadSpriteGray converts PNG to 96x96 grayscale", async (t) => {
  const dir = join("out", "test-sprites");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spritePath = join(dir, "sprite.png");
  const canvas = createCanvas(4, 4);
  const g = canvas.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, 4, 4);
  writeFileSync(spritePath, await canvas.encode("png"));

  const sprite = await loadSpriteGray(spritePath);

  assert.equal(sprite.w, 96);
  assert.equal(sprite.h, 96);
  assert.equal(sprite.placeholder, false);
  assert.equal(sprite.gray.length, 96 * 96);
  assert.ok(sprite.gray.every((v) => v < 10));
});

test("loadSpriteGray returns checkerboard placeholder when PNG is missing", async () => {
  const sprite = await loadSpriteGray(join("out", "test-sprites", "missing-eevee.png"));

  assert.equal(sprite.w, 96);
  assert.equal(sprite.h, 96);
  assert.equal(sprite.placeholder, true);
  assert.equal(sprite.gray.length, 96 * 96);
  assert.ok(sprite.gray.some((v) => v === 0));
  assert.ok(sprite.gray.some((v) => v === 255));
});

test("loadBuddySprite loads the real Eevee asset", async () => {
  const sprite = await loadBuddySprite("eevee");

  assert.equal(sprite.placeholder, false);
  assert.ok(sprite.w > 20 && sprite.h > 30);
  assert.equal(sprite.gray.length, sprite.w * sprite.h);
});

test("loadOakSprite loads the committed Oak asset", async () => {
  const { loadOakSprite } = await import("../src/render/sprites.js");
  const s = await loadOakSprite();
  assert.equal(s.placeholder, false);
  assert.ok(s.w > 20 && s.h > 30);
});

const ALL_SPECIES = [
  "eevee", "vaporeon", "jolteon", "flareon", "espeon", "umbreon",
  "leafeon", "glaceon", "sylveon", "bulbasaur", "ivysaur", "venusaur",
  "charmander", "charmeleon", "charizard", "squirtle", "wartortle", "blastoise",
];

for (const species of ALL_SPECIES) {
  test(`loadBuddySprite loads real ${species} asset (not placeholder)`, async () => {
    const sprite = await loadBuddySprite(species);
    assert.equal(sprite.placeholder, false);
  });
}

test("re-baked buddy sprites fill the slot without overflowing it", async () => {
  for (const species of ALL_SPECIES) {
    const s = await loadBuddySprite(species);
    const maxEdge = Math.max(s.w, s.h);
    assert.ok(maxEdge <= 136, `${species} max edge ${maxEdge} must not exceed slot 136`);
    assert.ok(maxEdge >= 128, `${species} max edge ${maxEdge} should be enlarged (~134)`);
  }
});

test("ditherSpriteGray keeps sprite midtones as a 1-bit Bayer pattern", () => {
  const sprite = ditherSpriteGray(new Uint8Array(8 * 8).fill(128), 8, 8);

  assert.equal(sprite.length, 8 * 8);
  assert.ok(sprite.every((v) => v === 0 || v === 255));
  assert.ok(sprite.some((v) => v === 0));
  assert.ok(sprite.some((v) => v === 255));
});
