import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";

import { drawIdleAccent, ACCENT_SPECIES } from "../src/render/idle-accents.js";

const CAPTURE_BOX = { x: 10, y: 10, w: 100, h: 100 };

function captureInk(species, phase) {
  const c = createCanvas(140, 140);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 140, 140);
  g.fillStyle = "#000"; g.strokeStyle = "#000";
  drawIdleAccent(g, species, CAPTURE_BOX, phase);
  return [...g.getImageData(0, 0, 140, 140).data];
}

function recorder() {
  const pts = [];
  const g = {
    fillRect: (x, y) => pts.push([x, y]),
    beginPath() {},
    stroke() {},
    fill() {},
    moveTo: (x, y) => pts.push([x, y]),
    lineTo: (x, y) => pts.push([x, y]),
    quadraticCurveTo: (cx, cy, x, y) => { pts.push([cx, cy]); pts.push([x, y]); },
    ellipse: (x, y, rx, ry) => { pts.push([x - rx, y - ry]); pts.push([x + rx, y + ry]); },
    arc: (x, y) => pts.push([x, y]),
  };
  return { g, pts };
}

const SLOT_BOX = { x: 230, y: 46, w: 156, h: 156 };

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
  assert.doesNotThrow(() => drawIdleAccent(g, "不存在", CAPTURE_BOX, 0));
});

test("espeon gem accent stays within the sprite slot for every phase", () => {
  for (let phase = 0; phase < 4; phase += 1) {
    const { g, pts } = recorder();
    drawIdleAccent(g, "espeon", SLOT_BOX, phase);
    for (const [x, y] of pts) {
      assert.ok(x >= SLOT_BOX.x && x <= SLOT_BOX.x + SLOT_BOX.w, `phase ${phase}: x=${x} out of [${SLOT_BOX.x}, ${SLOT_BOX.x + SLOT_BOX.w}]`);
      assert.ok(y >= SLOT_BOX.y && y <= SLOT_BOX.y + SLOT_BOX.h, `phase ${phase}: y=${y} out of [${SLOT_BOX.y}, ${SLOT_BOX.y + SLOT_BOX.h}]`);
    }
  }
});

test("umbreon rings accent draws on every one of the 4 phases (no blank frame)", () => {
  for (let phase = 0; phase < 4; phase += 1) {
    const { g, pts } = recorder();
    drawIdleAccent(g, "umbreon", SLOT_BOX, phase);
    assert.ok(pts.length > 0, `phase ${phase} drew nothing (flicker)`);
  }
});
