# P4 · KEY 招牌动作（持久按钮 + 招牌帧 + 绑叫声）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 本仓由 **codex（skill `codeagent`）实现每个 task**，Claude 作 PM 逐 task 审查并亲跑闸门。步骤用 `- [ ]` 跟踪。

**Goal:** 按 KEY → 当前物种几帧专属招牌动作（原地跳 + accent 动），同步固件本地叫声；通过 main 持久按钮通道触发，与 60s 主 tick / idle 循环共享串口不冲突。

**Architecture:** ① P3 的 buddy-animator pause/resume 改引用计数（tick 与招牌可嵌套暂停）。② layout drawBuddyPanel 读 `buddy.hop` 给精灵上跳偏移。③ `signature-anim.js` `playSignatureAnimation` 顺序推 hop 帧（复用 P1/P3 渲染，**不调 playSound**——KEY 由固件本地即时出声，避免双响）。④ index.js 暴露纯函数 `shouldPlaySignature`，main 建持久 `transport.onButton`：KEY short 且 pet 非 readyToEvolve → 暂停 idle、await 招牌、恢复。

**Tech Stack:** Node ESM、`@napi-rs/canvas`、`node:test`。

**前置条件:** `cd host && npm install`。`node --test` 唯一允许失败为 `scripts/play-test.js`（占串口）。host-only，不动固件。

**对应 spec:** [docs/specs/2026-06-17-buddy-cries-animations-design.md](../specs/2026-06-17-buddy-cries-animations-design.md) 支柱三·招牌动画。

---

### Task 1: animator pause/resume 引用计数（嵌套安全）

**Files:**
- Modify: `host/src/render/buddy-animator.js`
- Test: `host/test/buddy-animator.test.js`（追加嵌套用例）

- [ ] **Step 1: 追加失败测试**

在 `host/test/buddy-animator.test.js` 追加：

```js
test("pause/resume is reference-counted (nested pause stays paused)", async (t) => {
  const pushes = [];
  const animator = createBuddyAnimator({
    transport: { push: async () => { pushes.push(1); } },
    getModel: () => ({ buddy: {} }),
    render: (m) => ({ animPhase: m.buddy.animPhase }),
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  t.after(() => animator.stop()); // 红态断言抛出也能停掉自调度 loop，防泄漏
  animator.start();
  animator.pause();          // depth 1
  animator.pause();          // depth 2
  animator.resume();         // depth 1 → 仍暂停
  const before = pushes.length;
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(pushes.length, before); // 仍暂停
  animator.resume();         // depth 0 → 恢复
  for (let i = 0; i < 2; i += 1) await new Promise((r) => setImmediate(r));
  animator.stop();
  assert.ok(pushes.length > before);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/buddy-animator.test.js`
Expected: FAIL（当前布尔 paused，第一次 resume 即恢复 → before 后仍推帧，断言相等失败）。

- [ ] **Step 3: 实现引用计数**

`host/src/render/buddy-animator.js`：把 `let paused = false;` 改为深度计数，pause/resume 改写（loop 内 `if (!paused)` 改 `if (pauseDepth === 0)`）：

```js
  let running = false;
  let pauseDepth = 0;
  let phase = 0;

  async function loop() {
    while (running) {
      if (pauseDepth === 0) {
        try {
          const model = getModel();
          if (model) {
            const frame = await render({ ...model, buddy: { ...model.buddy, animPhase: phase } });
            if (pauseDepth === 0 && running) {
              phase = (phase + 1) % 1_000_000;
              await transport.push(frame);
            }
          }
        } catch { /* idle 帧：吞异常继续 */ }
      }
      await sleep(intervalMs);
    }
  }

  return {
    start() { if (!running) { running = true; loop().catch(() => { running = false; }); } },
    stop() { running = false; },
    pause() { pauseDepth += 1; },
    resume() { pauseDepth = Math.max(0, pauseDepth - 1); },
  };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/buddy-animator.test.js`
Expected: PASS（既有 + 新增嵌套用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/buddy-animator.js test/buddy-animator.test.js
git commit -m "feat(render): reference-counted animator pause/resume"
```

---

### Task 2: drawBuddyPanel 支持 `buddy.hop`（跳跃偏移）

**Files:**
- Modify: `host/src/render/layout.js`（`drawBuddyPanel` 精灵与 accent 的 y 减 hop）
- Test: `host/test/buddy-hop.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/buddy-hop.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderFrame } from "../src/render/frame.js";
import { loadBuddySprite } from "../src/render/sprites.js";

