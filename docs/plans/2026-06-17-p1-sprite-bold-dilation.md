# P1 · 宝可梦线条加粗（dilate1bpp）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 本仓按用户约定由 **codex（skill `codeagent`）实现每个 task**，Claude 作为 PM 逐 task 审查并亲自跑闸门。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 给日常屏的宝可梦精灵做 1px 形态学膨胀，让 1-bit 反射屏上发"虚"的细线变连续、变实——零新资产、不联网、不改传输/养成契约。

**Architecture:** 在 `host/src/render/sprites.js` 新增纯函数 `dilate1bpp`（对 0/255 缓冲膨胀墨色，非 mutate）。`host/src/render/layout.js` 的共享入口 `drawSprite` 增 `{bold=false, boldRadius=1}`，**默认 false**（不污染 Oak/进化/诞生），仅 `drawBuddyPanel` 显式 `bold:true`。

**Tech Stack:** Node ESM、`@napi-rs/canvas`、`node:test` + `assert/strict`。

**对应 spec:** [docs/specs/2026-06-17-buddy-cries-animations-design.md](../specs/2026-06-17-buddy-cries-animations-design.md) 支柱一·第一步（P1）。

**前置条件:** 在 `host/` 已装依赖的环境执行（worktree 初次须先 `cd host && npm install`，否则 `node --test` 会因缺 `@napi-rs/canvas` 直接报错，而非得到计划的 red/green）。

---

### Task 1: `dilate1bpp` 纯函数

**Files:**
- Modify: `host/src/render/sprites.js`（在 `thresholdSpriteGray` 之后新增导出函数）
- Test: `host/test/dilate.test.js`（新建）

- [ ] **Step 1: 写失败测试**

`host/test/dilate.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/dilate.test.js`
Expected: FAIL（`dilate1bpp` 未导出 / 不是函数）。

- [ ] **Step 3: 实现 `dilate1bpp`**

在 `host/src/render/sprites.js` 的 `thresholdSpriteGray` 函数之后追加：

