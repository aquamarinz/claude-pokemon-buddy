# P3 · 连续 idle 微动画（呼吸 + 逐物种 accent）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 本仓由 **codex（skill `codeagent`）实现每个 task**，Claude 作 PM 逐 task 审查并亲跑闸门。步骤用 `- [ ]` 跟踪。

**Goal:** 让宝可梦在 60s 主 tick 之间持续轻微"活着"——通用呼吸浮动 + 逐物种程序化 accent（火苗/电花/水波/叶摆/星光/环纹/冰晶/缎带），由独立 ~3FPS 驱动只推 buddy 脏区，绝不与主 tick/招牌/sensor 抢串口出残影。

**Architecture:** ① transport `push` 加 promise-chain 互斥（覆盖 diff→push→baseline 全段）。② `buddy-animator.js` 自调度循环：取主 tick 缓存的最新 model + 递增 animPhase 重渲整帧、经互斥 push（diff 只发 buddy 块）。③ `layout.js` drawBuddyPanel 按 animPhase 做呼吸 bob + 调 `idle-accents.js`。④ `index.js` main 建 animator，主 tick/招牌期间 pause/resume。

**Tech Stack:** Node ESM、`@napi-rs/canvas`、`node:test`（fake timers）。

**前置条件:** `cd host && npm install` 已完成。`node --test` 唯一允许失败为宿主机占串口的 `scripts/play-test.js`。

**对应 spec:** [docs/specs/2026-06-17-buddy-cries-animations-design.md](../specs/2026-06-17-buddy-cries-animations-design.md) 支柱三 + 附录四件套。

---

### Task 1: transport `push` 互斥（防并发残影）

**Files:**
- Modify: `host/src/transport/index.js`（`wrapSerialTransport` 串行化 push）
- Test: `host/test/push-mutex.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/push-mutex.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTransport } from "../src/transport/index.js";

// 可控 serial：pushFrame 在 release() 前挂起，记录每次的 dirty payload
function gatedSerialFactory() {
  let release;
  const gate = new Promise((r) => { release = r; });
  const seen = [];
  const serial = {
    async pushFrame(payload) { seen.push(payload); await gate; return { ok: true }; },
    playSound() {}, setActiveCry() {},
    onReconnect() { return () => {}; }, onButton() { return () => {}; },
    onSensor() { return () => {}; }, feedSensor() { return null; }, close() {},
    _release: () => release(), _seen: seen,
  };
  return { factory: async () => serial, serial };
}

function frame(bytes) { // bytes: 每字节 8px，h=1
  return { pngBuffer: null, bitmap: { bytes: Uint8Array.from(bytes), w: bytes.length * 8, h: 1 } };
}

test("concurrent pushes serialize and 2nd diffs against 1st's baseline", async () => {
  const { factory, serial } = gatedSerialFactory();
  const t = await createTransport({ serialTransportFactory: factory, framePath: null });

  const p1 = t.push(frame([0xff, 0xff])); // 16px 全墨
  const p2 = t.push(frame([0xff, 0x00])); // 仅后 8px 变白
  // 互斥下，第一帧未完成时第二帧的 pushFrame 不应被调用
  await Promise.resolve();
  assert.equal(serial._seen.length, 1);

  serial._release();
  await Promise.all([p1, p2]);
  assert.equal(serial._seen.length, 2);

  const p = serial._seen[1];              // 第二帧 dirty payload: [x u16][y u16][w u16][h u16][rle]
  const x = p[0] | (p[1] << 8);
  const w = p[4] | (p[5] << 8);
  assert.equal(x, 8);                     // 局部 rect → 证明 diff 用的是第一帧的 baseline
  assert.equal(w, 8);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/push-mutex.test.js`
Expected: FAIL（无互斥时第二帧 pushFrame 也被同步调用 → `_seen.length===2`，断言 `===1` 失败）。

- [ ] **Step 3: 实现互斥**

