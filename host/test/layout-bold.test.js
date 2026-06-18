import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";

import { drawSprite } from "../src/render/layout.js";

// 构造一张带细线（1px 竖线）的灰度精灵：墨=0、纸=255
function thinLineSprite(w, h) {
  const g = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y += 1) g[y * w + (w >> 1)] = 0; // 中间 1px 竖线
  return g;
}

function opaqueCount(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n += 1;
  return n;
}

test("drawSprite bold=true paints more ink than bold=false (default)", () => {
  const W = 48;
  const H = 48;
  const gray = thinLineSprite(20, 20);

  const plainCanvas = createCanvas(W, H);
  drawSprite(plainCanvas.getContext("2d"), gray, { x: 0, y: 0, maxSize: 40, srcW: 20, srcH: 20 });
  const plain = opaqueCount(plainCanvas.getContext("2d"), W, H);

  const boldCanvas = createCanvas(W, H);
  drawSprite(boldCanvas.getContext("2d"), gray, { x: 0, y: 0, maxSize: 40, srcW: 20, srcH: 20, bold: true });
  const bold = opaqueCount(boldCanvas.getContext("2d"), W, H);

  assert.ok(bold > plain, `expected bold(${bold}) > plain(${plain})`);
});

test("drawSprite default (no bold) is identical to bold:false", () => {
  const W = 48;
  const H = 48;
  const gray = thinLineSprite(20, 20);

  const a = createCanvas(W, H);
  drawSprite(a.getContext("2d"), gray, { x: 0, y: 0, maxSize: 40, srcW: 20, srcH: 20 });
  const b = createCanvas(W, H);
  drawSprite(b.getContext("2d"), gray, { x: 0, y: 0, maxSize: 40, srcW: 20, srcH: 20, bold: false });

  assert.deepEqual(
    [...a.getContext("2d").getImageData(0, 0, W, H).data],
    [...b.getContext("2d").getImageData(0, 0, W, H).data],
  );
});
