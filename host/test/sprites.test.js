import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

import { ditherSpriteGray, loadSpriteGray } from "../src/render/sprites.js";

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

test("ditherSpriteGray keeps sprite midtones as a 1-bit Bayer pattern", () => {
  const sprite = ditherSpriteGray(new Uint8Array(8 * 8).fill(128), 8, 8);

  assert.equal(sprite.length, 8 * 8);
  assert.ok(sprite.every((v) => v === 0 || v === 255));
  assert.ok(sprite.some((v) => v === 0));
  assert.ok(sprite.some((v) => v === 255));
});