`host/src/transport/index.js` `wrapSerialTransport`：**保留 P2 的 `lastActiveCry`/`setActiveCry`/onReconnect 重放原样**，仅把内联 `push` 抽成 `doPush` 并加 promise-chain 串行。整函数替换为：

```js
function wrapSerialTransport(serial, { framePath }) {
  let previousBytes = null;
  let lastActiveCry = null;
  serial.onReconnect?.(() => {
    previousBytes = null;
    if (lastActiveCry != null) serial.setActiveCry(lastActiveCry); // P2: 重连重放
  });

  async function doPush({ pngBuffer, bitmap }) {
    if (!bitmap) throw new Error("bitmap is required");
    writePreview(framePath, pngBuffer);
    const rect = diffRect(previousBytes, bitmap.bytes, bitmap.w, bitmap.h);
    if (!rect) return { ok: true, skipped: true };
    const result = await serial.pushFrame(encodeDirtyPayload(rect));
    if (result?.ok) previousBytes = Uint8Array.from(bitmap.bytes);
    return result;
  }

  let chain = Promise.resolve();
  function push(frame) {
    const run = chain.then(() => doPush(frame));
    chain = run.then(() => {}, () => {}); // 保持链活，吞错不阻断后续
    return run;
  }

  return {
    ...serial,
    kind: "serial",
    setActiveCry(id) {                       // P2: 原样保留
      lastActiveCry = id & 0xff;
      serial.setActiveCry(lastActiveCry);
    },
    push,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/push-mutex.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/transport/index.js test/push-mutex.test.js
git commit -m "feat(transport): serialize push to protect dirty-rect baseline"
```

---

### Task 2: `buddy-animator.js` 自调度循环 + pause/resume

**Files:**
- Create: `host/src/render/buddy-animator.js`
- Test: `host/test/buddy-animator.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/buddy-animator.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { createBuddyAnimator } from "../src/render/buddy-animator.js";

const tick = () => new Promise((r) => setImmediate(r));

test("animator pushes frames with incrementing animPhase while running", async () => {
  const pushes = [];
  let phase = -1;
  const animator = createBuddyAnimator({
    transport: { push: async (f) => { pushes.push(f.animPhase); } },
    getModel: () => ({ buddy: {} }),
    render: (m) => { phase = m.buddy.animPhase; return { animPhase: m.buddy.animPhase }; },
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  animator.start();
  for (let i = 0; i < 4; i += 1) await tick();
  animator.stop();
  assert.ok(pushes.length >= 3);
  assert.deepEqual(pushes.slice(0, 3), [0, 1, 2]); // animPhase 递增
});

test("paused animator does not push; resumes after resume()", async () => {
  const pushes = [];
  const animator = createBuddyAnimator({
    transport: { push: async () => { pushes.push(1); } },
    getModel: () => ({ buddy: {} }),
    render: (m) => ({ animPhase: m.buddy.animPhase }),
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  animator.start();
  animator.pause();
  const before = pushes.length;
  for (let i = 0; i < 3; i += 1) await tick();
  assert.equal(pushes.length, before); // pause 期间不推
  animator.resume();
  for (let i = 0; i < 2; i += 1) await tick();
  animator.stop();
  assert.ok(pushes.length > before); // resume 后恢复
});

test("animator skips a frame when getModel returns null (no model yet)", async () => {
  const pushes = [];
  const animator = createBuddyAnimator({
    transport: { push: async () => { pushes.push(1); } },
    getModel: () => null,
    render: () => ({}),
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  animator.start();
  for (let i = 0; i < 3; i += 1) await tick();
  animator.stop();
  assert.equal(pushes.length, 0); // 无 model 不推
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/buddy-animator.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`host/src/render/buddy-animator.js`：

```js
// 独立于 60s 主 tick 的 buddy 动画驱动。自调度（await push 后再 sleep，不用裸
// setInterval 防积压），经 transport.push 的串行互斥推帧，diff 只发 buddy 脏区。
export function createBuddyAnimator({
  transport,
  getModel,
  render,
  intervalMs = 333,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let running = false;
  let paused = false;
  let phase = 0;

  async function loop() {
    while (running) {
      if (!paused) {
        try {
          const model = getModel();
          if (model) {
            const frame = await render({ ...model, buddy: { ...model.buddy, animPhase: phase } });
            phase = (phase + 1) % 1_000_000;
            await transport.push(frame);
          }
        } catch { /* idle 帧：吞掉 getModel/render/push 异常，继续循环 */ }
      }
      await sleep(intervalMs);
    }
  }

  return {
    start() { if (!running) { running = true; loop().catch(() => { running = false; }); } },
    stop() { running = false; },
    pause() { paused = true; },
    resume() { paused = false; },
  };
}
```

> 注：`render` 默认应是 `renderFrame`（返回 `{pngBuffer, bitmap}`）；测试注入轻量 render。`render` 收到的 model 含 `buddy.animPhase`，由 layout（Task 3/4）消费。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/buddy-animator.test.js`
Expected: PASS（3 用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/buddy-animator.js test/buddy-animator.test.js
git commit -m "feat(render): self-scheduling buddy animator with pause/resume"
```

---

### Task 3: 呼吸 bob（layout 按 animPhase 浮动精灵）

**Files:**
- Modify: `host/src/render/layout.js`（`drawBuddyPanel`：animPhase → 垂直 bob；导出 `BUDDY_BOB`）
- Test: `host/test/buddy-bob.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/buddy-bob.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderFrame } from "../src/render/frame.js";
import { loadBuddySprite } from "../src/render/sprites.js";

