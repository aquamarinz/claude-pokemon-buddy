import { test } from "node:test";
import assert from "node:assert/strict";

import { dilate1bpp } from "../src/render/sprites.js";

// 5x5 中心单个墨点，radius=1 → 自身 + 上下左右共 5 个墨点（十字）
test("dilate1bpp expands a single ink pixel into a plus of 5", () => {
  const g = new Uint8Array(25).fill(255);
  g[12] = 0; // center of 5x5
  const out = dilate1bpp(g, 5, 5, 1);
  const ink = [...out].filter((v) => v === 0).length;
  assert.equal(ink, 5);
  for (const i of [12, 7, 17, 11, 13]) assert.equal(out[i], 0);
});

test("dilate1bpp does not mutate the input buffer", () => {
  const g = new Uint8Array(25).fill(255);
  g[12] = 0;
  const before = Uint8Array.from(g);
  dilate1bpp(g, 5, 5, 1);
  assert.deepEqual(g, before);
});

test("dilate1bpp preserves every original ink pixel", () => {
  const g = Uint8Array.from([0, 255, 255, 0, 255, 255, 255, 255, 0]); // 3x3
  const out = dilate1bpp(g, 3, 3, 1);
  for (let i = 0; i < g.length; i += 1) {
    if (g[i] === 0) assert.equal(out[i], 0);
  }
});

// 细线断点：墨-空-墨 在 1px 行内，膨胀后中间被连上
test("dilate1bpp closes a 1px gap between ink pixels", () => {
  const g = Uint8Array.from([0, 255, 0]); // 3x1
  const out = dilate1bpp(g, 3, 1, 1);
  assert.deepEqual([...out], [0, 0, 0]);
});

test("dilate1bpp keeps an all-paper buffer all paper and all-ink all ink", () => {
  const paper = new Uint8Array(9).fill(255);
  assert.deepEqual([...dilate1bpp(paper, 3, 3, 1)], [...paper]);
  const ink = new Uint8Array(9).fill(0);
  assert.deepEqual([...dilate1bpp(ink, 3, 3, 1)], [...ink]);
});

// radius=2 → 中心点扩成 13 个墨点的曼哈顿菱形（断言具体索引，防"碰巧 13 个"）
test("dilate1bpp radius 2 fills the exact Manhattan diamond", () => {
  const g = new Uint8Array(25).fill(255);
  g[12] = 0;
  const out1 = dilate1bpp(g, 5, 5, 1);
  const out2 = dilate1bpp(g, 5, 5, 2);
  assert.equal([...out1].filter((v) => v === 0).length, 5);
  const diamond = [2, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 22];
  assert.equal([...out2].filter((v) => v === 0).length, diamond.length);
  for (const i of diamond) assert.equal(out2[i], 0);
});

// 边界：右上角单点 radius=1 只扩 3 点（自身+左+下），绝不跨行环绕到上一行左端
test("dilate1bpp does not wrap across rows", () => {
  const g = new Uint8Array(9).fill(255); // 3x3
  g[2] = 0; // 右上角 r0c2
  const out = dilate1bpp(g, 3, 3, 1);
  assert.equal([...out].filter((v) => v === 0).length, 3);
  for (const i of [2, 1, 5]) assert.equal(out[i], 0); // 自身、左、下
  assert.equal(out[3], 255); // r1c0 不得被环绕染墨
});

test("dilate1bpp throws on size mismatch", () => {
  assert.throws(() => dilate1bpp(new Uint8Array(3), 2, 2, 1), /does not match/);
});