async function model(hop) {
  const s = await loadBuddySprite("eevee");
  return {
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000,
    now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "eevee", bond: 40, expPct: 50, bubble: "Bui!", animPhase: 0, hop },
  };
}

test("buddy.hop raises the sprite (different bitmap)", async () => {
  const a = await renderFrame(await model(0));
  const b = await renderFrame(await model(8));
  assert.notDeepEqual([...a.bitmap.bytes], [...b.bitmap.bytes]);
});

test("hop defaults to 0 (absent hop == hop 0)", async () => {
  const s = await loadBuddySprite("eevee");
  const base = {
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000, now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "eevee", bond: 40, expPct: 50, bubble: "Bui!", animPhase: 0 },
  };
  const noHop = await renderFrame(base);
  const hop0 = await renderFrame({ ...base, buddy: { ...base.buddy, hop: 0 } });
  assert.deepEqual([...noHop.bitmap.bytes], [...hop0.bitmap.bytes]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/buddy-hop.test.js`
Expected: FAIL（hop 未消费，两图相同）。

- [ ] **Step 3: 实现**

`host/src/render/layout.js` `drawBuddyPanel`：在 `bob` 计算后加 hop，并把精灵与 accent 的 y 同时减 hop（向上为正）：

```js
  const hop = Number.isInteger(buddy.hop) ? buddy.hop : 0;
```

精灵 y：`y: 60 + bob - hop,`；accent box `y: 60 + bob - hop,`（两处与 P3 的 `60 + bob` 同步改成 `60 + bob - hop`）。阴影不随 hop 动（跳起时阴影留地面，强化跳感）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/buddy-hop.test.js`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/layout.js test/buddy-hop.test.js
git commit -m "feat(render): buddy.hop vertical offset for signature jump"
```

---

### Task 3: `signature-anim.js` 招牌帧序列（顺序推送，不发声）

**Files:**
- Create: `host/src/render/signature-anim.js`
- Test: `host/test/signature-anim.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/signature-anim.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { playSignatureAnimation, SIGNATURE_HOP } from "../src/render/signature-anim.js";
import { loadBuddySprite } from "../src/render/sprites.js";

function spyTransport() {
  let inFlight = 0;
  const order = [];
  return {
    playSoundCalls: 0,
    playSound() { this.playSoundCalls += 1; },
    async push(frame) {
      assert.equal(inFlight, 0, "pushes must be sequential (no overlap)");
      inFlight += 1;
      order.push(frame.buddy.hop);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true };
    },
    _order: order,
  };
}

const baseModel = () => ({ buddy: { species: "charmander", spriteGray: new Uint8Array(4), spriteW: 2, spriteH: 2 } });

test("plays the full hop sequence sequentially", async () => {
  const t = spyTransport();
  await playSignatureAnimation({
    transport: t, model: baseModel(),
    render: (m) => ({ buddy: { hop: m.buddy.hop } }),
    delay: () => Promise.resolve(),
  });
  assert.equal(t._order.length, SIGNATURE_HOP.length);
  assert.deepEqual(t._order, SIGNATURE_HOP);
});

test("signature is visual-only: never calls playSound (firmware plays local cry)", async () => {
  const t = spyTransport();
  await playSignatureAnimation({
    transport: t, model: baseModel(),
    render: (m) => ({ buddy: { hop: m.buddy.hop } }),
    delay: () => Promise.resolve(),
  });
  assert.equal(t.playSoundCalls, 0);
});

test("default renderFrame produces valid {pngBuffer,bitmap} frames from a real model", async () => {
  const s = await loadBuddySprite("charmander");
  const model = {
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000, now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "charmander", bond: 40, expPct: 50, bubble: "嘎喔!" },
  };
  const frames = [];
  await playSignatureAnimation({
    transport: { push: async (f) => { frames.push(f); return { ok: true }; } },
    model, delay: () => Promise.resolve(), // 用默认 renderFrame
  });
  assert.equal(frames.length, SIGNATURE_HOP.length);
  for (const f of frames) {
    assert.ok(f.pngBuffer && f.pngBuffer.length > 0);
    assert.ok(f.bitmap?.bytes?.length > 0 && f.bitmap.w === 400 && f.bitmap.h === 300);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/signature-anim.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`host/src/render/signature-anim.js`：

```js
import { renderFrame } from "./frame.js";

// 招牌跳跃高度序列（向上为正）：下蹲蓄力→跳起→落回。accent 随 animPhase 一起动。
export const SIGNATURE_HOP = [-2, 4, 9, 7, 3, 0];

// 顺序推送招牌帧（每帧 await push 后再 delay，绝不并发 → 复用 P3 的 push 互斥不残影）。
// 视觉-only：不调 playSound——KEY 短按由固件本地即时播当前物种叫声，避免双响。
export async function playSignatureAnimation({
  transport,
  model,
  render = renderFrame,
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  stepMs = 70,
}) {
  if (!model) return;
  for (let i = 0; i < SIGNATURE_HOP.length; i += 1) {
    const frame = await render({ ...model, buddy: { ...model.buddy, hop: SIGNATURE_HOP[i], animPhase: i } });
    await transport.push(frame);
    if (i < SIGNATURE_HOP.length - 1) await delay(stepMs);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/signature-anim.test.js`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/signature-anim.js test/signature-anim.test.js
git commit -m "feat(render): per-species signature hop animation (visual-only)"
```

---

### Task 4: 持久按钮通道 + 动作队列（KEY short → 招牌，与 tick 互斥）

**Files:**
- Modify: `host/src/index.js`（导出 `shouldPlaySignature` + `createActionQueue`；收紧 `hasKeyPress` short-only；`main` 建持久 onButton + 动作队列；tick 入队；stop 释放订阅）
- Test: `host/test/signature-trigger.test.js`（纯函数 + 队列）+ `host/test/evolution-trigger.test.js`（追加 long/double 不进化）

- [ ] **Step 1: 写失败测试**

(a) `host/test/signature-trigger.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldPlaySignature, createActionQueue } from "../src/index.js";

test("KEY short on a non-evolving pet triggers signature", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, { readyToEvolve: false }), true);
});

