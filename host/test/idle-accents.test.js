import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";

import { drawIdleAccent, ACCENT_SPECIES } from "../src/render/idle-accents.js";

const BOX = { x: 10, y: 10, w: 100, h: 100 };
// 捕获整幅像素（位置敏感，避免"像素数相同但位置变了"被误判为无变化）
function captureInk(species, phase) {
  const c = createCanvas(140, 140);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 140, 140);
  g.fillStyle = "#000"; g.strokeStyle = "#000";
  drawIdleAccent(g, species, BOX, phase);
  return [...g.getImageData(0, 0, 140, 140).data];
}

test("all 18 species have a registered accent", () => {
  assert.equal(ACCENT_SPECIES.length, 18);
});

test("each species accent changes across phases (animated)", () => {
  for (const sp of ACCENT_SPECIES) {
    const a = captureInk(sp, 0);
    const b = captureInk(sp, 2);
    assert.notDeepEqual(a, b, `${sp} accent should differ between phase 0 and 2`);
  }
});

test("unknown species draws nothing (no throw)", () => {
  const c = createCanvas(20, 20);
  const g = c.getContext("2d");
  assert.doesNotThrow(() => drawIdleAccent(g, "不存在", BOX, 0));
});