```js
// Morphological dilation of ink (value 0) on a 1-bit-valued buffer
// (0 = ink, 255 = paper). Returns a NEW buffer; never mutates input.
// Each radius step grows ink into its 4-neighbours so thin 1px strokes read as
// solid on the 1-bit LCD instead of breaking into dashes. Expects a thresholded
// (0/255) buffer; non-zero, non-255 values are treated as paper.
export function dilate1bpp(gray, w, h, radius = 1) {
  if (!(gray instanceof Uint8Array) || gray.length !== w * h) {
    throw new Error("dilate1bpp: gray buffer size does not match dimensions");
  }
  let src = gray;
  const steps = Math.max(0, Math.floor(radius)); // 归一化，防小数多膨胀一圈
  for (let r = 0; r < steps; r += 1) {
    const out = new Uint8Array(src.length).fill(255);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        const ink =
          src[i] === 0 ||
          (x > 0 && src[i - 1] === 0) ||
          (x < w - 1 && src[i + 1] === 0) ||
          (y > 0 && src[i - w] === 0) ||
          (y < h - 1 && src[i + w] === 0);
        out[i] = ink ? 0 : 255;
      }
    }
    src = out;
  }
  return src === gray ? new Uint8Array(gray) : src; // radius 0 → 非 mutate 拷贝
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/dilate.test.js`
Expected: PASS（8 个用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/sprites.js test/dilate.test.js
git commit -m "feat(render): add dilate1bpp 1-bit ink dilation"
```

---

### Task 2: `drawSprite` 接入 `bold`，仅 buddy 启用

**Files:**
- Modify: `host/src/render/layout.js`（`drawSprite` 签名 + 体；`drawBuddyPanel` 调用处）
- Modify: `host/src/render/sprites.js` 已在 Task 1 导出 `dilate1bpp`
- Test: `host/test/layout-bold.test.js`（新建）

- [ ] **Step 1: 写失败测试**

`host/test/layout-bold.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/layout-bold.test.js`
Expected: FAIL（`bold` 选项未实现，bold 与 plain 像素数相同 → 第 1 个断言失败）。

- [ ] **Step 3: 实现 `drawSprite` 的 bold**

`host/src/render/layout.js`：① 顶部 import 增 `dilate1bpp`：

```js
import { ditherSpriteGray, dilate1bpp, SPRITE_CRISP_THRESHOLD, thresholdSpriteGray } from "./sprites.js";
```

② `drawSprite` 签名加 `bold`/`boldRadius`，并在 `rendered` 之后膨胀（缩放前）：

```js
export function drawSprite(g, spriteGray, {
  x,
  y,
  maxSize = BUDDY_SPRITE_SLOT,
  size,
  srcW,
  srcH,
  scale = BUDDY_SPRITE_SCALE,
  mode = "threshold",
  threshold = SPRITE_CRISP_THRESHOLD,
  bold = false,
  boldRadius = 1,
} = {}) {
  const pixels = spriteGray instanceof Uint8Array ? spriteGray : placeholderSprite(96, 96);
  const side = Math.max(1, Math.round(Math.sqrt(pixels.length)));
  const sourceW = Number.isInteger(srcW) && srcW > 0 ? srcW : (side * side === pixels.length ? side : 96);
  const sourceH = Number.isInteger(srcH) && srcH > 0 ? srcH : Math.max(1, Math.floor(pixels.length / sourceW));
  let rendered = mode === "dither"
    ? ditherSpriteGray(pixels, sourceW, sourceH)
    : thresholdSpriteGray(pixels, sourceW, sourceH, { threshold });
  if (bold) rendered = dilate1bpp(rendered, sourceW, sourceH, boldRadius);
```

（其余 `drawSprite` 函数体不变。）

③ `drawBuddyPanel` 里的 buddy 调用显式开启 bold：

```js
  drawSprite(g, buddy.spriteGray, {
    x: panelX + Math.floor((panelW - BUDDY_SPRITE_SLOT) / 2),
    y: 60,
    maxSize: BUDDY_SPRITE_SLOT,
    srcW: buddy.spriteW,
    srcH: buddy.spriteH,
    bold: true,
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/layout-bold.test.js`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/layout.js test/layout-bold.test.js
git commit -m "feat(render): bold buddy sprite via dilate1bpp (Oak/evolution unaffected)"
```

---

### Task 3: 全量回归 + 1-bit 对比验证（亲眼看）

**Files:**
- Create: `host/scripts/bold-compare.mjs`（一次性可复跑预览脚本）
- 产物落 `host/out/bold-compare/`（已 gitignore）

- [ ] **Step 1: 全量回归**

Run: `cd host && node --test`
Expected: 全绿，0 fail。说明：Oak/进化/诞生现有测试（`onboarding-render.test.js`、`evolution-anim.test.js`）主要证 no-throw / 物种间不同，不证像素零变化；其零变化由"调用点未传 `bold`、默认 false"**静态保证**（`evolution-anim.js:73`、`render/onboarding.js:52`、`:125` 均未传 bold），并由 Task 2 的"default == bold:false"等价测试在函数层兜底。

- [ ] **Step 2: 写并跑对比脚本（固定命令）**

`host/scripts/bold-compare.mjs`：

```js
// 一次性目检：把全 18 物种 plain 与 bold 并排渲染到 out/bold-compare/<species>.png
import { mkdirSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";

import { loadBuddySprite } from "../src/render/sprites.js";
import { drawSprite } from "../src/render/layout.js";

const SPECIES = [
  "eevee", "vaporeon", "jolteon", "flareon", "espeon", "umbreon",
  "leafeon", "glaceon", "sylveon", "bulbasaur", "ivysaur", "venusaur",
  "charmander", "charmeleon", "charizard", "squirtle", "wartortle", "blastoise",
];
const SLOT = 136;
mkdirSync("out/bold-compare", { recursive: true });
for (const species of SPECIES) {
  const s = await loadBuddySprite(species);
  const canvas = createCanvas(SLOT * 2 + 12, SLOT);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const opts = { maxSize: SLOT, srcW: s.w, srcH: s.h };
  drawSprite(g, s.gray, { ...opts, x: 0, y: 0 });                      // 左：plain
  drawSprite(g, s.gray, { ...opts, x: SLOT + 12, y: 0, bold: true });  // 右：bold
  writeFileSync(`out/bold-compare/${species}.png`, await canvas.encode("png"));
  console.log(`wrote out/bold-compare/${species}.png`);
}
```

Run: `cd host && node scripts/bold-compare.mjs`
Expected: 打印 18 行 `wrote out/bold-compare/<species>.png`。

- [ ] **Step 3: 人工确认（PM 验收）**

逐只过 18 物种对比图：① 线条连续不再断成虚点；② 眼睛/相邻部件未被糊死粘连；③ 仍是线稿味、未填实身体。若某只 radius=1 仍糊（小眼被填），记录待 P5 重烘焙用更细源线解决，**不在 P1 强行加 radius**。

- [ ] **Step 4: 提交对比脚本**

```bash
cd host && git add scripts/bold-compare.mjs
git commit -m "chore(render): bold vs plain 18-species 1-bit preview script"
```

---

## 自检（plan vs spec）

- **Spec 覆盖**：P1「dilate1bpp + drawSprite bold（默认 false，仅 buddy）」→ Task 1/2 全覆盖；spec 验收「对比图 + Oak/进化/诞生目检」→ Task 3。
- **占位扫描**：无 TBD；每个 code step 含完整代码。
- **类型/签名一致**：`dilate1bpp(gray,w,h,radius)` 在 Task 1 定义、Task 2 import 使用一致；`drawSprite` 新增 `bold/boldRadius` 命名贯穿。
- **非目标守住**：传输/养成/固件/Oak 均不动；`bold` 默认 false 保证既有调用零行为变化。