test("readyToEvolve pet does NOT trigger signature (evolution owns KEY)", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, { readyToEvolve: true }), false);
});

test("long/double/boot presses do not trigger signature", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "long" }, { readyToEvolve: false }), false);
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "double" }, { readyToEvolve: false }), false);
  assert.equal(shouldPlaySignature({ key: "BOOT", kind: "short" }, { readyToEvolve: false }), false);
});

test("missing pet/event is safe (no trigger)", () => {
  assert.equal(shouldPlaySignature(undefined, undefined), false);                 // undefined!==false
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, undefined), false);
});

test("action queue serializes: 2nd action starts only after 1st resolves", async () => {
  const q = createActionQueue();
  const log = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const a = q.run(async () => { log.push("a-start"); await gate; log.push("a-end"); });
  const b = q.run(async () => { log.push("b-start"); });
  await Promise.resolve();
  assert.deepEqual(log, ["a-start"]);                 // b 尚未开始 → tick 帧不会插进招牌
  release();
  await Promise.all([a, b]);
  assert.deepEqual(log, ["a-start", "a-end", "b-start"]);
});
```

(b) `host/test/evolution-trigger.test.js` 追加（收紧后 long/double 不进化）：

```js
test("long-press KEY does not trigger evolution (short-only)", async () => {
  // 复用文件内既有 ready-to-evolve fixture + mockPressingKey 写法，
  // 把 injectButton("KEY","short") 换为 ("KEY","long")，断言 runOneTick 返回的 species 未变（未进化）。
});
```

> 实现者注：按 evolution-trigger.test.js 内既有 helper（如 `mockPressingKey`/ready fixture）改造，核心断言：kind 非 short 时 runOneTick 不进化。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/signature-trigger.test.js`
Expected: FAIL（`shouldPlaySignature`/`createActionQueue` 未导出）。

- [ ] **Step 3: 实现**

`host/src/index.js`：① 纯函数 + 动作队列（导出）：