async function buddyModel(animPhase) {
  const s = await loadBuddySprite("eevee");
  return {
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000,
    now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "eevee", bond: 40, expPct: 50, bubble: "Bui!", animPhase },
  };
}

test("different animPhase yields a different buddy bitmap (breathing bob)", async () => {
  const a = await renderFrame(await buddyModel(0));
  const b = await renderFrame(await buddyModel(2)); // bob 最低点
  assert.notDeepEqual([...a.bitmap.bytes], [...b.bitmap.bytes]);
});

test("animPhase 0 and a full-period multiple render identically", async () => {
  const a = await renderFrame(await buddyModel(0));
  const c = await renderFrame(await buddyModel(4)); // BUDDY_BOB 周期=4 → 同相
  assert.deepEqual([...a.bitmap.bytes], [...c.bitmap.bytes]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/buddy-bob.test.js`
Expected: FAIL（animPhase 未被消费，两图相同）。

- [ ] **Step 3: 实现**

`host/src/render/layout.js`：① 顶部加导出常量：

```js
export const BUDDY_BOB = [0, -1, -2, -1]; // 呼吸浮动（周期 4，幅度 ≤2px）
```

② `drawBuddyPanel` 内，计算 bob 并把精灵 y 加偏移（accent 在 Task 4 接入）：

```js
function drawBuddyPanel(g, model) {
  const panelX = LEFT_W;
  const panelW = W - LEFT_W;
  const buddy = model.buddy ?? {};
  const hasAnimPhase = Number.isInteger(buddy.animPhase); // 缺省 → bob=0 且不画 accent（既有渲染零变化）
  const phase = hasAnimPhase ? buddy.animPhase : 0;
  const bob = BUDDY_BOB[phase % BUDDY_BOB.length];

  drawBubble(g, W - 8, 11, buddy.bubble ?? EEVEE_IDLE_CRY);
  drawShadow(g, panelX + panelW / 2, 190);
  drawSprite(g, buddy.spriteGray, {
    x: panelX + Math.floor((panelW - BUDDY_SPRITE_SLOT) / 2),
    y: 60 + bob,
    maxSize: BUDDY_SPRITE_SLOT,
    srcW: buddy.spriteW,
    srcH: buddy.spriteH,
    bold: true,
  });
  // ...（drawSpeciesLine 及以下原样不变）
```

（其余 drawBuddyPanel 行不变；阴影不随 bob 动，强化"上下浮"观感。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/buddy-bob.test.js`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/layout.js test/buddy-bob.test.js
git commit -m "feat(render): breathing bob for buddy sprite via animPhase"
```

---

### Task 4: `idle-accents.js` 逐物种程序化 accent

**Files:**
- Create: `host/src/render/idle-accents.js`
- Modify: `host/src/render/layout.js`（drawBuddyPanel 调 drawIdleAccent）
- Test: `host/test/idle-accents.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/idle-accents.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/idle-accents.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`host/src/render/idle-accents.js`（DRY：按属性做图元，18 只映射图元+参数；`box`=精灵槽 {x,y,w,h}，相位 4 拍循环。坐标取 box 内相对位）：

```js
// 逐物种 idle accent：在精灵槽 box 内画 1px 程序图元，随 animPhase(4 拍)轻动。
// 全部用 INK 当前 fillStyle/strokeStyle（调用方已设黑）。无新资产。
const P = (phase) => ((phase % 4) + 4) % 4;
const dot = (g, x, y) => g.fillRect(Math.round(x), Math.round(y), 1, 1);

function flame(g, box, phase, { scale = 1 } = {}) { // 火：尾端跳动火苗 + 火星
  const p = P(phase);
  const x = box.x + box.w * 0.74;
  const y = box.y + box.h * 0.78;
  const h = (6 + (p === 2 ? 2 : 0)) * scale;
  const dx = p === 1 ? -1 : p === 3 ? 1 : 0;
  g.beginPath();
  g.moveTo(x + dx, y - h);
  g.quadraticCurveTo(x + 3 * scale + dx, y - h * 0.4, x + dx, y);
  g.quadraticCurveTo(x - 3 * scale + dx, y - h * 0.4, x + dx, y - h);
  g.fill();
  if (p % 2 === 0) dot(g, x + dx + 2 * scale, y - h - 2); // 火星
}

function sparks(g, box, phase) { // 电：随相位换位的火花点（相邻相位取不同点对，保证每拍都变）
  const p = P(phase);
  const pts = [[0.2, 0.3], [0.8, 0.25], [0.15, 0.7], [0.85, 0.65]];
  const a = pts[p], b = pts[(p + 1) % 4];
  for (const [fx, fy] of [a, b]) {
    const x = box.x + box.w * fx, y = box.y + box.h * fy;
    dot(g, x, y); dot(g, x + 1, y - 1); dot(g, x - 1, y + 1);
  }
}

function ripples(g, box, phase) { // 水：脚边外扩水弧 + 偶滴水
  const p = P(phase);
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.96;
  const r = 10 + p * 6;
  g.beginPath(); g.ellipse(cx, cy, r, Math.max(2, r * 0.18), 0, Math.PI, 0); g.stroke();
  if (p === 3) dot(g, box.x + box.w * 0.72, box.y + box.h * 0.85);
}

function leaves(g, box, phase) { // 草：叶摆 + 孢子点
  const p = P(phase);
  const x = box.x + box.w * 0.5, y = box.y + box.h * 0.06;
  const tilt = [0, 2, -1, -2][p];
  g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + tilt, y); g.stroke();
  if (p >= 1) dot(g, x + 6 + p, y - p * 2); // 孢子上飘
}

function gem(g, box, phase) { // 超能：额宝石闪 + 绕行光点
  const p = P(phase);
  dot(g, box.x + box.w * 0.5, box.y + box.h * 0.16); // 宝石
  if (p % 2 === 0) dot(g, box.x + box.w * 0.5 + 1, box.y + box.h * 0.16 - 1);
  const ang = (p / 4) * Math.PI * 2;
  dot(g, box.x + box.w * 0.5 + Math.cos(ang) * box.w * 0.5,
        box.y + box.h * 0.5 + Math.sin(ang) * box.h * 0.42); // 绕行点
}

function rings(g, box, phase) { // 恶：环纹明灭光圈
  const p = P(phase);
  if (p === 1 || p === 2) {
    const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
    g.beginPath(); g.ellipse(cx, cy, box.w * 0.42 + p, box.h * 0.42 + p, 0, 0, Math.PI * 2); g.stroke();
  }
}

function crystals(g, box, phase) { // 冰：冰晶小十字
  const p = P(phase);
  const cross = (x, y) => { g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x + 2, y); g.moveTo(x, y - 2); g.lineTo(x, y + 2); g.stroke(); };
  cross(box.x + box.w * (0.2 + 0.05 * p), box.y + box.h * 0.2);
  if (p % 2 === 1) cross(box.x + box.w * 0.8, box.y + box.h * 0.3);
}

function ribbons(g, box, phase) { // 妖精：缎带波 + 爱心
  const p = P(phase);
  const y = box.y + box.h * (0.5 + 0.04 * Math.sin(p));
  g.beginPath(); g.moveTo(box.x + box.w * 0.1, y);
  g.quadraticCurveTo(box.x + box.w * 0.2, y - 4 + p, box.x + box.w * 0.32, y); g.stroke();
  if (p >= 2) { const hx = box.x + box.w * 0.62, hy = box.y + box.h * 0.18 - p; dot(g, hx, hy); dot(g, hx + 2, hy); dot(g, hx + 1, hy + 1); }
}

function twitch(g, box, phase) { // 普通(伊布)：耳尖/尾尖抖动点
  const p = P(phase);
  dot(g, box.x + box.w * 0.34, box.y + box.h * 0.08 - (p === 0 ? 1 : 0)); // 左耳尖
  dot(g, box.x + box.w * 0.62, box.y + box.h * 0.08 - (p === 0 ? 1 : 0)); // 右耳尖
  dot(g, box.x + box.w * 0.86 + (p === 1 ? 1 : 0), box.y + box.h * 0.5);  // 尾尖
}

// 物种 → 图元（+参数）。火/草按进化体型调 scale。
const ACCENTS = {
  eevee: twitch,
  vaporeon: ripples, jolteon: sparks, espeon: gem, umbreon: rings,
  leafeon: leaves, glaceon: crystals, sylveon: ribbons,
  flareon: (g, b, p) => flame(g, b, p, { scale: 0.9 }),
  bulbasaur: leaves, ivysaur: leaves, venusaur: leaves,
  charmander: (g, b, p) => flame(g, b, p, { scale: 1 }),
  charmeleon: (g, b, p) => flame(g, b, p, { scale: 1.3 }),
  charizard: (g, b, p) => flame(g, b, p, { scale: 1.6 }),
  squirtle: ripples, wartortle: ripples, blastoise: ripples,
};

export const ACCENT_SPECIES = Object.keys(ACCENTS);

export function drawIdleAccent(g, species, box, phase) {
  const fn = ACCENTS[species];
  if (fn) fn(g, box, phase);
}
```

② `host/src/render/layout.js` `drawBuddyPanel`：在 `drawSprite(...)` 之后调 accent（顶部 import `drawIdleAccent`）。**仅 `hasAnimPhase` 时画**（缺省渲染零变化）：

```js
  if (hasAnimPhase) {
    drawIdleAccent(g, buddy.species ?? "eevee", {
      x: panelX + Math.floor((panelW - BUDDY_SPRITE_SLOT) / 2),
      y: 60 + bob,
      w: BUDDY_SPRITE_SLOT,
      h: BUDDY_SPRITE_SLOT,
    }, phase);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/idle-accents.test.js`
Expected: PASS（3 用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/idle-accents.js src/render/layout.js test/idle-accents.test.js
git commit -m "feat(render): per-species procedural idle accents"
```

---

### Task 5: `index.js` main 接线（建 animator + 主 tick/招牌 pause/resume）

**Files:**
- Modify: `host/src/index.js`（`runOneTick` 暴露 model 给 animator；`main` 建 animator + tick 包 pause/resume）
- Test: `host/test/buddy-animator.test.js`（已覆盖 animator 行为）+ 全量回归

- [ ] **Step 1: 实现接线**

`host/src/index.js`：① import `createBuddyAnimator`。
② 模块级缓存最新 render model（main 内闭包变量）：`let currentModel = null;`
③ `runOneTick` 内，构造 buddy render model 处把同一 model 存给 `currentModel`（通过可选回调参数 `onModel`，便于注入测试）。最小做法：`runOneTick` 增可选 `onRenderModel` 参数，在 `renderFrame(model)` 前 `onRenderModel?.(model)`。
④ `main()` tick 流程（**`once` 模式绝不 start animator**，否则定时循环不停）：

```js
  let currentModel = null;
  const animator = createBuddyAnimator({
    transport,
    getModel: () => currentModel,
    render: renderFrame,
  });

  async function tick() {
    animator.pause();                       // 主 tick 期间暂停 idle，避免抢串口
    try {
      // ...原 tick 体；runOneTick 传 onRenderModel: (m) => { currentModel = m; }
    } finally {
      animator.resume();
    }
  }

  await tick();
  if (once) return;                         // once：animator 从未 start，直接返回
  animator.start();                         // 仅持续模式启动 idle 循环
  // stop() 内补 animator.stop();
  while (!stopped) { /* ...原循环... */ }
```

> 实现者注：① `currentModel` 必须是 runOneTick 实际喂给 `renderFrame` 的同一对象（含 buddy.spriteGray/species/mood/bubble），animator 仅覆盖 `buddy.animPhase`。② 在 `stop()`（`main` 内 SIGINT/SIGTERM 处理）里加 `animator.stop()`。③ 招牌动画（P4）复用同样的 pause/resume；本期只接 idle。

- [ ] **Step 1b（可选小测试）**：在 integration.test.js 加一条断言 `runOneTick` 以"含 buddy.spriteGray/species/bubble 的同一 model"调用 `onRenderModel` 回调一次（注入 spy 回调）。

- [ ] **Step 2: 全量回归**

Run: `cd host && node --test`
Expected: 0 fail（除宿主机占串口的 `play-test.js` 环境项）。重点确认既有 integration/frame/layout 测试无回归（animPhase 缺省=0 时渲染与原先一致）。

- [ ] **Step 3: 提交**

```bash
cd host && git add src/index.js
git commit -m "feat(host): drive continuous idle animation between main ticks"
```

---

## 自检（plan vs spec）

- **Spec 覆盖**：push 互斥（Task1）、自调度 animator + pause/resume（Task2）、呼吸 bob（Task3）、逐物种 accent（Task4）、主循环接线（Task5）——支柱三全覆盖。
- **占位扫描**：无 TBD；图元与 18 只映射、测试代码均完整。Task5 接线因需对齐 main/runOneTick 现有结构，已显式标注注入点（`onRenderModel`/`currentModel`）。
- **类型/签名一致**：`createBuddyAnimator({transport,getModel,render,intervalMs,sleep})`（Task2）→ Task5 用一致；`drawIdleAccent(g,species,box,phase)`（Task4）→ layout 调用一致；`BUDDY_BOB`（Task3）周期 4 与测试一致。
- **非目标守住**：不动养成/usage/weather；招牌动作属 P4；放大属 P5；animPhase 缺省=0 保证既有渲染零变化。
- **风险闸门**：先落 push 互斥 + 并发反向测试（Task1）再接 animator，避免残影；accent 全部 1px 程序图元、无新资产；克制幅度（bob ≤2px）。