```js
export function shouldPlaySignature(event, pet) {
  return event?.key === "KEY" && event?.kind === "short" && pet?.readyToEvolve === false;
}

// 串行化动作：tick 与招牌经同一队列互斥，杜绝 tick 帧插进招牌帧序列之间。
export function createActionQueue() {
  let chain = Promise.resolve();
  return {
    run(fn) {
      const result = chain.then(fn);
      chain = result.then(() => {}, () => {});
      return result;
    },
  };
}
```

② 收紧 `hasKeyPress`（short-only，与招牌语义一致；进化测试已用 `injectButton("KEY","short")`，不破）：

```js
function hasKeyPress(events) {
  return events.some((event) => event?.key === "KEY" && event?.kind === "short");
}
```

③ 顶部 import `playSignatureAnimation`。④ `main()`（animator 建好后）挂持久按钮通道 + 动作队列：

```js
  const actions = createActionQueue();
  let signaturePlaying = false;
  const offSignature = transport.onButton?.((event) => {
    if (signaturePlaying || !currentModel || !shouldPlaySignature(event, runtime.pet)) return;
    signaturePlaying = true;
    actions.run(async () => {
      animator.pause();
      try { await playSignatureAnimation({ transport, model: currentModel }); }
      finally { animator.resume(); }
    }).catch(() => {}).finally(() => { signaturePlaying = false; });
  });
```

⑤ `tick()` 走同一队列（与招牌互斥；animator.pause 仍需，挡独立 idle 循环）：

```js
  async function tick() {
    await actions.run(async () => {
      animator.pause();
      try {
        // ...原 tick 体（含 runOneTick onRenderModel: (m) => { currentModel = m; }）...
      } finally {
        animator.resume();
      }
    });
  }
```

⑥ `stop()` 内补 `offSignature?.();`（释放持久订阅）+ `animator.stop();`（P3 已加）。

> 注：进化仍由 runOneTick 处理（readyToEvolve 时招牌不触发，二者互斥）。**全量迁移进化到持久通道本期不做**——避免大改 runOneTick + 进化测试 churn；short-only 收紧统一了 KEY 语义，动作队列消除了 tick/招牌帧交错，这是 P4 的安全正确子集；进化"同一时窗"响应局限为已知遗留，留待后续单列。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd host && node --test test/signature-trigger.test.js test/evolution-trigger.test.js && node --test`
Expected: signature-trigger + evolution-trigger 全绿；全量 0 fail（除 `play-test.js` 环境项）；既有 evolution-anim/integration 无回归。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/index.js test/signature-trigger.test.js test/evolution-trigger.test.js
git commit -m "feat(host): persistent KEY-short signature via action queue (tick-exclusive)"
```

---

## 自检（plan vs spec）

- **Spec 覆盖**：持久按钮通道 + 动作队列（Task4）、招牌帧顺序推送 + 视觉-only 不双响 + 真实 renderFrame 验证（Task3）、跳跃偏移（Task2）、嵌套暂停安全（Task1）——支柱三招牌动画覆盖。
- **与 spec 的范围偏差（明示）**：spec 提"进化也从持久通道消费 + hasKeyPress 收紧"。本期**只收紧 hasKeyPress 到 short-only**（已加 long/double 不进化测试），**不做进化全量迁移**（避免大改 runOneTick + 进化测试 churn）；readyToEvolve 守卫 + 动作队列已保证招牌/进化互斥且帧不交错，进化"同一时窗"局限留待后续。
- **占位扫描**：无 TBD；序列/测试完整；evolution-trigger 追加用例已标注按既有 helper 对齐。
- **类型/签名一致**：`SIGNATURE_HOP`/`playSignatureAnimation({transport,model,render,delay,stepMs})`（Task3）→ Task4 调用一致；`buddy.hop`（Task2）→ Task3 帧设置一致；`shouldPlaySignature(event,pet)`/`createActionQueue()`（Task4）。
- **非目标守住**：不动固件（叫声由 P2 固件本地播）；hop/animPhase 缺省 → 既有渲染零变化。
- **风险闸门**：tick 与招牌经**动作队列**串行（防 tick 帧插进招牌序列）；二者仍各自 `animator.pause/resume`（挡独立 idle 循环）+ Task1 引用计数保证嵌套安全；push 互斥（P3）防单帧基线错乱；`signaturePlaying` 防招牌重入；持久订阅在 stop() 释放。
